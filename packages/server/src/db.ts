import crypto from "node:crypto";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  agent_type: string;
  label: string | null;
  status: string;
  tokens_used: number;
  connected_at: string;
  last_seen_at: string;
}

export interface SessionFilter {
  status?: string;
  agent_type?: string;
}

export interface Task {
  id: string;
  short_name: string | null;
  description: string;
  context: string | null;
  assigned_to: string | null;
  status: string;
  created_by: string | null;
  artifacts: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  short_name?: string;
  description: string;
  context?: string;
  assigned_to?: string;
}

export interface TaskFilter {
  status?: string;
  assigned_to?: string;
  mine?: string;
}

export interface CompleteTaskInput {
  summary: string;
  artifacts?: string[];
}

export interface Review {
  id: string;
  task_id: string;
  reviewer: string | null;
  verdict: string | null;
  findings: string | null;
  response: string | null;
  created_at: string;
}

export interface SubmitReviewInput {
  verdict: string;
  findings: string;
}

export interface ReviewFilter {
  task_id?: string;
  pending?: boolean;
  mine?: string;
}

export interface Message {
  id: string;
  channel: string;
  author: string | null;
  content: string;
  created_at: string;
}

export interface PostMessageInput {
  channel?: string;
  content: string;
}

export interface MessageFilter {
  channel?: string;
  since?: string;
  limit?: number;
}

export interface TaskContext {
  task: Task;
  reviews: Review[];
  messages: Message[];
}

export interface CleanupCompletedTasksResult {
  deleted_tasks: number;
  deleted_reviews: number;
  deleted_messages: number;
}

// ---------------------------------------------------------------------------
// Session operations
// ---------------------------------------------------------------------------

export function createSession(
  db: Database.Database,
  agentType: string,
  label?: string,
): string {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, agent_type, label) VALUES (?, ?, ?)`,
  ).run(id, agentType, label ?? null);
  return id;
}

export function getSession(
  db: Database.Database,
  id: string,
): Session | undefined {
  return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;
}

export function listSessions(
  db: Database.Database,
  filter?: SessionFilter,
): Session[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter?.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  if (filter?.agent_type) {
    clauses.push("agent_type = ?");
    params.push(filter.agent_type);
  }

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM sessions${where}`).all(...params) as Session[];
}

export function updateSessionStatus(
  db: Database.Database,
  id: string,
  status: string,
): void {
  db.prepare(`UPDATE sessions SET status = ? WHERE id = ?`).run(status, id);
}

export function updateLastSeen(db: Database.Database, id: string): void {
  db.prepare(
    `UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`,
  ).run(id);
}

export interface UpdateStatusInput {
  status?: "active" | "idle" | "busy" | "stuck";
  tokens_used?: number;
}

export function updateStatus(
  db: Database.Database,
  id: string,
  input: UpdateStatusInput,
): Session {
  if (input.status) {
    db.prepare(
      `UPDATE sessions SET status = ?, last_seen_at = datetime('now') WHERE id = ?`,
    ).run(input.status, id);
  }
  if (input.tokens_used !== undefined) {
    db.prepare(
      `UPDATE sessions SET tokens_used = tokens_used + ?, last_seen_at = datetime('now') WHERE id = ?`,
    ).run(input.tokens_used, id);
  }
  return getSession(db, id)!;
}

// ---------------------------------------------------------------------------
// Task operations
// ---------------------------------------------------------------------------

export function createTask(
  db: Database.Database,
  sessionId: string,
  input: CreateTaskInput,
): string {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO tasks (id, short_name, description, context, assigned_to, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.short_name ?? null, input.description, input.context ?? null, input.assigned_to ?? null, sessionId);
  return id;
}

export function getTask(
  db: Database.Database,
  id: string,
): Task | undefined {
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
    | Task
    | undefined;
}

