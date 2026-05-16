import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import {
  claimTask,
  completeTask,
  createSession,
  createTask,
  requestReview,
  getReview,
  submitReview,
  respondToReview,
  listReviews,
  getTask,
} from "../db.js";

let db: InstanceType<typeof Database>;
let sessionId: string;
let reviewerId: string;
let taskId: string;
let reviewId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "claude", "author");
  reviewerId = createSession(db, "gemini", "reviewer");
  taskId = createTask(db, sessionId, { description: "Task to review" });
  // Walk the task through the proper lifecycle before requesting review —
  // requestReview now requires status='done'.
  claimTask(db, taskId, sessionId);
  completeTask(db, taskId, sessionId, { summary: "ready for review" });
  reviewId = requestReview(db, taskId, sessionId);
});

describe("submitReview", () => {
  it("sets verdict and findings, updates task to reviewed", () => {
    const review = submitReview(db, reviewId, reviewerId, {
      verdict: "pass",
      findings: "Looks good",
    });
    expect(review.verdict).toBe("pass");
    expect(review.findings).toBe("Looks good");
    expect(review.reviewer).toBe(reviewerId);

    const task = getTask(db, taskId);
    expect(task!.status).toBe("reviewed");
  });

  it("throws for non-existent review", () => {
    expect(() =>
      submitReview(db, "00000000-0000-0000-0000-000000000000", reviewerId, {
        verdict: "pass",
        findings: "ok",
      }),
    ).toThrow("Review not found");
  });
});

describe("respondToReview", () => {
  beforeEach(() => {
    submitReview(db, reviewId, reviewerId, {
      verdict: "needs_changes",
      findings: "Fix the bug",
    });
  });

  it("adds a response to the review when called by the worker", () => {
    const updated = respondToReview(db, reviewId, sessionId, "Fixed the bug");
    expect(updated.response).toBe("Fixed the bug");
  });

  it("rejects a response from a session that is neither assignee nor creator", () => {
    const stranger = createSession(db, "codex", "stranger");
    expect(() => respondToReview(db, reviewId, stranger, "I do not belong here")).toThrow(
      "Only the task's assignee or creator can respond",
    );
  });
});

describe("review authorization", () => {
  it("requestReview rejects callers who are neither assignee nor creator", () => {
    const t2 = createTask(db, sessionId, { description: "another" });
    claimTask(db, t2, sessionId);
    completeTask(db, t2, sessionId, { summary: "done" });
    const stranger = createSession(db, "codex", "stranger");
    expect(() => requestReview(db, t2, stranger)).toThrow(
      "Only the task's assignee or creator can request a review",
    );
  });

  it("submitReview rejects the assignee but permits the creator", () => {
    // Reassign the task to a worker, then have that worker try to self-review.
    const worker = createSession(db, "codex", "worker");
    const t2 = createTask(db, sessionId, { description: "delegated", assigned_to: worker });
    claimTask(db, t2, worker);
    completeTask(db, t2, worker, { summary: "done" });
    const rev = requestReview(db, t2, worker);

    expect(() => submitReview(db, rev, worker, { verdict: "pass", findings: "self" })).toThrow(
      "Cannot submit a review on a task assigned to yourself",
    );

    // The creator (orchestrator) is allowed to review.
    const result = submitReview(db, rev, sessionId, { verdict: "pass", findings: "approved" });
    expect(result.verdict).toBe("pass");
    expect(result.reviewer).toBe(sessionId);
  });
});

describe("listReviews", () => {
  let taskId2: string;
  let reviewId2: string;

  beforeEach(() => {
    taskId2 = createTask(db, sessionId, { description: "Another task" });
    claimTask(db, taskId2, sessionId);
    completeTask(db, taskId2, sessionId, { summary: "also ready" });
    reviewId2 = requestReview(db, taskId2, sessionId);
  });

  it("lists all reviews without filter", () => {
    expect(listReviews(db)).toHaveLength(2);
  });

  it("filters by task_id", () => {
    const reviews = listReviews(db, { task_id: taskId });
    expect(reviews).toHaveLength(1);
    expect(reviews[0].task_id).toBe(taskId);
  });

  it("filters by pending (verdict IS NULL)", () => {
    submitReview(db, reviewId, reviewerId, {
      verdict: "pass",
      findings: "ok",
    });
    const pending = listReviews(db, { pending: true });
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(reviewId2);
  });

  it("filters by mine (reviewer)", () => {
    submitReview(db, reviewId, reviewerId, {
      verdict: "pass",
      findings: "ok",
    });
    const mine = listReviews(db, { mine: reviewerId });
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(reviewId);
  });
});

describe("submitReview — verdict routing (state machine)", () => {
  it("verdict='pass' moves task to 'reviewed'", () => {
    submitReview(db, reviewId, reviewerId, { verdict: "pass", findings: "ok" });
    expect(getTask(db, taskId)!.status).toBe("reviewed");
  });

  it("verdict='fail' moves task to 'reviewed'", () => {
    submitReview(db, reviewId, reviewerId, { verdict: "fail", findings: "wrong" });
    expect(getTask(db, taskId)!.status).toBe("reviewed");
  });

  it("verdict='needs_changes' sends task back to 'in_progress', NOT 'reviewed'", () => {
    submitReview(db, reviewId, reviewerId, {
      verdict: "needs_changes",
      findings: "fix the edge case",
    });
    const task = getTask(db, taskId)!;
    expect(task.status).toBe("in_progress");
    expect(task.status).not.toBe("reviewed");
  });
});

describe("requestReview — lifecycle precondition", () => {
  it("throws when called on an open task", () => {
    const openTaskId = createTask(db, sessionId, { description: "still open" });
    expect(() => requestReview(db, openTaskId, sessionId)).toThrow("task must be 'done' first");
  });

  it("throws when called on an in_progress task", () => {
    const t = createTask(db, sessionId, { description: "in flight" });
    claimTask(db, t, sessionId);
    expect(() => requestReview(db, t, sessionId)).toThrow("task must be 'done' first");
  });

  it("throws when task does not exist", () => {
    expect(() => requestReview(db, "00000000-0000-0000-0000-000000000000", sessionId)).toThrow(
      "Task not found",
    );
  });
});
