#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { initializeDb } from "./schema.js";
import {
  createSession,
  updateSessionStatus,
  updateLastSeen,
  cleanupCompletedTasks,
} from "./db.js";
import { handleWhoami, handleListSessions, handleSetLabel, handleUpdateStatus } from "./tools/sessions.js";
import { handleCreateTask, handleListTasks, handleClaimTask, handleCompleteTask, handleCleanupCompletedTasks } from "./tools/tasks.js";
import { handleRequestReview, handleListReviews, handleSubmitReview, handleRespondToReview } from "./tools/reviews.js";
import { handlePostMessage, handleReadMessages } from "./tools/messages.js";
import { handleGetContext } from "./tools/context.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const projectRoot = process.env.FWENS_PROJECT ?? process.cwd();
const agentType = process.env.FWENS_AGENT_TYPE ?? "claude";
const agentLabel = process.env.FWENS_LABEL;

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const fwensDir = path.join(projectRoot, ".fwens");
if (!fs.existsSync(fwensDir)) {
  fs.mkdirSync(fwensDir, { recursive: true });
}

const dbPath = path.join(fwensDir, "fwens.db");
const db = new Database(dbPath);
initializeDb(db);

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const sessionId = createSession(db, agentType, agentLabel);
cleanupCompletedTasks(db);

function heartbeat(): void {
  updateLastSeen(db, sessionId);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "fwens", version: "0.1.0" });

// --- whoami ----------------------------------------------------------------

server.registerTool("whoami", {
  title: "Who Am I",
  description: "Returns this agent's session info (id, type, label, status).",
  inputSchema: z.object({}),
}, async () => {
  heartbeat();
  try {
    const result = handleWhoami(db, sessionId);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- list_sessions ---------------------------------------------------------

server.registerTool("list_sessions", {
  title: "List Sessions",
  description: "Lists all agent sessions, optionally filtered by status or agent_type.",
  inputSchema: z.object({
    status: z.enum(["active", "idle", "busy", "stuck", "disconnected"]).optional(),
    agent_type: z.string().optional(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleListSessions(db, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- set_label -------------------------------------------------------------

server.registerTool("set_label", {
  title: "Set Label",
  description: "Sets a human-readable label on this agent's session.",
  inputSchema: z.object({
    label: z.string(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleSetLabel(db, sessionId, args.label);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- update_status --------------------------------------------------------

server.registerTool("update_status", {
  title: "Update Status",
  description: "Update this agent's status (active/idle/busy/stuck) and optionally report token usage. Call with status 'busy' when starting work, 'idle' when done, 'stuck' when blocked.",
  inputSchema: z.object({
    status: z.enum(["active", "idle", "busy", "stuck"]).optional(),
    tokens_used: z.number().int().min(0).optional(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleUpdateStatus(db, sessionId, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- create_task -----------------------------------------------------------

server.registerTool("create_task", {
  title: "Create Task",
  description: "Creates a new task with a description and optional context/assignee. Always include a short_name (2-4 words) for dashboard display.",
  inputSchema: z.object({
    short_name: z.string().max(50).optional(),
    description: z.string(),
    context: z.string().optional(),
    assigned_to: z.string().optional(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleCreateTask(db, sessionId, args, projectRoot);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- list_tasks ------------------------------------------------------------

server.registerTool("list_tasks", {
  title: "List Tasks",
  description: "Lists tasks, optionally filtered by status, assignee, or created by self.",
  inputSchema: z.object({
    status: z.enum(["open", "in_progress", "done", "review_requested", "reviewed"]).optional(),
    assigned_to: z.string().optional(),
    mine: z.boolean().optional(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleListTasks(db, sessionId, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- claim_task ------------------------------------------------------------

server.registerTool("claim_task", {
  title: "Claim Task",
  description: "Claims an open task, setting it to in_progress and assigning it to this agent.",
  inputSchema: z.object({
    task_id: z.string(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleClaimTask(db, sessionId, args.task_id);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- complete_task ---------------------------------------------------------

server.registerTool("complete_task", {
  title: "Complete Task",
  description: "Marks a task as done with a summary and optional artifact paths.",
  inputSchema: z.object({
    task_id: z.string(),
    summary: z.string(),
    artifacts: z.array(z.string()).optional(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleCompleteTask(db, sessionId, args, projectRoot);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- cleanup_completed_tasks ----------------------------------------------

server.registerTool("cleanup_completed_tasks", {
  title: "Cleanup Completed Tasks",
  description: "Deletes terminal completed tasks and their task-scoped reviews/messages. Preserves open, in-progress, and review-requested work.",
  inputSchema: z.object({}),
}, async () => {
  heartbeat();
  try {
    const result = handleCleanupCompletedTasks(db);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- request_review --------------------------------------------------------

server.registerTool("request_review", {
  title: "Request Review",
  description: "Requests a review for a completed task, optionally including a rubric.",
  inputSchema: z.object({
    task_id: z.string(),
    rubric: z.string().optional(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleRequestReview(db, sessionId, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- list_reviews ----------------------------------------------------------

server.registerTool("list_reviews", {
  title: "List Reviews",
  description: "Lists reviews, optionally filtered by task_id, pending status, or created by self.",
  inputSchema: z.object({
    task_id: z.string().optional(),
    pending: z.boolean().optional(),
    mine: z.boolean().optional(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleListReviews(db, sessionId, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- submit_review ---------------------------------------------------------

server.registerTool("submit_review", {
  title: "Submit Review",
  description: "Submits a review verdict and findings for a pending review.",
  inputSchema: z.object({
    review_id: z.string(),
    verdict: z.enum(["pass", "fail", "needs_changes"]),
    findings: z.string(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleSubmitReview(db, sessionId, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- respond_to_review -----------------------------------------------------

server.registerTool("respond_to_review", {
  title: "Respond to Review",
  description: "Adds a response to a review.",
  inputSchema: z.object({
    review_id: z.string(),
    response: z.string(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleRespondToReview(db, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- post_message ----------------------------------------------------------

server.registerTool("post_message", {
  title: "Post Message",
  description: "Posts a message to a channel (default: general).",
  inputSchema: z.object({
    content: z.string(),
    channel: z.string().optional(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handlePostMessage(db, sessionId, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- read_messages ---------------------------------------------------------

server.registerTool("read_messages", {
  title: "Read Messages",
  description: "Reads messages from a channel, optionally filtered by time and limited in count.",
  inputSchema: z.object({
    channel: z.string().optional(),
    since: z.string().optional(),
    limit: z.number().max(1000).optional(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleReadMessages(db, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- get_context -----------------------------------------------------------

server.registerTool("get_context", {
  title: "Get Task Context",
  description: "Returns full context for a task: task details, reviews, and related messages.",
  inputSchema: z.object({
    task_id: z.string(),
  }),
}, async (args) => {
  heartbeat();
  try {
    const result = handleGetContext(db, args.task_id);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// --- get_project_config ----------------------------------------------------

server.registerTool("get_project_config", {
  title: "Get Project Config",
  description: "Returns the project root path and database location.",
  inputSchema: z.object({}),
}, async () => {
  heartbeat();
  try {
    const result = {
      project_root: projectRoot,
      db_path: dbPath,
      fwens_dir: fwensDir,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(): void {
  try {
    updateSessionStatus(db, sessionId, "disconnected");
  } catch {
    // db may already be closed
  }
  try {
    db.close();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("end", shutdown);
