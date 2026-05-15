import type Database from "better-sqlite3";
import {
  type Task,
  type TaskFilter,
  type CreateTaskInput,
  type CompleteTaskInput,
  createTask,
  listTasks,
  claimTask,
  completeTask,
  cleanupCompletedTasks,
} from "../db.js";
import { validateUuid, validatePath, validateStringLength, validateEnum } from "../validation.js";

const TASK_STATUSES = [
  "open",
  "in_progress",
  "done",
  "review_requested",
  "reviewed",
  "cancelled",
] as const;

export function handleCreateTask(
  db: Database.Database,
  sessionId: string,
  args: { short_name?: string; description: string; context?: string; assigned_to?: string },
  projectRoot: string,
): { task_id: string } {
  if (args.short_name !== undefined) {
    validateStringLength(args.short_name, 50, "short_name");
  }
  validateStringLength(args.description, 10_000, "description");
  if (args.context !== undefined) {
    validateStringLength(args.context, 10_000, "context");
  }
  if (args.assigned_to !== undefined) {
    validateUuid(args.assigned_to);
  }

  const input: CreateTaskInput = {
    short_name: args.short_name,
    description: args.description,
    context: args.context,
    assigned_to: args.assigned_to,
  };
  const taskId = createTask(db, sessionId, input);
  return { task_id: taskId };
}

export function handleListTasks(
  db: Database.Database,
  sessionId: string,
  args: { status?: string; assigned_to?: string; mine?: boolean },
): Task[] {
  if (args.status) {
    validateEnum(args.status, TASK_STATUSES, "status");
  }
  if (args.assigned_to) {
    validateUuid(args.assigned_to);
  }

  const filter: TaskFilter = {
    status: args.status,
    assigned_to: args.assigned_to,
    mine: args.mine ? sessionId : undefined,
  };
  return listTasks(db, filter);
}

export function handleClaimTask(db: Database.Database, sessionId: string, taskId: string): Task {
  validateUuid(taskId);
  return claimTask(db, taskId, sessionId);
}

export function handleCompleteTask(
  db: Database.Database,
  sessionId: string,
  args: { task_id: string; summary: string; artifacts?: string[] },
  projectRoot: string,
): Task {
  validateUuid(args.task_id);
  validateStringLength(args.summary, 10_000, "summary");
  if (args.artifacts) {
    for (const artifact of args.artifacts) {
      validatePath(artifact, projectRoot);
    }
  }

  const input: CompleteTaskInput = {
    summary: args.summary,
    artifacts: args.artifacts,
  };
  return completeTask(db, args.task_id, sessionId, input);
}

export function handleCleanupCompletedTasks(db: Database.Database): {
  deleted_tasks: number;
  deleted_reviews: number;
  deleted_messages: number;
} {
  return cleanupCompletedTasks(db);
}
