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
    const id = createSession(db, "claude", "claude-main");
    updateSessionStatus(db, id, "disconnected");

    const found = findDisconnectedSession(db, { label: "claude-main" });
    expect(found).toBeDefined();
    expect(found!.id).toBe(id);
    expect(found!.status).toBe("disconnected");
  });

  it("finds a disconnected session by label and agent_type", () => {
    const id = createSession(db, "claude", "worker");
    updateSessionStatus(db, id, "disconnected");

    // Same label, different agent_type — should not match
    const geminiId = createSession(db, "gemini", "worker");
    updateSessionStatus(db, geminiId, "disconnected");

    const found = findDisconnectedSession(db, {
      label: "worker",
      agentType: "claude",
    });
    expect(found).toBeDefined();
    expect(found!.id).toBe(id);
    expect(found!.agent_type).toBe("claude");
  });

  it("returns the most recently seen session when multiple match", () => {
    const old = createSession(db, "claude", "claude-main");
    updateSessionStatus(db, old, "disconnected");
    // Force an earlier last_seen_at
    db.prepare(`UPDATE sessions SET last_seen_at = datetime('now', '-1 hour') WHERE id = ?`).run(
      old,
    );

    const recent = createSession(db, "claude", "claude-main");
    updateSessionStatus(db, recent, "disconnected");

    const found = findDisconnectedSession(db, { label: "claude-main" });
    expect(found!.id).toBe(recent);
  });

  it("returns undefined when no disconnected session matches the label", () => {
    createSession(db, "claude", "claude-main"); // active, not disconnected

    const found = findDisconnectedSession(db, { label: "claude-main" });
    expect(found).toBeUndefined();
  });

  it("returns undefined when label does not exist at all", () => {
    const found = findDisconnectedSession(db, { label: "nonexistent" });
    expect(found).toBeUndefined();
  });

  it("does not match sessions with different statuses (active, idle, busy, stuck)", () => {
    for (const status of ["active", "idle", "busy", "stuck"] as const) {
      const id = createSession(db, "claude", `label-${status}`);
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
    const id = createSession(db, "claude", "claude-main");
    updateSessionStatus(db, id, "disconnected");

    const found = findDisconnectedSession(db, { sessionId: id });
    expect(found).toBeDefined();
    expect(found!.id).toBe(id);
  });

  it("returns undefined for explicit ID that is not disconnected", () => {
    const id = createSession(db, "claude", "claude-main"); // active

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
    const byLabel = createSession(db, "claude", "claude-main");
    updateSessionStatus(db, byLabel, "disconnected");

    const byId = createSession(db, "gemini", "gemini-main");
    updateSessionStatus(db, byId, "disconnected");

    // Pass both — sessionId should win (same agent_type as byId)
    const found = findDisconnectedSession(db, {
      sessionId: byId,
      label: "claude-main",
      agentType: "gemini",
    });
    expect(found!.id).toBe(byId);
  });
});

// ---------------------------------------------------------------------------
// Security: cross-agent session hijack prevention
// ---------------------------------------------------------------------------

