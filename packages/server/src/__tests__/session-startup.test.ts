/**
 * Tests for the session startup logic that mirrors index.ts behavior:
 * FWENS_SESSION_ID -> FWENS_RESUME_LABEL -> create new session.
 *
 * These test the same decision tree that index.ts uses, exercising
 * findDisconnectedSession + resumeSession in the same patterns.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import {
  createSession,
  getSession,
  listSessions,
  updateSessionStatus,
  findDisconnectedSession,
  resumeSession,
  createTask,
  listTasks,
} from "../db.js";

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
});

/**
 * Mimics the startup logic from index.ts:
 * 1. Try FWENS_SESSION_ID
 * 2. Try FWENS_RESUME_LABEL
 * 3. Fall back to creating a new session
 */
/**
 * Mirrors the two-step fallback from index.ts:
 * 1. Try explicit ID (with agent_type enforcement)
 * 2. Try label
 * 3. Create new
 */
function startupSession(
  db: InstanceType<typeof Database>,
  opts: {
    agentType: string;
    label?: string;
    resumeSessionId?: string;
    resumeLabel?: string;
  },
): { sessionId: string; resumed: boolean } {
  const existing =
    (opts.resumeSessionId
      ? findDisconnectedSession(db, {
          sessionId: opts.resumeSessionId,
          agentType: opts.agentType,
        })
      : undefined) ??
    (opts.resumeLabel
      ? findDisconnectedSession(db, {
          label: opts.resumeLabel,
          agentType: opts.agentType,
        })
      : undefined);

  if (existing) {
    resumeSession(db, existing.id, { label: opts.label });
    return { sessionId: existing.id, resumed: true };
  }

  const sessionId = createSession(db, opts.agentType, opts.label);
  return { sessionId, resumed: false };
}

// ---------------------------------------------------------------------------
// Fresh start (no resume env vars)
// ---------------------------------------------------------------------------

