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
 * Mirrors the two-step fallback from index.ts:
 * 1. Try explicit ID
 * 2. Try label
 * 3. Create new
 */
function startupSession(
  db: InstanceType<typeof Database>,
  opts: {
    label?: string;
    resumeSessionId?: string;
    resumeLabel?: string;
  },
): { sessionId: string; resumed: boolean } {
  const existing =
    (opts.resumeSessionId
      ? findDisconnectedSession(db, { sessionId: opts.resumeSessionId })
      : undefined) ??
    (opts.resumeLabel ? findDisconnectedSession(db, { label: opts.resumeLabel }) : undefined);

  if (existing) {
    resumeSession(db, existing.id, { label: opts.label });
    return { sessionId: existing.id, resumed: true };
  }

  const sessionId = createSession(db, opts.label);
  return { sessionId, resumed: false };
}

// ---------------------------------------------------------------------------
// Fresh start (no resume env vars)
// ---------------------------------------------------------------------------

describe("startup: fresh start", () => {
  it("creates a new session when no resume vars are set", () => {
    const { sessionId, resumed } = startupSession(db, {
      label: "claude-main",
    });

    expect(resumed).toBe(false);
    const session = getSession(db, sessionId)!;
    expect(session.status).toBe("active");
    expect(session.label).toBe("claude-main");
  });

  it("creates a new session when no disconnected sessions exist", () => {
    // Active session with the same label — should NOT resume
    createSession(db, "claude-main");

    const { resumed } = startupSession(db, {
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
    const original = createSession(db, "claude-main");
    updateSessionStatus(db, original, "disconnected");

    const { sessionId, resumed } = startupSession(db, {
      label: "claude-main",
      resumeSessionId: original,
    });

    expect(resumed).toBe(true);
    expect(sessionId).toBe(original);
    expect(getSession(db, sessionId)!.status).toBe("active");
  });

  it("creates new session when explicit ID is not disconnected", () => {
    const active = createSession(db, "claude-main"); // active

    const { sessionId, resumed } = startupSession(db, {
      resumeSessionId: active,
    });

    expect(resumed).toBe(false);
    expect(sessionId).not.toBe(active);
  });

  it("creates new session when explicit ID does not exist", () => {
    const { resumed } = startupSession(db, {
      resumeSessionId: "00000000-0000-0000-0000-000000000000",
    });

    expect(resumed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Resume by label (FWENS_RESUME_LABEL)
// ---------------------------------------------------------------------------

describe("startup: FWENS_RESUME_LABEL", () => {
  it("resumes the most recent disconnected session matching the label", () => {
    const old = createSession(db, "claude-main");
    updateSessionStatus(db, old, "disconnected");
    db.prepare(`UPDATE sessions SET last_seen_at = datetime('now', '-1 hour') WHERE id = ?`).run(
      old,
    );

    const recent = createSession(db, "claude-main");
    updateSessionStatus(db, recent, "disconnected");

    const { sessionId, resumed } = startupSession(db, {
      label: "claude-main",
      resumeLabel: "claude-main",
    });

    expect(resumed).toBe(true);
    expect(sessionId).toBe(recent);
  });

  it("updates label on resume when a new label is provided", () => {
    const original = createSession(db, "old-label");
    updateSessionStatus(db, original, "disconnected");

    const { sessionId } = startupSession(db, {
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
  it("resumes by ID when both match disconnected sessions", () => {
    const labelMatch = createSession(db, "claude-main");
    updateSessionStatus(db, labelMatch, "disconnected");

    const idMatch = createSession(db, "claude-other");
    updateSessionStatus(db, idMatch, "disconnected");

    const { sessionId, resumed } = startupSession(db, {
      resumeSessionId: idMatch,
      resumeLabel: "claude-main",
    });

    expect(resumed).toBe(true);
    expect(sessionId).toBe(idMatch);
  });

  it("falls back to label when the explicit ID is not disconnected", () => {
    const labelMatch = createSession(db, "claude-main");
    updateSessionStatus(db, labelMatch, "disconnected");

    const stillActive = createSession(db, "other"); // active, can't be resumed

    const { sessionId, resumed } = startupSession(db, {
      resumeSessionId: stillActive,
      resumeLabel: "claude-main",
    });

    expect(resumed).toBe(true);
    expect(sessionId).toBe(labelMatch);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: full lifecycle with resume
// ---------------------------------------------------------------------------

describe("startup: full lifecycle with resume", () => {
  it("agent starts -> works -> disconnects -> resumes -> continues work", () => {
    const { sessionId: first } = startupSession(db, {
      label: "claude-main",
    });

    const taskId = createTask(db, first, {
      short_name: "implement feature",
      description: "Build the thing",
      assigned_to: first,
    });

    updateSessionStatus(db, first, "disconnected");

    const { sessionId: second, resumed } = startupSession(db, {
      label: "claude-main",
      resumeLabel: "claude-main",
    });

    expect(resumed).toBe(true);
    expect(second).toBe(first);

    const tasks = listTasks(db, { assigned_to: second });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(taskId);
  });

  it("does not create duplicate sessions on resume", () => {
    const { sessionId: first } = startupSession(db, {
      label: "claude-main",
    });

    updateSessionStatus(db, first, "disconnected");

    startupSession(db, {
      label: "claude-main",
      resumeLabel: "claude-main",
    });

    const all = listSessions(db);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(first);
    expect(all[0].status).toBe("active");
  });

  it("multi-agent scenario: each agent resumes its own session by label", () => {
    const { sessionId: claude } = startupSession(db, {
      label: "claude-main",
    });
    const { sessionId: gemini } = startupSession(db, {
      label: "gemini-main",
    });

    updateSessionStatus(db, claude, "disconnected");
    updateSessionStatus(db, gemini, "disconnected");

    const claudeResume = startupSession(db, {
      label: "claude-main",
      resumeLabel: "claude-main",
    });
    const geminiResume = startupSession(db, {
      label: "gemini-main",
      resumeLabel: "gemini-main",
    });

    expect(claudeResume.sessionId).toBe(claude);
    expect(claudeResume.resumed).toBe(true);
    expect(geminiResume.sessionId).toBe(gemini);
    expect(geminiResume.resumed).toBe(true);

    expect(listSessions(db)).toHaveLength(2);
  });
});
