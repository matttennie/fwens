import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  type PruneStaleSessionsResult,
  type Session,
  type SessionFilter,
  type UpdateStatusInput,
  SESSION_STATUSES,
  SETTABLE_SESSION_STATUSES,
  getSession,
  listSessions,
  pruneStaleSessions,
  updateStatus,
} from "../db.js";
import { validateEnum, validateStringLength } from "../validation.js";

export function handleWhoami(db: Database.Database, sessionId: string): Session {
  const session = getSession(db, sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return session;
}

// Idempotent: no longer mutates session state. Callers needing a fresh
// prune sweep should call handlePruneSessions explicitly.
export function handleListSessions(
  db: Database.Database,
  args?: { status?: string; limit?: number },
): Session[] {
  if (args?.status) {
    validateEnum(args.status, SESSION_STATUSES, "status");
  }
  const filter: SessionFilter = {
    status: args?.status,
    limit: args?.limit,
  };
  return listSessions(db, filter);
}

export function handlePruneSessions(
  db: Database.Database,
  fwensDir: string,
): PruneStaleSessionsResult {
  const result = pruneStaleSessions(db);
  if (result.events.length > 0) {
    appendPruneEvents(fwensDir, result.events);
  }
  return result;
}

function appendPruneEvents(fwensDir: string, events: PruneStaleSessionsResult["events"]): void {
  try {
    const logPath = path.join(fwensDir, "prune-events.jsonl");
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.appendFileSync(logPath, lines);
  } catch {
    // Best-effort logging; never fail the prune itself.
  }
}

export { appendPruneEvents };

export function handleSetLabel(db: Database.Database, sessionId: string, label: string): Session {
  validateStringLength(label, 200, "label");
  db.prepare(`UPDATE sessions SET label = ? WHERE id = ?`).run(label, sessionId);
  const session = getSession(db, sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return session;
}

export function handleUpdateStatus(
  db: Database.Database,
  sessionId: string,
  input: { status?: string; tokens_used?: number },
): Session {
  if (input.status) {
    validateEnum(input.status, SETTABLE_SESSION_STATUSES, "status");
  }
  return updateStatus(db, sessionId, input as UpdateStatusInput);
}