export function listTasks(
  db: Database.Database,
  filter?: TaskFilter,
): Task[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter?.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  if (filter?.assigned_to) {
    clauses.push("assigned_to = ?");
    params.push(filter.assigned_to);
  }
  if (filter?.mine) {
    clauses.push("created_by = ?");
    params.push(filter.mine);
  }

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM tasks${where}`).all(...params) as Task[];
}

export function claimTask(
  db: Database.Database,
  taskId: string,
  sessionId: string,
): Task {
  const task = getTask(db, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  if (task.status !== "open") {
    throw new Error(`Task ${taskId} is not open (status: ${task.status})`);
  }

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE tasks SET status = 'in_progress', assigned_to = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(sessionId, taskId);
    db.prepare(`UPDATE sessions SET status = 'busy' WHERE id = ?`).run(sessionId);
  });
  txn();

  return getTask(db, taskId)!;
}

export function completeTask(
  db: Database.Database,
  taskId: string,
  sessionId: string,
  input: CompleteTaskInput,
): Task {
  const artifacts = input.artifacts ? JSON.stringify(input.artifacts) : null;

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE tasks SET status = 'done', summary = ?, artifacts = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(input.summary, artifacts, taskId);
    db.prepare(`UPDATE sessions SET status = 'idle' WHERE id = ?`).run(sessionId);
  });
  txn();

  return getTask(db, taskId)!;
}

export function cleanupCompletedTasks(
  db: Database.Database,
): CleanupCompletedTasksResult {
  const terminalTasks = db
    .prepare(
      `SELECT id FROM tasks WHERE status IN ('done', 'reviewed', 'cancelled')`,
    )
    .all() as Array<{ id: string }>;

  if (terminalTasks.length === 0) {
    return { deleted_tasks: 0, deleted_reviews: 0, deleted_messages: 0 };
  }

  const taskIds = terminalTasks.map((task) => task.id);
  let deletedReviews = 0;
  let deletedMessages = 0;
  let deletedTasks = 0;

  const txn = db.transaction(() => {
    const deleteReviews = db.prepare(`DELETE FROM reviews WHERE task_id = ?`);
    const deleteMessages = db.prepare(`DELETE FROM messages WHERE channel = ?`);
    const deleteTask = db.prepare(`DELETE FROM tasks WHERE id = ?`);

    for (const taskId of taskIds) {
      deletedReviews += deleteReviews.run(taskId).changes;
      deletedMessages += deleteMessages.run(`task:${taskId}`).changes;
      deletedTasks += deleteTask.run(taskId).changes;
    }
  });
  txn();

  return {
    deleted_tasks: deletedTasks,
    deleted_reviews: deletedReviews,
    deleted_messages: deletedMessages,
  };
}

export function requestReview(
  db: Database.Database,
  taskId: string,
  sessionId: string,
  rubric?: string,
): string {
  const reviewId = crypto.randomUUID();

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE tasks SET status = 'review_requested', updated_at = datetime('now') WHERE id = ?`,
    ).run(taskId);
    db.prepare(
      `INSERT INTO reviews (id, task_id, reviewer, findings) VALUES (?, ?, ?, ?)`,
    ).run(reviewId, taskId, sessionId, rubric ?? null);
  });
  txn();

  return reviewId;
}

// ---------------------------------------------------------------------------
// Review operations
// ---------------------------------------------------------------------------

export function getReview(
  db: Database.Database,
  id: string,
): Review | undefined {
  return db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(id) as
    | Review
    | undefined;
}

export function listReviews(
  db: Database.Database,
  filter?: ReviewFilter,
): Review[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter?.task_id) {
    clauses.push("task_id = ?");
    params.push(filter.task_id);
  }
  if (filter?.pending) {
    clauses.push("verdict IS NULL");
  }
  if (filter?.mine) {
    clauses.push("reviewer = ?");
    params.push(filter.mine);
  }

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM reviews${where}`).all(...params) as Review[];
}

export function submitReview(
  db: Database.Database,
  reviewId: string,
  sessionId: string,
  input: SubmitReviewInput,
): Review {
  const review = getReview(db, reviewId);
  if (!review) {
    throw new Error(`Review not found: ${reviewId}`);
  }

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE reviews SET verdict = ?, findings = ?, reviewer = ? WHERE id = ?`,
    ).run(input.verdict, input.findings, sessionId, reviewId);
    db.prepare(
      `UPDATE tasks SET status = 'reviewed', updated_at = datetime('now') WHERE id = ?`,
    ).run(review.task_id);
  });
  txn();

  return getReview(db, reviewId)!;
}

export function respondToReview(
  db: Database.Database,
  reviewId: string,
  response: string,
): Review {
  db.prepare(`UPDATE reviews SET response = ? WHERE id = ?`).run(
    response,
    reviewId,
  );
  return getReview(db, reviewId)!;
}

// ---------------------------------------------------------------------------
// Message operations
// ---------------------------------------------------------------------------

export function postMessage(
  db: Database.Database,
  sessionId: string,
  input: PostMessageInput,
): string {
  const id = crypto.randomUUID();
  const channel = input.channel ?? "general";
  db.prepare(
    `INSERT INTO messages (id, channel, author, content) VALUES (?, ?, ?, ?)`,
  ).run(id, channel, sessionId, input.content);
  return id;
}

export function readMessages(
  db: Database.Database,
  filter?: MessageFilter,
): Message[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter?.channel) {
    clauses.push("channel = ?");
    params.push(filter.channel);
  }
  if (filter?.since) {
    clauses.push("created_at > ?");
    params.push(filter.since);
  }

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  const limit = filter?.limit ? ` LIMIT ?` : "";
  if (filter?.limit) {
    params.push(filter.limit);
  }

  return db
    .prepare(`SELECT * FROM messages${where} ORDER BY created_at ASC${limit}`)
    .all(...params) as Message[];
}

// ---------------------------------------------------------------------------
// Context aggregation
// ---------------------------------------------------------------------------

export function getTaskContext(
  db: Database.Database,
  taskId: string,
): TaskContext {
  const task = getTask(db, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const reviews = listReviews(db, { task_id: taskId });
  const messages = readMessages(db, { channel: `task:${taskId}` });

  return { task, reviews, messages };
}
