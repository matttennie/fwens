import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import {
  DEFAULT_PRUNE_MAX_IDLE_MS,
  createSession,
  getSession,
  pruneStaleSessions,
  updateSessionStatus,
} from "../db.js";

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
});

// Force a session's last_seen_at to a specific UTC timestamp. SQLite stores
// datetime('now') as space-separated UTC text, so we match the format.
function setLastSeen(id: string, when: Date): void {
  const iso = when.toISOString().replace("T", " ").replace(/\..+Z$/, "");
  db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(iso, id);
}

describe("pruneStaleSessions — PID-based liveness", () => {
  it("marks sessions with dead PIDs as disconnected", () => {
    const id = createSession(db, "claude", "claude-worker", 42);
    const result = pruneStaleSessions(db, { isAlive: () => false });

    expect(result.pruned_dead_pid).toBe(1);
    expect(result.pruned_aged_out).toBe(0);
    expect(result.kept_alive).toBe(0);
    expect(result.skipped_no_pid_recent).toBe(0);
    expect(result.events[0]?.reason).toBe("dead_pid");
    expect(getSession(db, id)!.status).toBe("disconnected");
  });

  it("keeps sessions whose PIDs are alive AND recent", () => {
    const id = createSession(db, "claude", "claude-worker", 42);
    const result = pruneStaleSessions(db, { isAlive: () => true });

    expect(result.pruned_dead_pid).toBe(0);
    expect(result.kept_alive).toBe(1);
    expect(getSession(db, id)!.status).toBe("active");
  });

  it("leaves NULL-pid sessions alone when recent (legacy rows)", () => {
    const id = createSession(db, "claude", "claude-worker");
    const result = pruneStaleSessions(db, { isAlive: () => false });

    expect(result.pruned_dead_pid).toBe(0);
    expect(result.pruned_aged_out).toBe(0);
    expect(result.skipped_no_pid_recent).toBe(1);
    expect(getSession(db, id)!.status).toBe("active");
  });

  it("does not re-touch already-disconnected sessions", () => {
    const id = createSession(db, "claude", "claude-worker", 42);
    updateSessionStatus(db, id, "disconnected");

    const result = pruneStaleSessions(db, { isAlive: () => false });

    expect(result.pruned_dead_pid).toBe(0);
    expect(result.kept_alive).toBe(0);
    expect(result.skipped_no_pid_recent).toBe(0);
  });
});

describe("pruneStaleSessions — heartbeat-age fallback", () => {
  it("prunes alive-PID sessions whose last_seen_at exceeds maxIdleMs (PID-recycling defense)", () => {
    const id = createSession(db, "claude", "zombie", 42);
    setLastSeen(id, new Date(Date.now() - 25 * 60 * 60 * 1000)); // 25h ago

    const result = pruneStaleSessions(db, {
      isAlive: () => true,
      maxIdleMs: 24 * 60 * 60 * 1000,
    });

    expect(result.pruned_aged_out).toBe(1);
    expect(result.pruned_dead_pid).toBe(0);
    expect(result.kept_alive).toBe(0);
    expect(result.events[0]?.reason).toBe("aged_out");
    expect(result.events[0]?.age_ms).toBeGreaterThan(24 * 60 * 60 * 1000);
    expect(getSession(db, id)!.status).toBe("disconnected");
  });

  it("prunes NULL-pid legacy rows that exceed maxIdleMs", () => {
    const id = createSession(db, "claude", "legacy-zombie");
    setLastSeen(id, new Date(Date.now() - 48 * 60 * 60 * 1000)); // 48h ago

    const result = pruneStaleSessions(db, {
      isAlive: () => true,
      maxIdleMs: 24 * 60 * 60 * 1000,
    });

    expect(result.pruned_aged_out).toBe(1);
    expect(result.skipped_no_pid_recent).toBe(0);
    expect(getSession(db, id)!.status).toBe("disconnected");
  });

  it("does not prune recent NULL-pid rows even with default threshold", () => {
    const id = createSession(db, "claude", "legacy-recent");

    const result = pruneStaleSessions(db);

    expect(result.skipped_no_pid_recent).toBe(1);
    expect(getSession(db, id)!.status).toBe("active");
  });

  it("uses DEFAULT_PRUNE_MAX_IDLE_MS when maxIdleMs not provided", () => {
    const id = createSession(db, "claude", "default-thresh", 42);
    setLastSeen(id, new Date(Date.now() - DEFAULT_PRUNE_MAX_IDLE_MS - 60_000));

    const result = pruneStaleSessions(db, { isAlive: () => true });

    expect(result.pruned_aged_out).toBe(1);
  });
});

