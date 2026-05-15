import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import { createSession, createTask, getTask, postMessage, readMessages } from "../db.js";
import { validateUuid, validatePath, validateStringLength } from "../validation.js";

let db: InstanceType<typeof Database>;
let sessionId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "claude", "security-test");
});

// ---------------------------------------------------------------------------
// SQL injection prevention
// ---------------------------------------------------------------------------

describe("SQL injection prevention", () => {
  it("stores a task description containing DROP TABLE as literal text", () => {
    const malicious = "'; DROP TABLE tasks; --";
    const taskId = createTask(db, sessionId, { description: malicious });

    // The tasks table must still exist and contain the row
    const count = db.prepare("SELECT COUNT(*) AS cnt FROM tasks").get() as { cnt: number };
    expect(count.cnt).toBeGreaterThanOrEqual(1);

    const task = getTask(db, taskId);
    expect(task).toBeDefined();
    expect(task!.description).toBe(malicious);
  });

  it("stores a message with Bobby Tables payload safely", () => {
    const malicious = "Robert'); DROP TABLE messages;--";
    const msgId = postMessage(db, sessionId, { content: malicious });

    // The messages table must still exist
    const count = db.prepare("SELECT COUNT(*) AS cnt FROM messages").get() as { cnt: number };
    expect(count.cnt).toBeGreaterThanOrEqual(1);

    const messages = readMessages(db);
    const stored = messages.find((m) => m.id === msgId);
    expect(stored).toBeDefined();
    expect(stored!.content).toBe(malicious);
  });

  describe("UUID validation blocks SQL injection payloads", () => {
    it("rejects DROP TABLE in UUID position", () => {
      expect(() => validateUuid("1; DROP TABLE tasks")).toThrow("Invalid UUID");
    });

    it("rejects OR tautology in UUID position", () => {
      expect(() => validateUuid("' OR '1'='1")).toThrow("Invalid UUID");
    });

    it("rejects UNION SELECT in UUID position", () => {
      expect(() => validateUuid("1 UNION SELECT * FROM sessions")).toThrow("Invalid UUID");
    });
  });
});

// ---------------------------------------------------------------------------
// Path traversal prevention
// ---------------------------------------------------------------------------

describe("path traversal prevention", () => {
  const projectRoot = "/project";

  it("blocks ../../etc/passwd traversal", () => {
    expect(() => validatePath("../../etc/passwd", projectRoot)).toThrow("Path traversal detected");
  });

  it("blocks absolute /etc/shadow outside project", () => {
    expect(() => validatePath("/etc/shadow", projectRoot)).toThrow("Path traversal detected");
  });

  it("allows a legitimate nested path within the project", () => {
    const result = validatePath("src/deep/file.ts", projectRoot);
    expect(result).toContain("src/deep/file.ts");
  });
});

// ---------------------------------------------------------------------------
// Input length enforcement
// ---------------------------------------------------------------------------

describe("input length enforcement", () => {
  it("rejects a string of 10,001 chars against a 10,000 limit", () => {
    const oversized = "x".repeat(10_001);
    expect(() => validateStringLength(oversized, 10_000, "description")).toThrow(
      "exceeds maximum length of 10000",
    );
  });

  it("rejects a string of 50,001 chars against a 50,000 limit", () => {
    const oversized = "x".repeat(50_001);
    expect(() => validateStringLength(oversized, 50_000, "content")).toThrow(
      "exceeds maximum length of 50000",
    );
  });

  it("accepts a string of exactly 10,000 chars", () => {
    const exact = "x".repeat(10_000);
    expect(validateStringLength(exact, 10_000, "description")).toBe(exact);
  });
});
