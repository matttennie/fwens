import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import {
  createSession,
  createTask,
  getTask,
  listTasks,
  claimTask,
  completeTask,
  requestReview,
  getSession,
  getReview,
} from "../db.js";

let db: InstanceType<typeof Database>;
let sessionId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "claude", "worker");
});

describe("task creation", () => {
  it("creates a task with required fields", () => {
    const id = createTask(db, sessionId, { description: "Do the thing" });
    const task = getTask(db, id);
    expect(task).toBeDefined();
    expect(task!.description).toBe("Do the thing");
    expect(task!.status).toBe("open");
    expect(task!.created_by).toBe(sessionId);
    expect(task!.context).toBeNull();
    expect(task!.assigned_to).toBeNull();
  });

  it("creates a task with optional fields", () => {
    const other = createSession(db, "gemini");
    const id = createTask(db, sessionId, {
      description: "Task with extras",
      context: "some context",
      assigned_to: other,
    });
    const task = getTask(db, id);
    expect(task!.context).toBe("some context");
    expect(task!.assigned_to).toBe(other);
  });

  it("returns undefined for non-existent task", () => {
    expect(getTask(db, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });
});

describe("task listing", () => {
  let taskA: string;
  let taskB: string;
  let otherSession: string;

  beforeEach(() => {
    otherSession = createSession(db, "gemini");
    taskA = createTask(db, sessionId, { description: "Task A" });
    taskB = createTask(db, otherSession, {
      description: "Task B",
      assigned_to: sessionId,
    });
  });

  it("lists all tasks without filter", () => {
    expect(listTasks(db)).toHaveLength(2);
  });

  it("filters by status", () => {
    claimTask(db, taskA, sessionId);
    const inProgress = listTasks(db, { status: "in_progress" });
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0].id).toBe(taskA);
  });

  it("filters by assigned_to", () => {
    const assigned = listTasks(db, { assigned_to: sessionId });
    expect(assigned).toHaveLength(1);
    expect(assigned[0].id).toBe(taskB);
  });

  it("filters by mine (created_by)", () => {
    const mine = listTasks(db, { mine: sessionId });
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(taskA);
  });
});

describe("claimTask", () => {
  it("sets task to in_progress and session to busy", () => {
    const taskId = createTask(db, sessionId, { description: "Claim me" });
    const claimedTask = claimTask(db, taskId, sessionId);
    expect(claimedTask.status).toBe("in_progress");
    expect(claimedTask.assigned_to).toBe(sessionId);

    const session = getSession(db, sessionId);
    expect(session!.status).toBe("busy");
  });

  it("throws if task is not open", () => {
    const taskId = createTask(db, sessionId, { description: "Claim me" });
    claimTask(db, taskId, sessionId);
    const other = createSession(db, "gemini");
    expect(() => claimTask(db, taskId, other)).toThrow("is not open");
  });

  it("throws if task does not exist", () => {
    expect(() =>
      claimTask(db, "00000000-0000-0000-0000-000000000000", sessionId),
    ).toThrow("Task not found");
  });
});

describe("completeTask", () => {
  it("sets task to done with summary and artifacts", () => {
    const taskId = createTask(db, sessionId, { description: "Complete me" });
    claimTask(db, taskId, sessionId);
    const completed = completeTask(db, taskId, sessionId, {
      summary: "All done",
      artifacts: ["file1.ts", "file2.ts"],
    });
    expect(completed.status).toBe("done");
    expect(completed.summary).toBe("All done");
    expect(JSON.parse(completed.artifacts!)).toEqual(["file1.ts", "file2.ts"]);

    const session = getSession(db, sessionId);
    expect(session!.status).toBe("idle");
  });

  it("handles completion without artifacts", () => {
    const taskId = createTask(db, sessionId, { description: "No artifacts" });
    claimTask(db, taskId, sessionId);
    const completed = completeTask(db, taskId, sessionId, {
      summary: "Done without artifacts",
    });
    expect(completed.artifacts).toBeNull();
  });
});

describe("requestReview", () => {
  it("sets task to review_requested and creates a review", () => {
    const taskId = createTask(db, sessionId, { description: "Review me" });
    const reviewId = requestReview(db, taskId, sessionId, "check quality");

    const task = getTask(db, taskId);
    expect(task!.status).toBe("review_requested");

    const review = getReview(db, reviewId);
    expect(review).toBeDefined();
    expect(review!.task_id).toBe(taskId);
    expect(review!.reviewer).toBe(sessionId);
    expect(review!.findings).toBe("check quality");
    expect(review!.verdict).toBeNull();
  });

  it("creates review without rubric", () => {
    const taskId = createTask(db, sessionId, { description: "Review me" });
    const reviewId = requestReview(db, taskId, sessionId);
    const review = getReview(db, reviewId);
    expect(review!.findings).toBeNull();
  });
});
