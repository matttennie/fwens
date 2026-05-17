import crypto from "node:crypto";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Constants — single source of truth for status enums
// ---------------------------------------------------------------------------

export const SESSION_STATUSES = ["active", "idle", "busy", "stuck", "disconnected"] as const;
export const SETTABLE_SESSION_STATUSES = ["active", "idle", "busy", "stuck"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type SettableSessionStatus = (typeof SETTABLE_SESSION_STATUSES)[number];

export const TASK_STATUSES = [
  "open",
  "in_progress",
  "done",
  "review_requested",
  "reviewed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const REVIEW_VERDICTS = ["pass", "fail", "needs_changes"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

// Default caps on result-set size for list endpoints. Bounds memory and
// MCP-response size when a long-running project accumulates thousands of rows.
// Callers can pass an explicit `limit` to override.
export const DEFAULT_LIST_LIMIT = 500;
export const DEFAULT_MESSAGE_LIMIT = 100;
export const MAX_LIST_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  label: string | null;
  status: SessionStatus;
  tokens_used: number;
  connected_at: string;
  last_seen_at: string;
  pid: number | null;
}

export interface PruneStaleSessionsResult {
  pruned_dead_pid: number;
  pruned_aged_out: number;
  kept_alive: number;
  skipped_no_pid_recent: number;
  disabled: boolean;
  events: PruneEvent[];
}

export interface PruneEvent {
  session_id: string;
  reason: "dead_pid" | "aged_out";
  pid: number | null;
  age_ms: number;
  at: string;
}

// Default: prune sessions whose last_seen_at is older than 24h, even if their
// PID is alive. Bounds the PID-recycling zombie problem. Configurable via
// FWENS_PRUNE_MAX_IDLE_MS.
export const DEFAULT_PRUNE_MAX_IDLE_MS = 24 * 60 * 60 * 1000;

export interface SessionFilter {
  status?: string;
  limit?: number;
}

export interface Task {
  id: string;
  short_name: string | null;
  description: string;
  context: string | null;
  assigned_to: string | null;
  status: TaskStatus;
  created_by: string | null;
  artifacts: string[] | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  short_name: string | null;
  description: string;
  context: string | null;
  assigned_to: string | null;
  status: TaskStatus;
  created_by: string | null;
  artifacts: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

// Tasks store artifact paths as a JSON-encoded array of strings. Callers
// receive an actual array; the JSON encoding is an internal storage detail.
function parseTaskRow(row: TaskRow | undefined): Task | undefined {
  if (!row) return undefined;
  return {
    ...row,
    artifacts: row.artifacts ? (JSON.parse(row.artifacts) as string[]) : null,
  };
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
  // When true, only return tasks whose assignee is a disconnected session.
  // Surfaces tasks stranded by a crashed agent so an orchestrator can reclaim.
  assigned_to_disconnected?: boolean;
  limit?: number;
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
  limit?: number;
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

// Default-applied; explicit 0/undefined falls back to DEFAULT_MESSAGE_LIMIT.
// Bounds context-window blow-up when a long-lived project accumulates messages.

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
  label?: string,
  pid?: number,
): string {
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO sessions (id, label, pid) VALUES (?, ?, ?)`).run(
    id,
    label ?? null,
    pid ?? null,
  );
  return id;
}

export interface FindDisconnectedSessionOptions {
  sessionId?: string;
  label?: string;
}

export function findDisconnectedSession(
  db: Database.Database,
  opts: FindDisconnectedSessionOptions,
): Session | undefined {
  if (opts.sessionId) {
    return db
      .prepare(`SELECT * FROM sessions WHERE id = ? AND status = 'disconnected'`)
      .get(opts.sessionId) as Session | undefined;
  }

  if (!opts.label) return undefined;

  return db
    .prepare(
      `SELECT * FROM sessions WHERE status = 'disconnected' AND label = ? ORDER BY last_seen_at DESC LIMIT 1`,
    )
    .get(opts.label) as Session | undefined;
}

export interface ResumeSessionOptions {
  label?: string;
  pid?: number;
}

// Atomic resume: the WHERE clause filters by status='disconnected' so two
// processes racing on the same row cannot both succeed. The loser sees
// changes=0 and gets undefined back, signalling the caller to create a new
// session instead of dying.
export function resumeSession(
  db: Database.Database,
  sessionId: string,
  opts?: ResumeSessionOptions,
): Session | undefined {
  const setClauses = ["status = 'active'", "last_seen_at = datetime('now')"];
  const params: unknown[] = [];

  if (opts?.label !== undefined) {
    setClauses.push("label = ?");
    params.push(opts.label);
  }

  if (opts?.pid !== undefined) {
    setClauses.push("pid = ?");
    params.push(opts.pid);
  }

  params.push(sessionId);

  const result = db
    .prepare(
      `UPDATE sessions SET ${setClauses.join(", ")}
         WHERE id = ? AND status = 'disconnected'`,
    )
    .run(...params);

  if (result.changes === 0) {
    return undefined;
  }
  return getSession(db, sessionId)!;
}

export function getSession(db: Database.Database, id: string): Session | undefined {
  return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session | undefined;
}

export function listSessions(db: Database.Database, filter?: SessionFilter): Session[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter?.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  const limit = clampLimit(filter?.limit, DEFAULT_LIST_LIMIT);
  params.push(limit);
  return db
    .prepare(`SELECT * FROM sessions${where} ORDER BY last_seen_at DESC LIMIT ?`)
    .all(...params) as Session[];
}

export function updateSessionStatus(db: Database.Database, id: string, status: string): void {
  db.prepare(`UPDATE sessions SET status = ? WHERE id = ?`).run(status, id);
}

// Guarded: only bumps last_seen_at for sessions that are still in an
// active-ish state. Prevents a heartbeat from a still-running MCP process
// resurrecting a session that was pruned to 'disconnected' (cosmetic in
// the prune query — which already filters by status — but confusing UX in
// list_sessions output).
export function updateLastSeen(db: Database.Database, id: string): void {
  db.prepare(
    `UPDATE sessions SET last_seen_at = datetime('now')
       WHERE id = ? AND status IN ('active','idle','busy','stuck')`,
  ).run(id);
}

// Sends signal 0 to check process existence without affecting it. Explicit
// branches per POSIX:
//   - no throw      -> process exists and we own it -> alive
//   - ESRCH         -> no such process -> dead
//   - EPERM         -> process exists but owned by another user -> alive
//   - other / no code -> sandbox or unsupported syscall; preserve (treat as
//     alive) rather than prune defensively. A separate kill-switch
//     (FWENS_DISABLE_PRUNE) covers environments where this happens reliably.
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return true;
  }
}

export interface PruneStaleSessionsOptions {
  isAlive?: (pid: number) => boolean;
  maxIdleMs?: number;
  now?: () => Date;
  disabled?: boolean;
}

export function pruneStaleSessions(
  db: Database.Database,
  opts?: PruneStaleSessionsOptions,
): PruneStaleSessionsResult {
  const disabled = opts?.disabled ?? process.env.FWENS_DISABLE_PRUNE === "1";
  if (disabled) {
    return {
      pruned_dead_pid: 0,
      pruned_aged_out: 0,
      kept_alive: 0,
      skipped_no_pid_recent: 0,
      disabled: true,
      events: [],
    };
  }

  const checkAlive = opts?.isAlive ?? isProcessAlive;
  const envMaxIdle = process.env.FWENS_PRUNE_MAX_IDLE_MS;
  const maxIdleMs =
    opts?.maxIdleMs ??
    (envMaxIdle && Number.isFinite(Number(envMaxIdle))
      ? Number(envMaxIdle)
      : DEFAULT_PRUNE_MAX_IDLE_MS);
  const now = opts?.now?.() ?? new Date();
  const nowMs = now.getTime();

  // Indexed query: enumerated statuses use idx_sessions_status. Avoids the
  // full scan that `status != 'disconnected'` would trigger.
  const rows = db
    .prepare(
      `SELECT id, pid, last_seen_at FROM sessions
       WHERE status IN ('active','idle','busy','stuck')`,
    )
    .all() as Array<{ id: string; pid: number | null; last_seen_at: string }>;

  let prunedDeadPid = 0;
  let prunedAgedOut = 0;
  let keptAlive = 0;
  let skippedNoPidRecent = 0;
  const events: PruneEvent[] = [];

  // SQLite stores `datetime('now')` as UTC text. Append "Z" so JS Date parses
  // it as UTC, not local time.
  const parseSqliteTime = (s: string): number => Date.parse(s.replace(" ", "T") + "Z");

  // Conditional UPDATE: still active when we mark it disconnected, otherwise
  // a parallel resume/createSession would lose the race.
  const mark = db.prepare(
    `UPDATE sessions SET status = 'disconnected'
     WHERE id = ? AND status IN ('active','idle','busy','stuck')`,
  );

  const sweep = db.transaction(() => {
    for (const row of rows) {
      const lastSeenMs = parseSqliteTime(row.last_seen_at);
      const ageMs = nowMs - lastSeenMs;

      // Age check first — addresses PID recycling (alive but unrelated) and
      // legacy NULL-pid rows that would otherwise be unreachable.
      if (ageMs > maxIdleMs) {
        const changed = mark.run(row.id).changes;
        if (changed > 0) {
          prunedAgedOut++;
          events.push({
            session_id: row.id,
            reason: "aged_out",
            pid: row.pid,
            age_ms: ageMs,
            at: now.toISOString(),
          });
        }
        continue;
      }

      if (row.pid === null) {
        skippedNoPidRecent++;
        continue;
      }

      if (checkAlive(row.pid)) {
        keptAlive++;
        continue;
      }

      const changed = mark.run(row.id).changes;
      if (changed > 0) {
        prunedDeadPid++;
        events.push({
          session_id: row.id,
          reason: "dead_pid",
          pid: row.pid,
          age_ms: ageMs,
          at: now.toISOString(),
        });
      }
    }
  });
  sweep();

  return {
    pruned_dead_pid: prunedDeadPid,
    pruned_aged_out: prunedAgedOut,
    kept_alive: keptAlive,
    skipped_no_pid_recent: skippedNoPidRecent,
    disabled: false,
    events,
  };
}

export interface UpdateStatusInput {
  status?: SettableSessionStatus;
  tokens_used?: number;
}

// Single UPDATE covers both fields so a crash between them cannot leave the
// row half-updated. last_seen_at advances on every call.
export function updateStatus(db: Database.Database, id: string, input: UpdateStatusInput): Session {
  if (input.status === undefined && input.tokens_used === undefined) {
    return getSession(db, id)!;
  }

  const setClauses: string[] = ["last_seen_at = datetime('now')"];
  const params: unknown[] = [];

  if (input.status !== undefined) {
    setClauses.push("status = ?");
    params.push(input.status);
  }
  if (input.tokens_used !== undefined) {
    setClauses.push("tokens_used = tokens_used + ?");
    params.push(input.tokens_used);
  }

  params.push(id);
  db.prepare(`UPDATE sessions SET ${setClauses.join(", ")} WHERE id = ?`).run(...params);
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
  ).run(
    id,
    input.short_name ?? null,
    input.description,
    input.context ?? null,
    input.assigned_to ?? null,
    sessionId,
  );
  return id;
}

export function getTask(db: Database.Database, id: string): Task | undefined {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
  return parseTaskRow(row);
}

export function listTasks(db: Database.Database, filter?: TaskFilter): Task[] {
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
  if (filter?.assigned_to_disconnected) {
    clauses.push("assigned_to IN (SELECT id FROM sessions WHERE status = 'disconnected')");
  }

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  const limit = clampLimit(filter?.limit, DEFAULT_LIST_LIMIT);
  params.push(limit);

  const rows = db
    .prepare(`SELECT * FROM tasks${where} ORDER BY created_at ASC, id ASC LIMIT ?`)
    .all(...params) as TaskRow[];
  return rows.map((row) => parseTaskRow(row)!);
}

function clampLimit(requested: number | undefined, fallback: number): number {
  if (requested === undefined) return fallback;
  if (!Number.isFinite(requested) || requested <= 0) return fallback;
  return Math.min(Math.floor(requested), MAX_LIST_LIMIT);
}

// Atomic conditional claim. Two processes calling claimTask on the same row
// can no longer both succeed: the UPDATE's WHERE clause is the lock. If 0
// rows change, the caller couldn't claim and we explain why precisely.
//
// Reassignment rule: a task assigned to a disconnected session may be
// claimed by anyone (otherwise tasks strand when their owner crashes).
export function claimTask(db: Database.Database, taskId: string, sessionId: string): Task {
  const task = getTask(db, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const txn = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE tasks
            SET status = 'in_progress',
                assigned_to = ?,
                updated_at = datetime('now')
          WHERE id = ?
            AND status = 'open'
            AND (
              assigned_to IS NULL
              OR assigned_to = ?
              OR assigned_to IN (SELECT id FROM sessions WHERE status = 'disconnected')
            )`,
      )
      .run(sessionId, taskId, sessionId);

    if (result.changes === 0) {
      // Distinguish the failure modes for a useful error message.
      if (task.status !== "open") {
        throw new Error(`Task ${taskId} is not open (status: ${task.status})`);
      }
      throw new Error(`Task ${taskId} is assigned to another active session (${task.assigned_to})`);
    }

    db.prepare(`UPDATE sessions SET status = 'busy' WHERE id = ?`).run(sessionId);
  });
  txn();

  return getTask(db, taskId)!;
}

