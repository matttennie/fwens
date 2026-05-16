import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import { createSession, createTask, claimTask, completeTask } from "../db.js";
import {
  handleRequestReview,
  handleListReviews,
  handleSubmitReview,
  handleRespondToReview,
} from "../tools/reviews.js";

let db: InstanceType<typeof Database>;
let sessionId: string;
let otherSessionId: string;
let taskId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "claude", "test-agent");
  otherSessionId = createSession(db, "gemini", "reviewer");
  taskId = createTask(db, sessionId, { description: "Test task" });
  claimTask(db, taskId, sessionId);
  completeTask(db, taskId, sessionId, { summary: "Done" });
});

describe("handleRequestReview", () => {
  it("creates a review and returns review_id", () => {
    const result = handleRequestReview(db, sessionId, { task_id: taskId });
    expect(result.review_id).toBeDefined();
  });

  it("accepts optional rubric", () => {
    const result = handleRequestReview(db, sessionId, {
      task_id: taskId,
      rubric: "Check for correctness",
    });
    expect(result.review_id).toBeDefined();
  });

  it("rejects invalid task_id UUID", () => {
    expect(() => handleRequestReview(db, sessionId, { task_id: "not-a-uuid" })).toThrow(
      "Invalid UUID",
    );
  });

  it("rejects rubric exceeding 10,000 chars", () => {
    expect(() =>
      handleRequestReview(db, sessionId, {
        task_id: taskId,
        rubric: "x".repeat(10_001),
      }),
    ).toThrow("exceeds maximum length");
  });
});

describe("handleListReviews", () => {
  it("lists all reviews", () => {
    handleRequestReview(db, sessionId, { task_id: taskId });
    const reviews = handleListReviews(db, sessionId, {});
    expect(reviews).toHaveLength(1);
  });

  it("filters by task_id", () => {
    handleRequestReview(db, sessionId, { task_id: taskId });
    const reviews = handleListReviews(db, sessionId, { task_id: taskId });
    expect(reviews).toHaveLength(1);
  });

  it("filters by pending", () => {
    handleRequestReview(db, sessionId, { task_id: taskId });
    const pending = handleListReviews(db, sessionId, { pending: true });
    expect(pending).toHaveLength(1);
    expect(pending[0].verdict).toBeNull();
  });

  it("rejects invalid task_id UUID", () => {
    expect(() => handleListReviews(db, sessionId, { task_id: "not-a-uuid" })).toThrow(
      "Invalid UUID",
    );
  });
});

describe("handleSubmitReview", () => {
  let reviewId: string;

  beforeEach(() => {
    const result = handleRequestReview(db, sessionId, { task_id: taskId });
    reviewId = result.review_id;
  });

  it("submits a review with pass verdict", () => {
    const review = handleSubmitReview(db, otherSessionId, {
      review_id: reviewId,
      verdict: "pass",
      findings: "Looks good",
    });
    expect(review.verdict).toBe("pass");
    expect(review.findings).toBe("Looks good");
  });

  it("submits a review with needs_changes verdict", () => {
    const review = handleSubmitReview(db, otherSessionId, {
      review_id: reviewId,
      verdict: "needs_changes",
      findings: "Fix the bug",
    });
    expect(review.verdict).toBe("needs_changes");
  });

  it("rejects invalid review_id UUID", () => {
    expect(() =>
      handleSubmitReview(db, otherSessionId, {
        review_id: "not-a-uuid",
        verdict: "pass",
        findings: "ok",
      }),
    ).toThrow("Invalid UUID");
  });

  it("rejects invalid verdict enum", () => {
    expect(() =>
      handleSubmitReview(db, otherSessionId, {
        review_id: reviewId,
        verdict: "approve",
        findings: "ok",
      }),
    ).toThrow("Invalid verdict");
  });

  it("rejects findings exceeding 50,000 chars", () => {
    expect(() =>
      handleSubmitReview(db, otherSessionId, {
        review_id: reviewId,
        verdict: "pass",
        findings: "x".repeat(50_001),
      }),
    ).toThrow("exceeds maximum length");
  });
});

describe("handleRespondToReview", () => {
  let reviewId: string;

  beforeEach(() => {
    const result = handleRequestReview(db, sessionId, { task_id: taskId });
    reviewId = result.review_id;
    handleSubmitReview(db, otherSessionId, {
      review_id: reviewId,
      verdict: "needs_changes",
      findings: "Fix it",
    });
  });

  it("responds to a review", () => {
    const review = handleRespondToReview(db, sessionId, {
      review_id: reviewId,
      response: "Fixed",
    });
    expect(review.response).toBe("Fixed");
  });

  it("rejects invalid review_id UUID", () => {
    expect(() =>
      handleRespondToReview(db, sessionId, { review_id: "not-a-uuid", response: "ok" }),
    ).toThrow("Invalid UUID");
  });

  it("rejects response exceeding 50,000 chars", () => {
    expect(() =>
      handleRespondToReview(db, sessionId, {
        review_id: reviewId,
        response: "x".repeat(50_001),
      }),
    ).toThrow("exceeds maximum length");
  });
});
