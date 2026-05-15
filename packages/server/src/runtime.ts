import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initializeDb } from "./schema.js";
import {
  cleanupCompletedTasks,
  createSession,
  findDisconnectedSession,
  pruneStaleSessions,
  resumeSession,
  updateLastSeen,
  updateSessionStatus,
} from "./db.js";

export interface RuntimeConfig {
  projectRoot: string;
  agentType: string;
  agentLabel?: string;
  resumeSessionId?: string;
  resumeLabel?: string;
}

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

  function getRuntime(): RuntimeState {
    if (state) {
      return state;
    }

    const fwensDir = path.join(config.projectRoot, ".fwens");
    fs.mkdirSync(fwensDir, { recursive: true });

    const dbPath = path.join(fwensDir, "fwens.db");
    const db = new Database(dbPath);
    initializeDb(db);

    const existingSession =
      (config.resumeSessionId
        ? findDisconnectedSession(db, {
            sessionId: config.resumeSessionId,
            agentType: config.agentType,
          })
        : undefined) ??
      (config.resumeLabel
        ? findDisconnectedSession(db, {
            label: config.resumeLabel,
            agentType: config.agentType,
          })
        : undefined);

    const sessionId = existingSession
      ? existingSession.id
      : createSession(db, config.agentType, config.agentLabel, process.pid);

    if (existingSession) {
      resumeSession(db, existingSession.id, {
        label: config.agentLabel,
        pid: process.pid,
      });
    }

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

    const historyPath = path.join(fwensDir, "session-history.jsonl");
    const historyEntry =
      JSON.stringify({
        session_id: sessionId,
        agent_type: config.agentType,
        label: config.agentLabel ?? null,
        resumed: !!existingSession,
        previous_connected_at: existingSession?.connected_at ?? null,
        timestamp: new Date().toISOString(),
      }) + "\n";
    fs.appendFileSync(historyPath, historyEntry);

    cleanupCompletedTasks(db);

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
    updateLastSeen(runtime.db, runtime.sessionId);
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
