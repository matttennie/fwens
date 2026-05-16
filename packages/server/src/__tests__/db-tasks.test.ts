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
  cleanupCompletedTasks,
  requestReview,
  getSession,
  getReview,
  postMessage,
  readMessages,
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
    expect(() => claimTask(db, "00000000-0000-0000-0000-000000000000", sessionId)).toThrow(
      "Task not found",
    );
  });

  it("refuses to claim a task assigned to another active session", () => {
    const other = createSession(db, "gemini");
    const taskId = createTask(db, sessionId, {
      description: "Owned by other",
      assigned_to: other,
    });
    expect(() => claimTask(db, taskId, sessionId)).toThrow("assigned to another active session");
  });

  it("allows claiming a task assigned to a disconnected session (reassignment)", () => {
    const ghost = createSession(db, "gemini");
    const taskId = createTask(db, sessionId, {
      description: "Stranded by crash",
      assigned_to: ghost,
    });
    db.prepare(`UPDATE sessions SET status = 'disconnected' WHERE id = ?`).run(ghost);

    const claimed = claimTask(db, taskId, sessionId);
    expect(claimed.assigned_to).toBe(sessionId);
    expect(claimed.status).toBe("in_progress");
  });

  it("atomic claim: a second claimer fails when the first already won", () => {
    // Same-process simulation of the multi-process race. The first claim
    // changes the row; the second call must see no rows match and throw.
    const a = createSession(db, "claude", "a");
    const b = createSession(db, "gemini", "b");
    const taskId = createTask(db, sessionId, { description: "race" });

    claimTask(db, taskId, a);
    expect(() => claimTask(db, taskId, b)).toThrow("is not open");
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
    expect(completed.artifacts).toEqual(["file1.ts", "file2.ts"]);

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

  it("refuses to complete an open task (not yet claimed)", () => {
    const taskId = createTask(db, sessionId, { description: "still open" });
    expect(() => completeTask(db, taskId, sessionId, { summary: "x" })).toThrow(
      "cannot be completed from status 'open'",
    );
  });

  it("refuses to complete a task that is not yours and not yours to manage", () => {
    const other = createSession(db, "gemini");
    const taskId = createTask(db, sessionId, {
      description: "owned by other",
      assigned_to: other,
    });
    claimTask(db, taskId, other);

    const stranger = createSession(db, "codex");
    expect(() => completeTask(db, taskId, stranger, { summary: "not mine" })).toThrow(
      "can only be completed by its assignee or creator",
    );
  });

  it("allows the creator to complete (even if not the assignee)", () => {
    const worker = createSession(db, "gemini");
    const taskId = createTask(db, sessionId, {
      description: "creator can rescue",
      assigned_to: worker,
    });
    claimTask(db, taskId, worker);

    const completed = completeTask(db, taskId, sessionId, { summary: "rescued" });
    expect(completed.status).toBe("done");
  });
});

describe("cleanupCompletedTasks", () => {
  it("deletes terminal tasks and their task-scoped reviews/messages", () => {
    const doneTask = createTask(db, sessionId, { description: "Done task" });
    claimTask(db, doneTask, sessionId);
    completeTask(db, doneTask, sessionId, { summary: "Done" });
    postMessage(db, sessionId, {
      channel: `task:${doneTask}`,
      content: "Done task message",
    });

    const reviewedTask = createTask(db, sessionId, {
      description: "Reviewed task",
    });
    claimTask(db, reviewedTask, sessionId);
    completeTask(db, reviewedTask, sessionId, { summary: "Ready" });
    const reviewId = requestReview(db, reviewedTask, sessionId);
    db.prepare(`UPDATE reviews SET verdict = 'pass', findings = 'Looks good' WHERE id = ?`).run(
      reviewId,
    );
    db.prepare(`UPDATE tasks SET status = 'reviewed' WHERE id = ?`).run(reviewedTask);
    postMessage(db, sessionId, {
      channel: `task:${reviewedTask}`,
      content: "Reviewed task message",
    });

    const cancelledTask = createTask(db, sessionId, {
      description: "Cancelled task",
    });
    db.prepare(`UPDATE tasks SET status = 'cancelled' WHERE id = ?`).run(cancelledTask);

    const result = cleanupCompletedTasks(db);

    expect(result).toEqual({
      deleted_tasks: 3,
      deleted_reviews: 1,
      deleted_messages: 2,
    });
    expect(getTask(db, doneTask)).toBeUndefined();
    expect(getTask(db, reviewedTask)).toBeUndefined();
    expect(getTask(db, cancelledTask)).toBeUndefined();
    expect(getReview(db, reviewId)).toBeUndefined();
    expect(readMessages(db, { channel: `task:${doneTask}` })).toHaveLength(0);
    expect(readMessages(db, { channel: `task:${reviewedTask}` })).toHaveLength(0);
  });

  it("preserves unfinished tasks", () => {
    const openTask = createTask(db, sessionId, { description: "Open task" });

    const inProgressTask = createTask(db, sessionId, {
      description: "In-progress task",
    });
    claimTask(db, inProgressTask, sessionId);

    const reviewRequestedTask = createTask(db, sessionId, {
      description: "Review requested task",
    });
    claimTask(db, reviewRequestedTask, sessionId);
    completeTask(db, reviewRequestedTask, sessionId, { summary: "Ready" });
    const reviewId = requestReview(db, reviewRequestedTask, sessionId);

    const result = cleanupCompletedTasks(db);

    expect(result).toEqual({
      deleted_tasks: 0,
      deleted_reviews: 0,
      deleted_messages: 0,
    });
    expect(getTask(db, openTask)!.status).toBe("open");
    expect(getTask(db, inProgressTask)!.status).toBe("in_progress");
    expect(getTask(db, reviewRequestedTask)!.status).toBe("review_requested");
    expect(getReview(db, reviewId)).toBeDefined();
  });
});

describe("requestReview", () => {
  it("sets task to review_requested and creates a review", () => {
    const taskId = createTask(db, sessionId, { description: "Review me" });
    claimTask(db, taskId, sessionId);
    completeTask(db, taskId, sessionId, { summary: "ready" });
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
    claimTask(db, taskId, sessionId);
    completeTask(db, taskId, sessionId, { summary: "ready" });
    const reviewId = requestReview(db, taskId, sessionId);
    const review = getReview(db, reviewId);
    expect(review!.findings).toBeNull();
  });
});
