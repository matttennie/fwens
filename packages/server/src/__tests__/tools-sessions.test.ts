import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import { createSession, getSession, updateSessionStatus } from "../db.js";
import {
  handleWhoami,
  handleListSessions,
  handleSetLabel,
} from "../tools/sessions.js";

let db: InstanceType<typeof Database>;
let sessionId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "claude", "test-agent");
});

describe("handleWhoami", () => {
  it("returns the current session", () => {
    const session = handleWhoami(db, sessionId);
    expect(session.id).toBe(sessionId);
    expect(session.agent_type).toBe("claude");
    expect(session.label).toBe("test-agent");
    expect(session.status).toBe("active");
  });

  it("throws for non-existent session", () => {
    expect(() =>
      handleWhoami(db, "00000000-0000-0000-0000-000000000000"),
    ).toThrow("Session not found");
  });
});

describe("handleListSessions", () => {
  it("lists all sessions without filter", () => {
    createSession(db, "gemini", "g1");
    const sessions = handleListSessions(db);
    expect(sessions).toHaveLength(2);
  });

  it("filters by status", () => {
    const s2 = createSession(db, "gemini");
    updateSessionStatus(db, s2, "busy");
    const sessions = handleListSessions(db, { status: "busy" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].agent_type).toBe("gemini");
  });

  it("filters by agent_type", () => {
    createSession(db, "gemini");
    const sessions = handleListSessions(db, { agent_type: "claude" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].label).toBe("test-agent");
  });

  it("rejects invalid status", () => {
    expect(() => handleListSessions(db, { status: "bogus" })).toThrow(
      "Invalid status",
    );
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
    expect(() => handleSetLabel(db, sessionId, longLabel)).toThrow(
      "exceeds maximum length",
    );
  });

  it("throws for non-existent session", () => {
    expect(() =>
      handleSetLabel(db, "00000000-0000-0000-0000-000000000000", "label"),
    ).toThrow("Session not found");
  });
});
