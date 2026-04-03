import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import {
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
  it("adds a response to the review", () => {
    submitReview(db, reviewId, reviewerId, {
      verdict: "needs_changes",
      findings: "Fix the bug",
    });
    const updated = respondToReview(db, reviewId, "Fixed the bug");
    expect(updated.response).toBe("Fixed the bug");
  });
});

describe("listReviews", () => {
  let taskId2: string;
  let reviewId2: string;

  beforeEach(() => {
    taskId2 = createTask(db, sessionId, { description: "Another task" });
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
