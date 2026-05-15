import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import {
  createSession,
  getSession,
  updateSessionStatus,
  createTask,
  getTask,
  listTasks,
  claimTask,
  completeTask,
  requestReview,
  submitReview,
  respondToReview,
  postMessage,
  getTaskContext,
} from "../db.js";

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
});

// ---------------------------------------------------------------------------
// Full collaboration workflow
// ---------------------------------------------------------------------------

describe("full workflow: create -> claim -> complete -> review -> respond", () => {
  let claudeId: string;
  let geminiId: string;

  beforeEach(() => {
    claudeId = createSession(db, "claude", "claude-worker");
    geminiId = createSession(db, "gemini", "gemini-worker");
  });

  it("executes a complete task lifecycle across two agents", () => {
    // Step 1: Sessions already created above

    // Step 2: Claude creates a task assigned to Gemini
    const taskId = createTask(db, claudeId, {
      description: "Implement feature X",
      context: "See design doc for details",
      assigned_to: geminiId,
    });

    let task = getTask(db, taskId)!;
    expect(task.status).toBe("open");
    expect(task.assigned_to).toBe(geminiId);
    expect(task.created_by).toBe(claudeId);
    expect(task.context).toBe("See design doc for details");

    // Step 3: Claude posts a message on the task channel
    postMessage(db, claudeId, {
      channel: `task:${taskId}`,
      content: "Please prioritize this task",
    });

    // Step 4: Gemini lists tasks filtered by assigned_to
    const geminiTasks = listTasks(db, { assigned_to: geminiId });
    expect(geminiTasks).toHaveLength(1);
    expect(geminiTasks[0].id).toBe(taskId);

    // Step 5: Gemini claims the task
    task = claimTask(db, taskId, geminiId);
    expect(task.status).toBe("in_progress");

    const geminiSession = getSession(db, geminiId)!;
    expect(geminiSession.status).toBe("busy");

    // Step 6: Gemini completes the task with summary and artifacts
    task = completeTask(db, taskId, geminiId, {
      summary: "Implemented feature X with full test coverage",
      artifacts: ["src/featureX.ts", "src/__tests__/featureX.test.ts"],
    });
    expect(task.status).toBe("done");
    expect(task.summary).toBe("Implemented feature X with full test coverage");
    expect(JSON.parse(task.artifacts!)).toEqual([
      "src/featureX.ts",
      "src/__tests__/featureX.test.ts",
    ]);

    const geminiAfterComplete = getSession(db, geminiId)!;
    expect(geminiAfterComplete.status).toBe("idle");

    // Step 7: Gemini requests a review
    const reviewId = requestReview(db, taskId, geminiId);
    task = getTask(db, taskId)!;
    expect(task.status).toBe("review_requested");

    // Step 8: Claude submits a review with verdict=needs_changes and findings
    const review = submitReview(db, reviewId, claudeId, {
      verdict: "needs_changes",
      findings: "Missing error handling in edge case",
    });
    expect(review.verdict).toBe("needs_changes");
    expect(review.findings).toBe("Missing error handling in edge case");

    task = getTask(db, taskId)!;
    // needs_changes sends the task back to in_progress, not to a terminal
    // 'reviewed' state.
    expect(task.status).toBe("in_progress");

    // Step 9: Gemini responds to the review
    const updatedReview = respondToReview(db, reviewId, "Added error handling for the edge case");
    expect(updatedReview.response).toBe("Added error handling for the edge case");

    // Step 10: getTaskContext returns full context
    const ctx = getTaskContext(db, taskId);

    expect(ctx.task.id).toBe(taskId);
    expect(ctx.task.status).toBe("in_progress");

    expect(ctx.reviews).toHaveLength(1);
    expect(ctx.reviews[0].verdict).toBe("needs_changes");
    expect(ctx.reviews[0].findings).toBe("Missing error handling in edge case");
    expect(ctx.reviews[0].response).toBe("Added error handling for the edge case");

    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].content).toBe("Please prioritize this task");
  });
});

// ---------------------------------------------------------------------------
// Session disconnect and task reassignment
// ---------------------------------------------------------------------------

describe("session disconnect and reassignment", () => {
  it("allows reassignment after session disconnect", () => {
    // Step 1: Create two sessions
    const codexId = createSession(db, "codex", "codex-worker");
    const aiderId = createSession(db, "aider", "aider-worker");

    // Step 2: Create a task assigned to codex
    const taskId = createTask(db, codexId, {
      description: "Refactor module Y",
      assigned_to: codexId,
    });

    // Step 3: Disconnect codex
    updateSessionStatus(db, codexId, "disconnected");
    const codexSession = getSession(db, codexId)!;
    expect(codexSession.status).toBe("disconnected");

    // Step 4: Task is still open (not claimed)
    let task = getTask(db, taskId)!;
    expect(task.status).toBe("open");

    // Step 5: Aider claims the task successfully
    task = claimTask(db, taskId, aiderId);
    expect(task.status).toBe("in_progress");

    // Step 6: Verify task.assigned_to is now aider
    expect(task.assigned_to).toBe(aiderId);
  });
});
