import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import {
  createSession,
  createTask,
  claimTask,
  completeTask,
  postMessage,
  requestReview,
} from "../db.js";
import { handleGetContext } from "../tools/context.js";

let db: InstanceType<typeof Database>;
let sessionId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "claude", "test-agent");
});

describe("handleGetContext", () => {
  it("returns task details, reviews, and messages", () => {
    const taskId = createTask(db, sessionId, { description: "Test task" });
    claimTask(db, taskId, sessionId);
    completeTask(db, taskId, sessionId, { summary: "Done" });
    requestReview(db, taskId, sessionId, "Check it");
    postMessage(db, sessionId, { channel: `task:${taskId}`, content: "Note" });

    const ctx = handleGetContext(db, taskId);
    expect(ctx.task.id).toBe(taskId);
    expect(ctx.task.status).toBe("review_requested");
    expect(ctx.reviews).toHaveLength(1);
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].content).toBe("Note");
  });

  it("returns empty reviews and messages for a fresh task", () => {
    const taskId = createTask(db, sessionId, { description: "Fresh task" });
    const ctx = handleGetContext(db, taskId);
    expect(ctx.task.id).toBe(taskId);
    expect(ctx.reviews).toHaveLength(0);
    expect(ctx.messages).toHaveLength(0);
  });

  it("rejects invalid UUID", () => {
    expect(() => handleGetContext(db, "not-a-uuid")).toThrow("Invalid UUID");
  });

  it("throws for nonexistent task", () => {
    expect(() => handleGetContext(db, "00000000-0000-0000-0000-000000000000")).toThrow(
      "Task not found",
    );
  });
});
