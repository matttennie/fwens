import type Database from "better-sqlite3";
import { type TaskContext, getTaskContext } from "../db.js";
import { validateUuid } from "../validation.js";

export function handleGetContext(db: Database.Database, taskId: string): TaskContext {
  validateUuid(taskId);
  return getTaskContext(db, taskId);
}
