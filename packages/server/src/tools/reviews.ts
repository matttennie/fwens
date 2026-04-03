import type Database from "better-sqlite3";
import {
  type Review,
  type ReviewFilter,
  type SubmitReviewInput,
  requestReview,
  listReviews,
  submitReview,
  respondToReview,
} from "../db.js";
import {
  validateUuid,
  validateStringLength,
  validateEnum,
} from "../validation.js";

const VERDICTS = ["pass", "fail", "needs_changes"] as const;

export function handleRequestReview(
  db: Database.Database,
  sessionId: string,
  args: { task_id: string; rubric?: string },
): { review_id: string } {
  validateUuid(args.task_id);
  if (args.rubric !== undefined) {
    validateStringLength(args.rubric, 10_000, "rubric");
  }
  const reviewId = requestReview(db, args.task_id, sessionId, args.rubric);
  return { review_id: reviewId };
}

export function handleListReviews(
  db: Database.Database,
  sessionId: string,
  args: { task_id?: string; pending?: boolean; mine?: boolean },
): Review[] {
  if (args.task_id) {
    validateUuid(args.task_id);
  }
  const filter: ReviewFilter = {
    task_id: args.task_id,
    pending: args.pending,
    mine: args.mine ? sessionId : undefined,
  };
  return listReviews(db, filter);
}

export function handleSubmitReview(
  db: Database.Database,
  sessionId: string,
  args: { review_id: string; verdict: string; findings: string },
): Review {
  validateUuid(args.review_id);
  validateEnum(args.verdict, VERDICTS, "verdict");
  validateStringLength(args.findings, 50_000, "findings");
  const input: SubmitReviewInput = {
    verdict: args.verdict,
    findings: args.findings,
  };
  return submitReview(db, args.review_id, sessionId, input);
}

export function handleRespondToReview(
  db: Database.Database,
  args: { review_id: string; response: string },
): Review {
  validateUuid(args.review_id);
  validateStringLength(args.response, 50_000, "response");
  return respondToReview(db, args.review_id, args.response);
}