// Atomic conditional completion. Only the assignee or original creator can
// complete a task, and only while it's in a state where completion makes
// sense (in_progress or review_requested).
export function completeTask(
  db: Database.Database,
  taskId: string,
  sessionId: string,
  input: CompleteTaskInput,
): Task {
  const task = getTask(db, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const artifacts = input.artifacts ? JSON.stringify(input.artifacts) : null;

  const txn = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE tasks
            SET status = 'done',
                summary = ?,
                artifacts = ?,
                updated_at = datetime('now')
          WHERE id = ?
            AND status IN ('in_progress', 'review_requested')
            AND (assigned_to = ? OR created_by = ?)`,
      )
      .run(input.summary, artifacts, taskId, sessionId, sessionId);

    if (result.changes === 0) {
      if (!["in_progress", "review_requested"].includes(task.status)) {
        throw new Error(
          `Task ${taskId} cannot be completed from status '${task.status}' (must be in_progress or review_requested)`,
        );
      }
      throw new Error(`Task ${taskId} can only be completed by its assignee or creator`);
    }

    db.prepare(`UPDATE sessions SET status = 'idle' WHERE id = ?`).run(sessionId);
  });
  txn();

  return getTask(db, taskId)!;
}

export function cleanupCompletedTasks(db: Database.Database): CleanupCompletedTasksResult {
  const terminalTasks = db
    .prepare(`SELECT id FROM tasks WHERE status IN ('done', 'reviewed', 'cancelled')`)
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
  const task = getTask(db, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  if (task.status !== "done") {
    throw new Error(
      `Cannot request review on task ${taskId} (status: ${task.status}); task must be 'done' first`,
    );
  }
  if (task.assigned_to !== sessionId && task.created_by !== sessionId) {
    throw new Error(`Only the task's assignee or creator can request a review`);
  }

  const reviewId = crypto.randomUUID();

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE tasks SET status = 'review_requested', updated_at = datetime('now') WHERE id = ?`,
    ).run(taskId);
    db.prepare(`INSERT INTO reviews (id, task_id, reviewer, findings) VALUES (?, ?, ?, ?)`).run(
      reviewId,
      taskId,
      sessionId,
      rubric ?? null,
    );
  });
  txn();

  return reviewId;
}

// ---------------------------------------------------------------------------
// Review operations
// ---------------------------------------------------------------------------

export function getReview(db: Database.Database, id: string): Review | undefined {
  return db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(id) as Review | undefined;
}

export function listReviews(db: Database.Database, filter?: ReviewFilter): Review[] {
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
  const limit = clampLimit(filter?.limit, DEFAULT_LIST_LIMIT);
  params.push(limit);

  return db
    .prepare(`SELECT * FROM reviews${where} ORDER BY created_at ASC, id ASC LIMIT ?`)
    .all(...params) as Review[];
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

  // Self-review prevention: the worker cannot grade their own work. The
  // orchestrator-as-creator pattern remains valid — a creator who delegated
  // the task to another agent may legitimately review the result.
  const task = getTask(db, review.task_id);
  if (task && task.assigned_to === sessionId) {
    throw new Error(`Cannot submit a review on a task assigned to yourself`);
  }

  // needs_changes sends the task back to the worker for fixes, not into the
  // 'reviewed' terminal state. pass/fail are terminal verdicts.
  const nextTaskStatus = input.verdict === "needs_changes" ? "in_progress" : "reviewed";

  const txn = db.transaction(() => {
    db.prepare(`UPDATE reviews SET verdict = ?, findings = ?, reviewer = ? WHERE id = ?`).run(
      input.verdict,
      input.findings,
      sessionId,
      reviewId,
    );
    db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
      nextTaskStatus,
      review.task_id,
    );
  });
  txn();

  return getReview(db, reviewId)!;
}

// Only the original worker or task creator can respond to a review. The
// response field stores the worker's reply to reviewer findings, so a third
// party overwriting it would silently falsify the audit trail.
export function respondToReview(
  db: Database.Database,
  reviewId: string,
  sessionId: string,
  response: string,
): Review {
  const review = getReview(db, reviewId);
  if (!review) {
    throw new Error(`Review not found: ${reviewId}`);
  }
  const task = getTask(db, review.task_id);
  if (!task) {
    throw new Error(`Task not found for review: ${reviewId}`);
  }
  if (task.assigned_to !== sessionId && task.created_by !== sessionId) {
    throw new Error(`Only the task's assignee or creator can respond to its review`);
  }
  db.prepare(`UPDATE reviews SET response = ? WHERE id = ?`).run(response, reviewId);
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
  db.prepare(`INSERT INTO messages (id, channel, author, content) VALUES (?, ?, ?, ?)`).run(
    id,
    channel,
    sessionId,
    input.content,
  );
  return id;
}

export function readMessages(db: Database.Database, filter?: MessageFilter): Message[] {
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
  const limit = clampLimit(filter?.limit, DEFAULT_MESSAGE_LIMIT);
  params.push(limit);

  return db
    .prepare(`SELECT * FROM messages${where} ORDER BY created_at ASC LIMIT ?`)
    .all(...params) as Message[];
}

// ---------------------------------------------------------------------------
// Context aggregation
// ---------------------------------------------------------------------------

export function getTaskContext(db: Database.Database, taskId: string): TaskContext {
  const task = getTask(db, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const reviews = listReviews(db, { task_id: taskId, limit: MAX_LIST_LIMIT });
  const messages = readMessages(db, { channel: `task:${taskId}`, limit: MAX_LIST_LIMIT });

  return { task, reviews, messages };
}
