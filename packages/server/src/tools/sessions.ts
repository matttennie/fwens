import type Database from "better-sqlite3";
import {
  type Session,
  type SessionFilter,
  getSession,
  listSessions,
  updateSessionStatus,
} from "../db.js";
import { validateEnum, validateStringLength } from "../validation.js";

const SESSION_STATUSES = ["active", "idle", "busy", "disconnected"] as const;

export function handleWhoami(db: Database.Database, sessionId: string): Session {
  const session = getSession(db, sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return session;
}

export function handleListSessions(
  db: Database.Database,
  filter?: SessionFilter,
): Session[] {
  if (filter?.status) {
    validateEnum(filter.status, SESSION_STATUSES, "status");
  }
  return listSessions(db, filter);
}

export function handleSetLabel(
  db: Database.Database,
  sessionId: string,
  label: string,
): Session {
  validateStringLength(label, 200, "label");
  db.prepare(`UPDATE sessions SET label = ? WHERE id = ?`).run(label, sessionId);
  const session = getSession(db, sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return session;
}