describe("startup: fresh start", () => {
  it("creates a new session when no resume vars are set", () => {
    const { sessionId, resumed } = startupSession(db, {
      agentType: "claude",
      label: "claude-main",
    });

    expect(resumed).toBe(false);
    const session = getSession(db, sessionId)!;
    expect(session.status).toBe("active");
    expect(session.agent_type).toBe("claude");
    expect(session.label).toBe("claude-main");
  });

  it("creates a new session when no disconnected sessions exist", () => {
    // Active session with the same label — should NOT resume
    createSession(db, "claude", "claude-main");

    const { resumed } = startupSession(db, {
      agentType: "claude",
      label: "claude-main",
      resumeLabel: "claude-main",
    });
    expect(resumed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Resume by explicit session ID (FWENS_SESSION_ID)
// ---------------------------------------------------------------------------

describe("startup: FWENS_SESSION_ID", () => {
  it("resumes a disconnected session by explicit ID", () => {
    const original = createSession(db, "claude", "claude-main");
    updateSessionStatus(db, original, "disconnected");

    const { sessionId, resumed } = startupSession(db, {
      agentType: "claude",
      label: "claude-main",
      resumeSessionId: original,
    });

    expect(resumed).toBe(true);
    expect(sessionId).toBe(original);
    expect(getSession(db, sessionId)!.status).toBe("active");
  });

  it("creates new session when explicit ID is not disconnected", () => {
    const active = createSession(db, "claude", "claude-main"); // active

    const { sessionId, resumed } = startupSession(db, {
      agentType: "claude",
      resumeSessionId: active,
    });

    expect(resumed).toBe(false);
    expect(sessionId).not.toBe(active);
  });

  it("creates new session when explicit ID does not exist", () => {
    const { resumed } = startupSession(db, {
      agentType: "claude",
      resumeSessionId: "00000000-0000-0000-0000-000000000000",
    });

    expect(resumed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Resume by label (FWENS_RESUME_LABEL)
// ---------------------------------------------------------------------------

describe("startup: FWENS_RESUME_LABEL", () => {
  it("resumes the most recent disconnected session matching label + agent_type", () => {
    const old = createSession(db, "claude", "claude-main");
    updateSessionStatus(db, old, "disconnected");
    db.prepare(`UPDATE sessions SET last_seen_at = datetime('now', '-1 hour') WHERE id = ?`).run(
      old,
    );

    const recent = createSession(db, "claude", "claude-main");
    updateSessionStatus(db, recent, "disconnected");

    const { sessionId, resumed } = startupSession(db, {
      agentType: "claude",
      label: "claude-main",
      resumeLabel: "claude-main",
    });

    expect(resumed).toBe(true);
    expect(sessionId).toBe(recent);
  });

  it("does not resume a session from a different agent_type", () => {
    const gemini = createSession(db, "gemini", "worker");
    updateSessionStatus(db, gemini, "disconnected");

    const { sessionId, resumed } = startupSession(db, {
      agentType: "claude",
      label: "worker",
      resumeLabel: "worker",
    });

    expect(resumed).toBe(false);
    expect(sessionId).not.toBe(gemini);
  });

  it("updates label on resume when a new label is provided", () => {
    const original = createSession(db, "claude", "old-label");
    updateSessionStatus(db, original, "disconnected");

    const { sessionId } = startupSession(db, {
      agentType: "claude",
      label: "new-label",
      resumeLabel: "old-label",
    });

    expect(sessionId).toBe(original);
    expect(getSession(db, sessionId)!.label).toBe("new-label");
  });
});

// ---------------------------------------------------------------------------
// FWENS_SESSION_ID takes precedence over FWENS_RESUME_LABEL
// ---------------------------------------------------------------------------

describe("startup: ID takes precedence over label", () => {
  it("resumes by ID when agent_type matches", () => {
    const labelMatch = createSession(db, "claude", "claude-main");
    updateSessionStatus(db, labelMatch, "disconnected");

    const idMatch = createSession(db, "claude", "claude-other");
    updateSessionStatus(db, idMatch, "disconnected");

    const { sessionId, resumed } = startupSession(db, {
      agentType: "claude",
      resumeSessionId: idMatch,
      resumeLabel: "claude-main",
    });

    expect(resumed).toBe(true);
    expect(sessionId).toBe(idMatch); // ID wins over label
  });

  it("falls back to label when ID targets a different agent_type", () => {
    const labelMatch = createSession(db, "claude", "claude-main");
    updateSessionStatus(db, labelMatch, "disconnected");

    const wrongType = createSession(db, "gemini", "gemini-main");
    updateSessionStatus(db, wrongType, "disconnected");

    const { sessionId, resumed } = startupSession(db, {
      agentType: "claude",
      resumeSessionId: wrongType, // Gemini session — won't match claude
      resumeLabel: "claude-main",
    });

    expect(resumed).toBe(true);
    expect(sessionId).toBe(labelMatch); // fell back to label match
  });
});

// ---------------------------------------------------------------------------
// End-to-end: full lifecycle with resume
// ---------------------------------------------------------------------------

describe("startup: full lifecycle with resume", () => {
  it("agent starts -> works -> disconnects -> resumes -> continues work", () => {
    // First session
    const { sessionId: first } = startupSession(db, {
      agentType: "claude",
      label: "claude-main",
    });

    // Do work
    const taskId = createTask(db, first, {
      short_name: "implement feature",
      description: "Build the thing",
      assigned_to: first,
    });

    // Disconnect
    updateSessionStatus(db, first, "disconnected");

    // Second session with resume
    const { sessionId: second, resumed } = startupSession(db, {
      agentType: "claude",
      label: "claude-main",
      resumeLabel: "claude-main",
    });

    expect(resumed).toBe(true);
    expect(second).toBe(first);

    // Task is still ours
    const tasks = listTasks(db, { assigned_to: second });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(taskId);
  });

  it("does not create duplicate sessions on resume", () => {
    const { sessionId: first } = startupSession(db, {
      agentType: "claude",
      label: "claude-main",
    });

    updateSessionStatus(db, first, "disconnected");

    startupSession(db, {
      agentType: "claude",
      label: "claude-main",
      resumeLabel: "claude-main",
    });

    // Should still be only 1 session, not 2
    const all = listSessions(db);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(first);
    expect(all[0].status).toBe("active");
  });

  it("multi-agent scenario: each agent resumes its own session", () => {
    // Start both agents
    const { sessionId: claude } = startupSession(db, {
      agentType: "claude",
      label: "claude-main",
    });
    const { sessionId: gemini } = startupSession(db, {
      agentType: "gemini",
      label: "gemini-main",
    });

    // Both disconnect
    updateSessionStatus(db, claude, "disconnected");
    updateSessionStatus(db, gemini, "disconnected");

    // Both resume
    const claudeResume = startupSession(db, {
      agentType: "claude",
      label: "claude-main",
      resumeLabel: "claude-main",
    });
    const geminiResume = startupSession(db, {
      agentType: "gemini",
      label: "gemini-main",
      resumeLabel: "gemini-main",
    });

    expect(claudeResume.sessionId).toBe(claude);
    expect(claudeResume.resumed).toBe(true);
    expect(geminiResume.sessionId).toBe(gemini);
    expect(geminiResume.resumed).toBe(true);

    // Still only 2 sessions total
    expect(listSessions(db)).toHaveLength(2);
  });
});
