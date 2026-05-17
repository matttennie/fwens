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
  postMessage,
  readMessages,
  requestReview,
  listReviews,
  findDisconnectedSession,
  resumeSession,
} from "../db.js";

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
});

// ---------------------------------------------------------------------------
// findDisconnectedSession
// ---------------------------------------------------------------------------

describe("findDisconnectedSession", () => {
  it("finds a disconnected session by label", () => {
    const id = createSession(db, "claude-main");
    updateSessionStatus(db, id, "disconnected");

    const found = findDisconnectedSession(db, { label: "claude-main" });
    expect(found).toBeDefined();
    expect(found!.id).toBe(id);
    expect(found!.status).toBe("disconnected");
  });

  it("returns the most recently seen session when multiple match", () => {
    const old = createSession(db, "claude-main");
    updateSessionStatus(db, old, "disconnected");
    db.prepare(`UPDATE sessions SET last_seen_at = datetime('now', '-1 hour') WHERE id = ?`).run(
      old,
    );

    const recent = createSession(db, "claude-main");
    updateSessionStatus(db, recent, "disconnected");

    const found = findDisconnectedSession(db, { label: "claude-main" });
    expect(found!.id).toBe(recent);
  });

  it("returns undefined when no disconnected session matches the label", () => {
    createSession(db, "claude-main"); // active, not disconnected

    const found = findDisconnectedSession(db, { label: "claude-main" });
    expect(found).toBeUndefined();
  });

  it("returns undefined when label does not exist at all", () => {
    const found = findDisconnectedSession(db, { label: "nonexistent" });
    expect(found).toBeUndefined();
  });

  it("does not match sessions with different statuses (active, idle, busy, stuck)", () => {
    for (const status of ["active", "idle", "busy", "stuck"] as const) {
      const id = createSession(db, `label-${status}`);
      updateSessionStatus(db, id, status);
    }

    for (const status of ["active", "idle", "busy", "stuck"]) {
      const found = findDisconnectedSession(db, {
        label: `label-${status}`,
      });
      expect(found).toBeUndefined();
    }
  });

  it("finds by explicit session ID", () => {
    const id = createSession(db, "claude-main");
    updateSessionStatus(db, id, "disconnected");

    const found = findDisconnectedSession(db, { sessionId: id });
    expect(found).toBeDefined();
    expect(found!.id).toBe(id);
  });

  it("returns undefined for explicit ID that is not disconnected", () => {
    const id = createSession(db, "claude-main"); // active

    const found = findDisconnectedSession(db, { sessionId: id });
    expect(found).toBeUndefined();
  });

  it("returns undefined for explicit ID that does not exist", () => {
    const found = findDisconnectedSession(db, {
      sessionId: "00000000-0000-0000-0000-000000000000",
    });
    expect(found).toBeUndefined();
  });

  it("explicit ID takes precedence over label", () => {
    const byLabel = createSession(db, "claude-main");
    updateSessionStatus(db, byLabel, "disconnected");

    const byId = createSession(db, "gemini-main");
    updateSessionStatus(db, byId, "disconnected");

    const found = findDisconnectedSession(db, {
      sessionId: byId,
      label: "claude-main",
    });
    expect(found!.id).toBe(byId);
  });
});

// ---------------------------------------------------------------------------
// resumeSession
// ---------------------------------------------------------------------------

