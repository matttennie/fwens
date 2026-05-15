import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import { createSession, getSession, pruneStaleSessions, updateSessionStatus } from "../db.js";

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
});

describe("pruneStaleSessions", () => {
  it("marks sessions with dead PIDs as disconnected", () => {
    const id = createSession(db, "claude", "claude-worker", 42);
    const result = pruneStaleSessions(db, { isAlive: () => false });

    expect(result.pruned).toBe(1);
    expect(result.kept_alive).toBe(0);
    expect(result.skipped_no_pid).toBe(0);
    expect(getSession(db, id)!.status).toBe("disconnected");
  });

  it("keeps sessions whose PIDs are alive", () => {
    const id = createSession(db, "claude", "claude-worker", 42);
    const result = pruneStaleSessions(db, { isAlive: () => true });

    expect(result.pruned).toBe(0);
    expect(result.kept_alive).toBe(1);
    expect(getSession(db, id)!.status).toBe("active");
  });

  it("leaves NULL-pid sessions alone (legacy rows)", () => {
    const id = createSession(db, "claude", "claude-worker");
    const result = pruneStaleSessions(db, { isAlive: () => false });

    expect(result.pruned).toBe(0);
    expect(result.kept_alive).toBe(0);
    expect(result.skipped_no_pid).toBe(1);
    expect(getSession(db, id)!.status).toBe("active");
  });

  it("does not re-touch already-disconnected sessions", () => {
    const id = createSession(db, "claude", "claude-worker", 42);
    updateSessionStatus(db, id, "disconnected");

    const result = pruneStaleSessions(db, { isAlive: () => false });

    expect(result.pruned).toBe(0);
    expect(result.kept_alive).toBe(0);
    expect(result.skipped_no_pid).toBe(0);
  });

  it("handles a mix of alive, dead, and legacy rows in one sweep", () => {
    const aliveId = createSession(db, "claude", "alive", 1001);
    const deadId = createSession(db, "codex", "dead", 1002);
    const legacyId = createSession(db, "gemini", "legacy"); // no pid

    const result = pruneStaleSessions(db, { isAlive: (pid) => pid === 1001 });

    expect(result.pruned).toBe(1);
    expect(result.kept_alive).toBe(1);
    expect(result.skipped_no_pid).toBe(1);
    expect(getSession(db, aliveId)!.status).toBe("active");
    expect(getSession(db, deadId)!.status).toBe("disconnected");
    expect(getSession(db, legacyId)!.status).toBe("active");
  });

  it("real-process check: current PID is reported alive", () => {
    const id = createSession(db, "claude", "self", process.pid);
    const result = pruneStaleSessions(db);

    expect(result.kept_alive).toBe(1);
    expect(getSession(db, id)!.status).toBe("active");
  });

  it("real-process check: an obviously-dead PID is pruned", () => {
    // PIDs are bounded; 2^22 is above the macOS/Linux default ceiling
    // and `kill(pid, 0)` reliably reports ESRCH for it.
    const deadPid = 4_194_303;
    const id = createSession(db, "claude", "ghost", deadPid);

    const result = pruneStaleSessions(db);

    expect(result.pruned).toBe(1);
    expect(getSession(db, id)!.status).toBe("disconnected");
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
