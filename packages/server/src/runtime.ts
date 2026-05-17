import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initializeDb } from "./schema.js";
import {
  createSession,
  findDisconnectedSession,
  pruneStaleSessions,
  resumeSession,
  updateLastSeen,
  updateSessionStatus,
} from "./db.js";

export interface RuntimeConfig {
  projectRoot: string;
  agentLabel?: string;
  resumeSessionId?: string;
  resumeLabel?: string;
  // Skip the heartbeat DB write if fewer than this many ms have elapsed
  // since the last write. Defaults to 30s, configurable via
  // FWENS_HEARTBEAT_DEBOUNCE_MS. Set to 0 to disable debouncing.
  heartbeatDebounceMs?: number;
  // Clock injection for tests.
  now?: () => number;
}

// 30s default debounce on per-heartbeat last_seen_at updates. Bounded well
// below the 24h prune threshold, so functionally invisible to consumers.
export const DEFAULT_HEARTBEAT_DEBOUNCE_MS = 30_000;

export interface RuntimeState {
  db: Database.Database;
  dbPath: string;
  fwensDir: string;
  sessionId: string;
}

export interface RuntimeManager {
  getRuntime: () => RuntimeState;
  heartbeat: () => RuntimeState;
  isInitialized: () => boolean;
  shutdown: () => void;
}

export function createRuntimeManager(config: RuntimeConfig): RuntimeManager {
  let state: RuntimeState | undefined;
  let lastHeartbeatWriteAt = 0;

  const envDebounce = process.env.FWENS_HEARTBEAT_DEBOUNCE_MS;
  const debounceMs =
    config.heartbeatDebounceMs ??
    (envDebounce !== undefined && Number.isFinite(Number(envDebounce))
      ? Number(envDebounce)
      : DEFAULT_HEARTBEAT_DEBOUNCE_MS);
  const now = config.now ?? (() => Date.now());

  function getRuntime(): RuntimeState {
    if (state) {
      return state;
    }

    const fwensDir = path.join(config.projectRoot, ".fwens");
    fs.mkdirSync(fwensDir, { recursive: true });

    const dbPath = path.join(fwensDir, "fwens.db");
    // Explicit 5s busy timeout. better-sqlite3 defaults to this value, but
    // setting it explicitly documents the intent and protects against
    // upstream default changes. Two writers racing on the same .fwens.db
    // will serialize via WAL; the loser waits up to this long.
    const db = new Database(dbPath, { timeout: 5000 });
    initializeDb(db);

    // Try to resume an existing disconnected session. The resumeSession call
    // itself is the atomic claim (conditional UPDATE on status='disconnected'),
    // so two processes racing on the same row will not both succeed; the loser
    // falls through and creates a fresh session.
    let sessionId: string | undefined;
    const candidate =
      (config.resumeSessionId
        ? findDisconnectedSession(db, { sessionId: config.resumeSessionId })
        : undefined) ??
      (config.resumeLabel ? findDisconnectedSession(db, { label: config.resumeLabel }) : undefined);

    if (candidate) {
      const resumed = resumeSession(db, candidate.id, {
        label: config.agentLabel,
        pid: process.pid,
      });
      if (resumed) {
        sessionId = resumed.id;
      }
    }

    if (!sessionId) {
      sessionId = createSession(db, config.agentLabel, process.pid);
    }
    const existingSession = candidate && sessionId === candidate.id ? candidate : undefined;

    // Sweep stale sessions left behind by crashed processes. Logs each
    // prune event to .fwens/prune-events.jsonl so vanishing sessions are
    // traceable post-mortem.
    const pruneResult = pruneStaleSessions(db);
    if (pruneResult.events.length > 0) {
      try {
        const pruneLogPath = path.join(fwensDir, "prune-events.jsonl");
        const lines = pruneResult.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
        fs.appendFileSync(pruneLogPath, lines);
      } catch {
        // Best-effort logging.
      }
    }

    // Best-effort history log: never block startup on a read-only fs, full
    // disk, or permission error. The DB write is the authoritative record.
    try {
      const historyPath = path.join(fwensDir, "session-history.jsonl");
      const historyEntry =
        JSON.stringify({
          session_id: sessionId,
          label: config.agentLabel ?? null,
          resumed: !!existingSession,
          previous_connected_at: existingSession?.connected_at ?? null,
          timestamp: new Date().toISOString(),
        }) + "\n";
      fs.appendFileSync(historyPath, historyEntry);
    } catch {
      // Best-effort logging.
    }

    // Note: cleanupCompletedTasks is intentionally NOT called here. Deleting
    // history at boot is hostile to debugging and breaks any prerequisite
    // chain that references done-task IDs (e.g., multi-wave review flows).
    // The MCP tool is still exposed for explicit cleanup when the user
    // actually wants it.

    state = {
      db,
      dbPath,
      fwensDir,
      sessionId,
    };
    return state;
  }

  function heartbeat(): RuntimeState {
    const runtime = getRuntime();
    const t = now();
    if (t - lastHeartbeatWriteAt >= debounceMs) {
      updateLastSeen(runtime.db, runtime.sessionId);
      lastHeartbeatWriteAt = t;
    }
    return runtime;
  }

  function shutdown(): void {
    if (!state) {
      return;
    }

    try {
      updateSessionStatus(state.db, state.sessionId, "disconnected");
    } catch {
      // db may already be closed
    }
    try {
      state.db.close();
    } catch {
      // ignore
    }
  }

  return {
    getRuntime,
    heartbeat,
    isInitialized: () => !!state,
    shutdown,
  };
}