describe("resumeSession", () => {
  it("reactivates a disconnected session", () => {
    const id = createSession(db, "claude-main");
    updateSessionStatus(db, id, "disconnected");

    const resumed = resumeSession(db, id);
    expect(resumed!.id).toBe(id);
    expect(resumed!.status).toBe("active");
  });

  it("preserves the original connected_at timestamp", () => {
    const id = createSession(db, "claude-main");
    const originalConnectedAt = getSession(db, id)!.connected_at;
    updateSessionStatus(db, id, "disconnected");

    const resumed = resumeSession(db, id);
    expect(resumed!.connected_at).toBe(originalConnectedAt);
  });

  it("updates last_seen_at to now", () => {
    const id = createSession(db, "claude-main");
    db.prepare(`UPDATE sessions SET last_seen_at = datetime('now', '-1 day') WHERE id = ?`).run(id);
    updateSessionStatus(db, id, "disconnected");

    const before = getSession(db, id)!.last_seen_at;
    const resumed = resumeSession(db, id);
    expect(resumed!.last_seen_at).not.toBe(before);
  });

  it("optionally updates the label on resume", () => {
    const id = createSession(db, "old-label");
    updateSessionStatus(db, id, "disconnected");

    const resumed = resumeSession(db, id, { label: "new-label" });
    expect(resumed!.label).toBe("new-label");
  });

  it("keeps existing label when no new label is provided", () => {
    const id = createSession(db, "keep-me");
    updateSessionStatus(db, id, "disconnected");

    const resumed = resumeSession(db, id);
    expect(resumed!.label).toBe("keep-me");
  });

  it("returns undefined when session does not exist", () => {
    expect(resumeSession(db, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });

  it("returns undefined when session is not disconnected", () => {
    const id = createSession(db, "still-active");
    expect(resumeSession(db, id)).toBeUndefined();
  });

  it("is atomic: a second resume on the same disconnected row returns undefined", () => {
    // Simulates two processes racing on the same disconnected session row.
    // The conditional UPDATE in resumeSession is the lock — only the first
    // call sees changes > 0; the second sees the row already 'active' and
    // bails out instead of throwing.
    const id = createSession(db, "race-target");
    updateSessionStatus(db, id, "disconnected");

    const first = resumeSession(db, id, { pid: 100 });
    const second = resumeSession(db, id, { pid: 200 });

    expect(first?.id).toBe(id);
    expect(first?.pid).toBe(100);
    expect(second).toBeUndefined();
    expect(first?.pid).toBe(100);
  });

  it("preserves token count across resume", () => {
    const id = createSession(db, "claude-main");
    db.prepare(`UPDATE sessions SET tokens_used = 42000 WHERE id = ?`).run(id);
    updateSessionStatus(db, id, "disconnected");

    const resumed = resumeSession(db, id);
    expect(resumed!.tokens_used).toBe(42000);
  });
});

// ---------------------------------------------------------------------------
// Resume preserves foreign key relationships
// ---------------------------------------------------------------------------

describe("resumed session preserves existing data", () => {
  let sessionId: string;
  let taskId: string;

  beforeEach(() => {
    sessionId = createSession(db, "claude-main");

    taskId = createTask(db, sessionId, {
      short_name: "test task",
      description: "Do something important",
      context: "Background info",
    });
    claimTask(db, taskId, sessionId);
    completeTask(db, taskId, sessionId, {
      summary: "Done",
      artifacts: ["file.ts"],
    });

    requestReview(db, taskId, sessionId, "Check correctness");

    postMessage(db, sessionId, {
      channel: `task:${taskId}`,
      content: "Working on it",
    });
    postMessage(db, sessionId, {
      channel: "general",
      content: "Hello from claude",
    });

    updateSessionStatus(db, sessionId, "disconnected");
  });

  it("tasks remain assigned to the resumed session", () => {
    resumeSession(db, sessionId);

    const task = getTask(db, taskId)!;
    expect(task.assigned_to).toBe(sessionId);
    expect(task.created_by).toBe(sessionId);
  });

  it("reviews reference the resumed session", () => {
    resumeSession(db, sessionId);

    const reviews = listReviews(db, { task_id: taskId });
    expect(reviews).toHaveLength(1);
    expect(reviews[0].reviewer).toBe(sessionId);
  });

  it("messages authored by the session are preserved", () => {
    resumeSession(db, sessionId);

    const taskMessages = readMessages(db, { channel: `task:${taskId}` });
    expect(taskMessages).toHaveLength(1);
    expect(taskMessages[0].author).toBe(sessionId);
    expect(taskMessages[0].content).toBe("Working on it");

    const generalMessages = readMessages(db, { channel: "general" });
    expect(generalMessages).toHaveLength(1);
    expect(generalMessages[0].author).toBe(sessionId);
  });

  it("can create new tasks after resume", () => {
    resumeSession(db, sessionId);

    const newTaskId = createTask(db, sessionId, {
      description: "New work after resume",
    });
    const newTask = getTask(db, newTaskId)!;
    expect(newTask.created_by).toBe(sessionId);
    expect(newTask.status).toBe("open");
  });

  it("can claim and complete new tasks after resume", () => {
    resumeSession(db, sessionId);

    const newTaskId = createTask(db, sessionId, {
      description: "Another task",
    });
    const claimed = claimTask(db, newTaskId, sessionId);
    expect(claimed.status).toBe("in_progress");

    const completed = completeTask(db, newTaskId, sessionId, {
      summary: "Also done",
    });
    expect(completed.status).toBe("done");
  });

  it("can post messages after resume", () => {
    resumeSession(db, sessionId);

    postMessage(db, sessionId, {
      channel: "general",
      content: "I'm back!",
    });

    const messages = readMessages(db, { channel: "general" });
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe("I'm back!");
    expect(messages[1].author).toBe(sessionId);
  });
});

// ---------------------------------------------------------------------------
// Resume with open tasks (reconnecting to in-flight work)
// ---------------------------------------------------------------------------

describe("resume reconnects to in-flight work", () => {
  it("open tasks assigned to the session are still visible after resume", () => {
    const sessionId = createSession(db, "claude-main");
    const otherId = createSession(db, "orchestrator");

    const taskId = createTask(db, otherId, {
      description: "Assigned to claude",
      assigned_to: sessionId,
    });

    updateSessionStatus(db, sessionId, "disconnected");

    resumeSession(db, sessionId);

    const tasks = listTasks(db, { assigned_to: sessionId });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(taskId);
    expect(tasks[0].status).toBe("open");
  });

  it("in-progress tasks survive disconnect and resume", () => {
    const sessionId = createSession(db, "claude-main");
    const taskId = createTask(db, sessionId, {
      description: "Long running work",
    });
    claimTask(db, taskId, sessionId);

    updateSessionStatus(db, sessionId, "disconnected");

    resumeSession(db, sessionId);

    const task = getTask(db, taskId)!;
    expect(task.status).toBe("in_progress");
    expect(task.assigned_to).toBe(sessionId);

    const completed = completeTask(db, taskId, sessionId, {
      summary: "Finished after resume",
    });
    expect(completed.status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// Multiple resume cycles
// ---------------------------------------------------------------------------

describe("multiple resume cycles", () => {
  it("can disconnect and resume the same session multiple times", () => {
    const id = createSession(db, "claude-main");

    for (let i = 0; i < 5; i++) {
      updateSessionStatus(db, id, "disconnected");
      const session = resumeSession(db, id);
      expect(session!.status).toBe("active");
      expect(session!.id).toBe(id);
    }
  });

  it("accumulates work across multiple resume cycles", () => {
    const id = createSession(db, "claude-main");
    const taskIds: string[] = [];

    for (let i = 0; i < 3; i++) {
      const taskId = createTask(db, id, {
        description: `Task from cycle ${i}`,
      });
      taskIds.push(taskId);
      claimTask(db, taskId, id);
      completeTask(db, taskId, id, { summary: `Done in cycle ${i}` });

      updateSessionStatus(db, id, "disconnected");

      resumeSession(db, id);
    }

    for (let i = 0; i < 3; i++) {
      const task = getTask(db, taskIds[i])!;
      expect(task.status).toBe("done");
      expect(task.summary).toBe(`Done in cycle ${i}`);
      expect(task.created_by).toBe(id);
    }
  });
});

// ---------------------------------------------------------------------------
// Label uniqueness edge cases
// ---------------------------------------------------------------------------

describe("label matching edge cases", () => {
  it("does not match on null labels", () => {
    const id = createSession(db);
    updateSessionStatus(db, id, "disconnected");

    const found = findDisconnectedSession(db, { label: "" });
    expect(found).toBeUndefined();
  });

  it("label matching is case-sensitive", () => {
    const id = createSession(db, "Claude-Main");
    updateSessionStatus(db, id, "disconnected");

    const found = findDisconnectedSession(db, { label: "claude-main" });
    expect(found).toBeUndefined();

    const foundExact = findDisconnectedSession(db, { label: "Claude-Main" });
    expect(foundExact).toBeDefined();
    expect(foundExact!.id).toBe(id);
  });

  it("returns the most recent match when multiple sessions share a label", () => {
    const older = createSession(db, "shared-label");
    updateSessionStatus(db, older, "disconnected");
    db.prepare(`UPDATE sessions SET last_seen_at = datetime('now', '-1 hour') WHERE id = ?`).run(
      older,
    );

    const newer = createSession(db, "shared-label");
    updateSessionStatus(db, newer, "disconnected");

    const found = findDisconnectedSession(db, { label: "shared-label" });
    expect(found!.id).toBe(newer);
  });
});
