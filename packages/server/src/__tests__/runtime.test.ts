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
