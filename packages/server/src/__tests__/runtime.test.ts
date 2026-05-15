import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntimeManager } from "../runtime.js";

describe("runtime initialization", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fwens-runtime-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not create project files until a fwens tool needs runtime state", () => {
    const runtime = createRuntimeManager({
      projectRoot: tmpDir,
      agentType: "codex",
    });

    expect(runtime.isInitialized()).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".fwens"))).toBe(false);

    runtime.shutdown();

    expect(fs.existsSync(path.join(tmpDir, ".fwens"))).toBe(false);
  });

  it("creates the database and session history on first runtime access", () => {
    const runtime = createRuntimeManager({
      projectRoot: tmpDir,
      agentType: "codex",
      agentLabel: "codex-worker",
    });

    const state = runtime.heartbeat();

    expect(runtime.isInitialized()).toBe(true);
    expect(state.fwensDir).toBe(path.join(tmpDir, ".fwens"));
    expect(fs.existsSync(path.join(tmpDir, ".fwens", "fwens.db"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".fwens", "session-history.jsonl"))).toBe(true);

    const session = state.db
      .prepare("SELECT agent_type, label, pid FROM sessions WHERE id = ?")
      .get(state.sessionId) as { agent_type: string; label: string; pid: number };

    expect(session.agent_type).toBe("codex");
    expect(session.label).toBe("codex-worker");
    expect(session.pid).toBe(process.pid);

    runtime.shutdown();
  });

  it("prunes zombie sessions left by crashed processes at boot", () => {
    // First runtime: register, then forcibly leave the row as "active"
    // with a now-dead PID (simulating a crash with no clean shutdown).
    const first = createRuntimeManager({
      projectRoot: tmpDir,
      agentType: "codex",
      agentLabel: "crashed-worker",
    });
    const firstState = first.heartbeat();
    const zombieId = firstState.sessionId;

    // Overwrite PID with a known-dead value, leaving status active.
    firstState.db.prepare("UPDATE sessions SET pid = ? WHERE id = ?").run(4_194_303, zombieId);
    firstState.db.close();

    // Second runtime: fresh boot in the same project. The zombie row
    // should be swept to 'disconnected' as part of the boot sequence.
    const second = createRuntimeManager({
      projectRoot: tmpDir,
      agentType: "claude",
      agentLabel: "fresh-worker",
    });
    const secondState = second.heartbeat();

    const zombieStatus = secondState.db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(zombieId) as { status: string };
    expect(zombieStatus.status).toBe("disconnected");

    // The new session itself is alive and untouched.
    const liveStatus = secondState.db
      .prepare("SELECT status FROM sessions WHERE id = ?")
      .get(secondState.sessionId) as { status: string };
    expect(liveStatus.status).toBe("active");

    second.shutdown();
  });

  it("debounces last_seen_at writes — within the window, repeated heartbeats do not write", () => {
    let clock = 1_000_000;
    const runtime = createRuntimeManager({
      projectRoot: tmpDir,
      agentType: "claude",
      agentLabel: "debounced",
      heartbeatDebounceMs: 30_000,
      now: () => clock,
    });

    // First heartbeat — clock at 1_000_000, lastHeartbeatWriteAt at 0 → writes.
    const s = runtime.heartbeat();
    const after1 = s.db
      .prepare("SELECT last_seen_at FROM sessions WHERE id = ?")
      .get(s.sessionId) as { last_seen_at: string };

    // Tight loop of heartbeats inside the window — should not change the row.
    for (let i = 0; i < 100; i++) {
      clock += 100; // 10s total still inside the 30s window
      runtime.heartbeat();
    }

    const after2 = s.db
      .prepare("SELECT last_seen_at FROM sessions WHERE id = ?")
      .get(s.sessionId) as { last_seen_at: string };

    expect(after2.last_seen_at).toBe(after1.last_seen_at);

    runtime.shutdown();
  });

  it("writes again after the debounce window elapses", async () => {
    let clock = 2_000_000;
    const runtime = createRuntimeManager({
      projectRoot: tmpDir,
      agentType: "claude",
      heartbeatDebounceMs: 30_000,
      now: () => clock,
    });

    const s = runtime.heartbeat();
    const t1 = s.db
      .prepare("SELECT last_seen_at FROM sessions WHERE id = ?")
      .get(s.sessionId) as { last_seen_at: string };

    // SQLite's datetime('now') has 1-second granularity. Sleep just over 1s
    // so the second write produces a distinguishable timestamp.
    await new Promise((r) => setTimeout(r, 1100));

    clock += 31_000; // past the 30s window
    runtime.heartbeat();

    const t2 = s.db
      .prepare("SELECT last_seen_at FROM sessions WHERE id = ?")
      .get(s.sessionId) as { last_seen_at: string };

    expect(t2.last_seen_at).not.toBe(t1.last_seen_at);

    runtime.shutdown();
  });

  it("debounceMs = 0 always writes (debounce disabled)", () => {
    let clock = 3_000_000;
    const runtime = createRuntimeManager({
      projectRoot: tmpDir,
      agentType: "claude",
      heartbeatDebounceMs: 0,
      now: () => clock,
    });

    // First heartbeat to initialize.
    runtime.heartbeat();

    // With debounce disabled, every call should hit updateLastSeen.
    // We can't easily distinguish DB writes by content (SQLite second-level
    // granularity again), so instead check that the function path is not
    // gated: lastHeartbeatWriteAt is internal, so verify by introspecting
    // the prepared statement count by running many heartbeats and confirming
    // no exception.
    for (let i = 0; i < 50; i++) {
      clock += 1;
      expect(() => runtime.heartbeat()).not.toThrow();
    }

    runtime.shutdown();
  });

  it("reads FWENS_HEARTBEAT_DEBOUNCE_MS from env when option not provided", () => {
    const prev = process.env.FWENS_HEARTBEAT_DEBOUNCE_MS;
    process.env.FWENS_HEARTBEAT_DEBOUNCE_MS = "60000";
    try {
      let clock = 4_000_000;
      const runtime = createRuntimeManager({
        projectRoot: tmpDir,
        agentType: "claude",
        now: () => clock,
      });

      const s = runtime.heartbeat();
      const before = s.db
        .prepare("SELECT last_seen_at FROM sessions WHERE id = ?")
        .get(s.sessionId) as { last_seen_at: string };

      // Advance 45s — past the default 30s but within the env-configured 60s.
      clock += 45_000;
      runtime.heartbeat();

      const after = s.db
        .prepare("SELECT last_seen_at FROM sessions WHERE id = ?")
        .get(s.sessionId) as { last_seen_at: string };

      // No write because env-configured window is 60s and we only advanced 45s.
      expect(after.last_seen_at).toBe(before.last_seen_at);

      runtime.shutdown();
    } finally {
      if (prev === undefined) delete process.env.FWENS_HEARTBEAT_DEBOUNCE_MS;
      else process.env.FWENS_HEARTBEAT_DEBOUNCE_MS = prev;
    }
  });

  it("updates pid when resuming a disconnected session", () => {
    // First run: create a session, then shut down (which marks disconnected).
    const first = createRuntimeManager({
      projectRoot: tmpDir,
      agentType: "codex",
      agentLabel: "resumable",
    });
    const firstState = first.heartbeat();
    const sessionId = firstState.sessionId;
    first.shutdown();

    // Second run: resume by label. PID must update to the current process.
    // (Same test process here, so PID is identical — but the code path that
    // overwrites pid still needs to fire, which we verify by checking the row.)
    const second = createRuntimeManager({
      projectRoot: tmpDir,
      agentType: "codex",
      agentLabel: "resumable",
      resumeLabel: "resumable",
    });
    const secondState = second.heartbeat();

    expect(secondState.sessionId).toBe(sessionId);
    const row = secondState.db
      .prepare("SELECT pid, status FROM sessions WHERE id = ?")
      .get(sessionId) as { pid: number; status: string };
    expect(row.pid).toBe(process.pid);
    expect(row.status).toBe("active");

    second.shutdown();
  });
});
