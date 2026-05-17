import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import { createSession, getSession, updateSessionStatus } from "../db.js";
import {
  handleWhoami,
  handleListSessions,
  handleSetLabel,
  handleUpdateStatus,
  handlePruneSessions,
} from "../tools/sessions.js";

let db: InstanceType<typeof Database>;
let sessionId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "test-agent");
});

describe("handleWhoami", () => {
  it("returns the current session", () => {
    const session = handleWhoami(db, sessionId);
    expect(session.id).toBe(sessionId);
    expect(session.label).toBe("test-agent");
    expect(session.status).toBe("active");
  });

  it("throws for non-existent session", () => {
    expect(() => handleWhoami(db, "00000000-0000-0000-0000-000000000000")).toThrow(
      "Session not found",
    );
  });
});

describe("handleListSessions", () => {
  it("lists all sessions without filter", () => {
    createSession(db, "g1");
    const sessions = handleListSessions(db);
    expect(sessions).toHaveLength(2);
  });

  it("is idempotent — does not mutate session state (read-shaped)", () => {
    // Even when a session has a dead PID, list_sessions must not prune it;
    // that's now the exclusive job of prune_sessions.
    const ghostId = createSession(db, "ghost", 42);
    const beforeStatus = getSession(db, ghostId)!.status;

    handleListSessions(db);

    expect(getSession(db, ghostId)!.status).toBe(beforeStatus);
  });

  it("filters by status", () => {
    const s2 = createSession(db, "busy-one");
    updateSessionStatus(db, s2, "busy");
    const sessions = handleListSessions(db, { status: "busy" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].label).toBe("busy-one");
  });

  it("rejects invalid status", () => {
    expect(() => handleListSessions(db, { status: "bogus" })).toThrow("Invalid status");
  });
});

describe("handleSetLabel", () => {
  it("updates the session label", () => {
    const session = handleSetLabel(db, sessionId, "new-label");
    expect(session.label).toBe("new-label");
  });

  it("persists the label change", () => {
    handleSetLabel(db, sessionId, "persisted");
    const session = getSession(db, sessionId);
    expect(session!.label).toBe("persisted");
  });

  it("rejects labels exceeding 200 chars", () => {
    const longLabel = "x".repeat(201);
    expect(() => handleSetLabel(db, sessionId, longLabel)).toThrow("exceeds maximum length");
  });

  it("throws for non-existent session", () => {
    expect(() => handleSetLabel(db, "00000000-0000-0000-0000-000000000000", "label")).toThrow(
      "Session not found",
    );
  });
});

describe("handleUpdateStatus", () => {
  it("updates status to busy", () => {
    const session = handleUpdateStatus(db, sessionId, { status: "busy" });
    expect(session.status).toBe("busy");
  });

  it("updates status to idle", () => {
    const session = handleUpdateStatus(db, sessionId, { status: "idle" });
    expect(session.status).toBe("idle");
  });

  it("updates status to stuck", () => {
    const session = handleUpdateStatus(db, sessionId, { status: "stuck" });
    expect(session.status).toBe("stuck");
  });

  it("rejects invalid status", () => {
    expect(() => handleUpdateStatus(db, sessionId, { status: "disconnected" })).toThrow(
      "Invalid status",
    );
  });

  it("rejects completely bogus status", () => {
    expect(() => handleUpdateStatus(db, sessionId, { status: "sleeping" })).toThrow(
      "Invalid status",
    );
  });

  it("accumulates tokens_used", () => {
    handleUpdateStatus(db, sessionId, { tokens_used: 1000 });
    handleUpdateStatus(db, sessionId, { tokens_used: 500 });
    const session = getSession(db, sessionId);
    expect(session!.tokens_used).toBe(1500);
  });

  it("updates status and tokens together", () => {
    const session = handleUpdateStatus(db, sessionId, { status: "busy", tokens_used: 2000 });
    expect(session.status).toBe("busy");
    expect(session.tokens_used).toBe(2000);
  });
});

describe("handlePruneSessions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fwens-prune-handler-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prunes sessions with dead PIDs and writes audit events to prune-events.jsonl", () => {
    // Spawn-and-reap a child to get a real dead PID.
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const child = spawnSync(process.execPath, ["-e", ""]);
    const deadPid = child.pid!;

    const ghostId = createSession(db, "ghost", deadPid);

    const result = handlePruneSessions(db, tmpDir);

    expect(result.pruned_dead_pid).toBeGreaterThanOrEqual(1);
    expect(getSession(db, ghostId)!.status).toBe("disconnected");

    const logPath = path.join(tmpDir, "prune-events.jsonl");
    expect(fs.existsSync(logPath)).toBe(true);
    const logged = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(logged.some((e) => e.session_id === ghostId && e.reason === "dead_pid")).toBe(true);
  });

  it("writes nothing to the log file when no sessions are pruned", () => {
    createSession(db, "alive", process.pid);

    handlePruneSessions(db, tmpDir);

    const logPath = path.join(tmpDir, "prune-events.jsonl");
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("tolerates an unwritable fwensDir without throwing", () => {
    createSession(db, "ghost", 42);
    // Mock a non-existent path; the catch block should swallow.
    expect(() =>
      handlePruneSessions(db, "/nonexistent/path/that/cannot/be/created/by/this/test"),
    ).not.toThrow();
  });
});
