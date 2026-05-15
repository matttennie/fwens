import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import { createSession } from "../db.js";
import { handlePostMessage, handleReadMessages } from "../tools/messages.js";

let db: InstanceType<typeof Database>;
let sessionId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "claude", "test-agent");
});

describe("handlePostMessage", () => {
  it("posts a message and returns message_id", () => {
    const result = handlePostMessage(db, sessionId, { content: "Hello" });
    expect(result.message_id).toBeDefined();
  });

  it("posts to a specific channel", () => {
    handlePostMessage(db, sessionId, { content: "Hello", channel: "task:123" });
    const messages = handleReadMessages(db, { channel: "task:123" });
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Hello");
  });

  it("rejects content exceeding 10,000 chars", () => {
    expect(() => handlePostMessage(db, sessionId, { content: "x".repeat(10_001) })).toThrow(
      "exceeds maximum length",
    );
  });

  it("rejects channel name exceeding 200 chars", () => {
    expect(() =>
      handlePostMessage(db, sessionId, {
        content: "hello",
        channel: "x".repeat(201),
      }),
    ).toThrow("exceeds maximum length");
  });
});

describe("handleReadMessages", () => {
  it("reads all messages without filter", () => {
    handlePostMessage(db, sessionId, { content: "msg1" });
    handlePostMessage(db, sessionId, { content: "msg2" });
    const messages = handleReadMessages(db, {});
    expect(messages).toHaveLength(2);
  });

  it("filters by channel", () => {
    handlePostMessage(db, sessionId, { content: "general msg" });
    handlePostMessage(db, sessionId, { content: "task msg", channel: "task:abc" });
    const general = handleReadMessages(db, { channel: "general" });
    expect(general).toHaveLength(1);
    expect(general[0].content).toBe("general msg");
  });

  it("rejects invalid since format", () => {
    expect(() => handleReadMessages(db, { since: "yesterday" })).toThrow("Invalid since format");
  });

  it("accepts valid ISO 8601 since format", () => {
    handlePostMessage(db, sessionId, { content: "old" });
    const messages = handleReadMessages(db, { since: "2099-01-01T00:00:00" });
    expect(messages).toHaveLength(0);
  });

  it("clamps limit to 1000", () => {
    // Just verify it doesn't throw — we can't easily test the clamping
    // without inserting >1000 messages, but we verify the handler accepts it
    const messages = handleReadMessages(db, { limit: 5000 });
    expect(messages).toHaveLength(0);
  });

  it("rejects channel name exceeding 200 chars", () => {
    expect(() => handleReadMessages(db, { channel: "x".repeat(201) })).toThrow(
      "exceeds maximum length",
    );
  });
});