describe("cross-agent session hijack prevention", () => {
  it("explicit ID lookup enforces agent_type when provided", () => {
    const geminiId = createSession(db, "gemini", "gemini-main");
    updateSessionStatus(db, geminiId, "disconnected");

    // Claude trying to resume Gemini's session by ID — should be blocked
    const found = findDisconnectedSession(db, {
      sessionId: geminiId,
      agentType: "claude",
    });
    expect(found).toBeUndefined();
  });

  it("explicit ID lookup works when agent_type matches", () => {
    const claudeId = createSession(db, "claude", "claude-main");
    updateSessionStatus(db, claudeId, "disconnected");

    const found = findDisconnectedSession(db, {
      sessionId: claudeId,
      agentType: "claude",
    });
    expect(found).toBeDefined();
    expect(found!.id).toBe(claudeId);
  });

  it("explicit ID lookup without agentType still works (backwards compat)", () => {
    const geminiId = createSession(db, "gemini", "gemini-main");
    updateSessionStatus(db, geminiId, "disconnected");

    // No agentType filter — should find it
    const found = findDisconnectedSession(db, {
      sessionId: geminiId,
    });
    expect(found).toBeDefined();
    expect(found!.id).toBe(geminiId);
  });

  it("label-based lookup already enforces agent_type", () => {
    const geminiId = createSession(db, "gemini", "shared-label");
    updateSessionStatus(db, geminiId, "disconnected");

    // Claude trying to resume via label — should not match Gemini
    const found = findDisconnectedSession(db, {
      label: "shared-label",
      agentType: "claude",
    });
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resumeSession
// ---------------------------------------------------------------------------

describe("resumeSession", () => {
  it("reactivates a disconnected session", () => {
    const id = createSession(db, "claude", "claude-main");
    updateSessionStatus(db, id, "disconnected");

    const resumed = resumeSession(db, id);
    expect(resumed!.id).toBe(id);
    expect(resumed!.status).toBe("active");
  });

  it("preserves the original connected_at timestamp", () => {
    const id = createSession(db, "claude", "claude-main");
    const originalConnectedAt = getSession(db, id)!.connected_at;
    updateSessionStatus(db, id, "disconnected");

    const resumed = resumeSession(db, id);
    expect(resumed!.connected_at).toBe(originalConnectedAt);
  });

  it("updates last_seen_at to now", () => {
    const id = createSession(db, "claude", "claude-main");
    // Force old last_seen_at
    db.prepare(`UPDATE sessions SET last_seen_at = datetime('now', '-1 day') WHERE id = ?`).run(id);
    updateSessionStatus(db, id, "disconnected");

    const before = getSession(db, id)!.last_seen_at;
    const resumed = resumeSession(db, id);
    // last_seen_at should be updated (>= before, or at least refreshed)
    expect(resumed!.last_seen_at).not.toBe(before);
  });

  it("optionally updates the label on resume", () => {
    const id = createSession(db, "claude", "old-label");
    updateSessionStatus(db, id, "disconnected");

    const resumed = resumeSession(db, id, { label: "new-label" });
    expect(resumed!.label).toBe("new-label");
  });

  it("keeps existing label when no new label is provided", () => {
    const id = createSession(db, "claude", "keep-me");
    updateSessionStatus(db, id, "disconnected");

    const resumed = resumeSession(db, id);
    expect(resumed!.label).toBe("keep-me");
  });

  it("returns undefined when session does not exist", () => {
    expect(resumeSession(db, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });

  it("returns undefined when session is not disconnected", () => {
    const id = createSession(db, "claude", "still-active");
    // Session is 'active', not 'disconnected'
    expect(resumeSession(db, id)).toBeUndefined();
  });

  it("is atomic: a second resume on the same disconnected row returns undefined", () => {
    // Simulates two processes racing on the same disconnected session row.
    // The conditional UPDATE in resumeSession is the lock — only the first
    // call sees changes > 0; the second sees the row already 'active' and
    // bails out instead of throwing.
    const id = createSession(db, "claude", "race-target");
    updateSessionStatus(db, id, "disconnected");

    const first = resumeSession(db, id, { pid: 100 });
    const second = resumeSession(db, id, { pid: 200 });

    expect(first?.id).toBe(id);
    expect(first?.pid).toBe(100);
    expect(second).toBeUndefined();
    // The first claimer's pid is preserved — the second call never wrote.
    expect(first?.pid).toBe(100);
  });

  it("preserves token count across resume", () => {
    const id = createSession(db, "claude", "claude-main");
    // Simulate token usage
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
    // Create session, do some work, disconnect, resume
    sessionId = createSession(db, "claude", "claude-main");

    // Create and complete a task
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

    // Request review
    requestReview(db, taskId, sessionId, "Check correctness");

    // Post messages
    postMessage(db, sessionId, {
      channel: `task:${taskId}`,
      content: "Working on it",
    });
    postMessage(db, sessionId, {
      channel: "general",
      content: "Hello from claude",
    });

    // Disconnect
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
    expect(messages).toHaveLength(2); // original + new
    expect(messages[1].content).toBe("I'm back!");
    expect(messages[1].author).toBe(sessionId);
  });
});

// ---------------------------------------------------------------------------
// Resume with open tasks (reconnecting to in-flight work)
// ---------------------------------------------------------------------------

describe("resume reconnects to in-flight work", () => {
  it("open tasks assigned to the session are still visible after resume", () => {
    const sessionId = createSession(db, "claude", "claude-main");
    const otherId = createSession(db, "gemini", "orchestrator");

    // Another agent created a task for us
    const taskId = createTask(db, otherId, {
      description: "Assigned to claude",
      assigned_to: sessionId,
    });

    // Disconnect before claiming
    updateSessionStatus(db, sessionId, "disconnected");

    // Resume
    resumeSession(db, sessionId);

    // Task should still be assigned to us
    const tasks = listTasks(db, { assigned_to: sessionId });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(taskId);
    expect(tasks[0].status).toBe("open");
  });

  it("in-progress tasks survive disconnect and resume", () => {
    const sessionId = createSession(db, "claude", "claude-main");
    const taskId = createTask(db, sessionId, {
      description: "Long running work",
    });
    claimTask(db, taskId, sessionId);

    // Disconnect mid-work
    updateSessionStatus(db, sessionId, "disconnected");

    // Resume
    resumeSession(db, sessionId);

    // Task should still be in_progress, assigned to us
    const task = getTask(db, taskId)!;
    expect(task.status).toBe("in_progress");
    expect(task.assigned_to).toBe(sessionId);

    // Can complete it now
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
    const id = createSession(db, "claude", "claude-main");

    for (let i = 0; i < 5; i++) {
      updateSessionStatus(db, id, "disconnected");
      const session = resumeSession(db, id);
      expect(session!.status).toBe("active");
      expect(session!.id).toBe(id);
    }
  });

  it("accumulates work across multiple resume cycles", () => {
    const id = createSession(db, "claude", "claude-main");
    const taskIds: string[] = [];

    for (let i = 0; i < 3; i++) {
      // Do work
      const taskId = createTask(db, id, {
        description: `Task from cycle ${i}`,
      });
      taskIds.push(taskId);
      claimTask(db, taskId, id);
      completeTask(db, taskId, id, { summary: `Done in cycle ${i}` });

      // Disconnect
      updateSessionStatus(db, id, "disconnected");

      // Resume
      resumeSession(db, id);
    }

    // All tasks should exist and be completed
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
    // Session without a label
    const id = createSession(db, "claude");
    updateSessionStatus(db, id, "disconnected");

    // Should not match an empty-string label search
    const found = findDisconnectedSession(db, { label: "" });
    expect(found).toBeUndefined();
  });

  it("label matching is case-sensitive", () => {
    const id = createSession(db, "claude", "Claude-Main");
    updateSessionStatus(db, id, "disconnected");

    const found = findDisconnectedSession(db, { label: "claude-main" });
    expect(found).toBeUndefined();

    const foundExact = findDisconnectedSession(db, { label: "Claude-Main" });
    expect(foundExact).toBeDefined();
    expect(foundExact!.id).toBe(id);
  });

  it("ignores disconnected sessions with different agent_type", () => {
    const claudeId = createSession(db, "claude", "shared-label");
    const geminiId = createSession(db, "gemini", "shared-label");
    updateSessionStatus(db, claudeId, "disconnected");
    updateSessionStatus(db, geminiId, "disconnected");

    const found = findDisconnectedSession(db, {
      label: "shared-label",
      agentType: "gemini",
    });
    expect(found!.id).toBe(geminiId);
  });

  it("label-only search (no agent_type) returns most recent regardless of type", () => {
    const claudeId = createSession(db, "claude", "shared-label");
    updateSessionStatus(db, claudeId, "disconnected");
    db.prepare(`UPDATE sessions SET last_seen_at = datetime('now', '-1 hour') WHERE id = ?`).run(
      claudeId,
    );

    const geminiId = createSession(db, "gemini", "shared-label");
    updateSessionStatus(db, geminiId, "disconnected");

    const found = findDisconnectedSession(db, { label: "shared-label" });
    expect(found!.id).toBe(geminiId); // more recent
  });
});