describe("pruneStaleSessions — disabled mode", () => {
  it("returns disabled=true and no-ops when opts.disabled is set", () => {
    const id = createSession(db, "claude", "worker", 42);
    const result = pruneStaleSessions(db, { disabled: true, isAlive: () => false });

    expect(result.disabled).toBe(true);
    expect(result.pruned_dead_pid).toBe(0);
    expect(result.events).toEqual([]);
    expect(getSession(db, id)!.status).toBe("active");
  });
});

describe("pruneStaleSessions — combined sweep", () => {
  it("handles alive+recent, dead-pid, aged-out, and legacy-recent in one sweep", () => {
    const aliveId = createSession(db, "claude", "alive", 1001);
    const deadId = createSession(db, "codex", "dead", 1002);
    const agedId = createSession(db, "gemini", "aged", 1003);
    const legacyId = createSession(db, "opencode", "legacy"); // no pid, recent
    setLastSeen(agedId, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const result = pruneStaleSessions(db, {
      isAlive: (pid) => pid === 1001 || pid === 1003,
      maxIdleMs: 24 * 60 * 60 * 1000,
    });

    expect(result.kept_alive).toBe(1);
    expect(result.pruned_dead_pid).toBe(1);
    expect(result.pruned_aged_out).toBe(1);
    expect(result.skipped_no_pid_recent).toBe(1);
    expect(getSession(db, aliveId)!.status).toBe("active");
    expect(getSession(db, deadId)!.status).toBe("disconnected");
    expect(getSession(db, agedId)!.status).toBe("disconnected");
    expect(getSession(db, legacyId)!.status).toBe("active");
  });
});

describe("pruneStaleSessions — real-process integration", () => {
  it("treats the current process PID as alive (and recent)", () => {
    const id = createSession(db, "claude", "self", process.pid);
    const result = pruneStaleSessions(db);

    expect(result.kept_alive).toBe(1);
    expect(getSession(db, id)!.status).toBe("active");
  });

  it("treats a freshly-reaped child process PID as dead", async () => {
    // Spawn a no-op child, wait for it to exit cleanly, then check that
    // its PID is reported dead. This exercises the actual process.kill
    // syscall against a real recently-dead PID without relying on guessed
    // PID space ceilings.
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    const pid = child.pid!;
    await new Promise<void>((resolve) => child.on("exit", () => resolve()));

    const id = createSession(db, "claude", "reaped-child", pid);
    const result = pruneStaleSessions(db);

    expect(result.pruned_dead_pid).toBe(1);
    expect(getSession(db, id)!.status).toBe("disconnected");
  });
});

describe("pruneStaleSessions — isProcessAlive error semantics", () => {
  it("treats EPERM as alive (process exists, owned by another user)", () => {
    const id = createSession(db, "claude", "other-user", 42);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const e = new Error("EPERM") as NodeJS.ErrnoException;
      e.code = "EPERM";
      throw e;
    });
    try {
      const result = pruneStaleSessions(db);
      expect(result.kept_alive).toBe(1);
      expect(getSession(db, id)!.status).toBe("active");
    } finally {
      killSpy.mockRestore();
    }
  });

  it("treats ESRCH as dead", () => {
    const id = createSession(db, "claude", "missing", 42);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const e = new Error("ESRCH") as NodeJS.ErrnoException;
      e.code = "ESRCH";
      throw e;
    });
    try {
      const result = pruneStaleSessions(db);
      expect(result.pruned_dead_pid).toBe(1);
      expect(getSession(db, id)!.status).toBe("disconnected");
    } finally {
      killSpy.mockRestore();
    }
  });

  it("treats unknown error codes as alive (preserve in sandboxed envs)", () => {
    const id = createSession(db, "claude", "sandbox", 42);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const e = new Error("EACCES") as NodeJS.ErrnoException;
      e.code = "EACCES";
      throw e;
    });
    try {
      const result = pruneStaleSessions(db);
      expect(result.kept_alive).toBe(1);
      expect(getSession(db, id)!.status).toBe("active");
    } finally {
      killSpy.mockRestore();
    }
  });
});

describe("createSession with pid", () => {
  it("stores the pid on insert", () => {
    const id = createSession(db, "claude", "test", 12345);
    expect(getSession(db, id)!.pid).toBe(12345);
  });

  it("stores NULL when pid omitted", () => {
    const id = createSession(db, "claude", "test");
    expect(getSession(db, id)!.pid).toBeNull();
  });
});
