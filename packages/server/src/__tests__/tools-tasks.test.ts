import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import { createSession, createTask, claimTask, completeTask } from "../db.js";
import {
  handleCreateTask,
  handleListTasks,
  handleClaimTask,
  handleCompleteTask,
  handleCleanupCompletedTasks,
} from "../tools/tasks.js";

let db: InstanceType<typeof Database>;
let sessionId: string;
const projectRoot = "/project";

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "claude", "test-agent");
});

describe("handleCreateTask", () => {
  it("creates a task and returns task_id", () => {
    const result = handleCreateTask(db, sessionId, { description: "Do something" }, projectRoot);
    expect(result.task_id).toBeDefined();
    expect(typeof result.task_id).toBe("string");
  });

  it("rejects description exceeding 10,000 chars", () => {
    expect(() =>
      handleCreateTask(db, sessionId, { description: "x".repeat(10_001) }, projectRoot),
    ).toThrow("exceeds maximum length");
  });

  it("rejects short_name exceeding 50 chars", () => {
    expect(() =>
      handleCreateTask(
        db,
        sessionId,
        { description: "test", short_name: "x".repeat(51) },
        projectRoot,
      ),
    ).toThrow("exceeds maximum length");
  });

  it("rejects context exceeding 10,000 chars", () => {
    expect(() =>
      handleCreateTask(
        db,
        sessionId,
        { description: "test", context: "x".repeat(10_001) },
        projectRoot,
      ),
    ).toThrow("exceeds maximum length");
  });

  it("rejects invalid assigned_to UUID", () => {
    expect(() =>
      handleCreateTask(
        db,
        sessionId,
        { description: "test", assigned_to: "not-a-uuid" },
        projectRoot,
      ),
    ).toThrow("Invalid UUID");
  });

  it("accepts valid assigned_to UUID", () => {
    const other = createSession(db, "gemini");
    const result = handleCreateTask(
      db,
      sessionId,
      { description: "test", assigned_to: other },
      projectRoot,
    );
    expect(result.task_id).toBeDefined();
  });
});

describe("handleListTasks", () => {
  it("lists all tasks without filter", () => {
    handleCreateTask(db, sessionId, { description: "task 1" }, projectRoot);
    handleCreateTask(db, sessionId, { description: "task 2" }, projectRoot);
    const tasks = handleListTasks(db, sessionId, {});
    expect(tasks).toHaveLength(2);
  });

  it("filters by status", () => {
    const { task_id } = handleCreateTask(db, sessionId, { description: "task" }, projectRoot);
    claimTask(db, task_id, sessionId);
    const open = handleListTasks(db, sessionId, { status: "open" });
    expect(open).toHaveLength(0);
    const inProgress = handleListTasks(db, sessionId, { status: "in_progress" });
    expect(inProgress).toHaveLength(1);
  });

  it("rejects invalid status enum", () => {
    expect(() => handleListTasks(db, sessionId, { status: "bogus" })).toThrow("Invalid status");
  });

  it("rejects invalid assigned_to UUID", () => {
    expect(() => handleListTasks(db, sessionId, { assigned_to: "not-a-uuid" })).toThrow(
      "Invalid UUID",
    );
  });

  it("filters by mine", () => {
    handleCreateTask(db, sessionId, { description: "my task" }, projectRoot);
    const other = createSession(db, "gemini");
    createTask(db, other, { description: "their task" });
    const mine = handleListTasks(db, sessionId, { mine: true });
    expect(mine).toHaveLength(1);
    expect(mine[0].description).toBe("my task");
  });
});

describe("handleClaimTask", () => {
  it("claims an open task", () => {
    const { task_id } = handleCreateTask(db, sessionId, { description: "test" }, projectRoot);
    const task = handleClaimTask(db, sessionId, task_id);
    expect(task.status).toBe("in_progress");
    expect(task.assigned_to).toBe(sessionId);
  });

  it("rejects invalid UUID", () => {
    expect(() => handleClaimTask(db, sessionId, "not-a-uuid")).toThrow("Invalid UUID");
  });

  it("throws for nonexistent task", () => {
    expect(() =>
      handleClaimTask(db, sessionId, "00000000-0000-0000-0000-000000000000"),
    ).toThrow("Task not found");
  });
});

describe("handleCompleteTask", () => {
  let taskId: string;

  beforeEach(() => {
    const result = handleCreateTask(db, sessionId, { description: "test" }, projectRoot);
    taskId = result.task_id;
    claimTask(db, taskId, sessionId);
  });

  it("completes a task with summary", () => {
    const task = handleCompleteTask(
      db,
      sessionId,
      { task_id: taskId, summary: "Done" },
      projectRoot,
    );
    expect(task.status).toBe("done");
    expect(task.summary).toBe("Done");
  });

  it("rejects invalid task_id UUID", () => {
    expect(() =>
      handleCompleteTask(db, sessionId, { task_id: "not-a-uuid", summary: "Done" }, projectRoot),
    ).toThrow("Invalid UUID");
  });

  it("rejects summary exceeding 10,000 chars", () => {
    expect(() =>
      handleCompleteTask(
        db,
        sessionId,
        { task_id: taskId, summary: "x".repeat(10_001) },
        projectRoot,
      ),
    ).toThrow("exceeds maximum length");
  });

  it("rejects path traversal in artifacts", () => {
    expect(() =>
      handleCompleteTask(
        db,
        sessionId,
        { task_id: taskId, summary: "Done", artifacts: ["../../etc/passwd"] },
        projectRoot,
      ),
    ).toThrow("Path traversal");
  });

  it("accepts valid artifact paths", () => {
    const task = handleCompleteTask(
      db,
      sessionId,
      { task_id: taskId, summary: "Done", artifacts: ["src/file.ts"] },
      projectRoot,
    );
    expect(task.status).toBe("done");
  });
});

describe("handleCleanupCompletedTasks", () => {
  it("returns cleanup counts", () => {
    const result = handleCleanupCompletedTasks(db);
    expect(result).toHaveProperty("deleted_tasks");
    expect(result).toHaveProperty("deleted_reviews");
    expect(result).toHaveProperty("deleted_messages");
  });

  it("deletes completed tasks", () => {
    const { task_id } = handleCreateTask(db, sessionId, { description: "test" }, projectRoot);
    claimTask(db, task_id, sessionId);
    completeTask(db, task_id, sessionId, { summary: "done" });

    const result = handleCleanupCompletedTasks(db);
    expect(result.deleted_tasks).toBe(1);
  });
});
