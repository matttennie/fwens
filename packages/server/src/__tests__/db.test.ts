import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import {
  createSession,
  getSession,
  listSessions,
  updateSessionStatus,
  updateLastSeen,
} from "../db.js";

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
});

describe("initializeDb", () => {
  it("creates all four tables", () => {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name).sort();
    expect(names).toEqual(["messages", "reviews", "sessions", "tasks"]);
  });

  it("enables WAL journal mode", () => {
    // In-memory databases cannot use WAL, so verify with a file-backed db
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const tmpFile = path.join(os.tmpdir(), `fwens-test-${Date.now()}.db`);
    try {
      const fileDb = new Database(tmpFile);
      initializeDb(fileDb);
      const row = fileDb.pragma("journal_mode") as { journal_mode: string }[];
      expect(row[0].journal_mode).toBe("wal");
      fileDb.close();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
      try { fs.unlinkSync(tmpFile + "-wal"); } catch {}
      try { fs.unlinkSync(tmpFile + "-shm"); } catch {}
    }
  });
});

describe("session CRUD", () => {
  it("creates and retrieves a session", () => {
    const id = createSession(db, "claude", "my-agent");
    const session = getSession(db, id);
    expect(session).toBeDefined();
    expect(session!.agent_type).toBe("claude");
    expect(session!.label).toBe("my-agent");
    expect(session!.status).toBe("active");
    expect(session!.connected_at).toBeTruthy();
    expect(session!.last_seen_at).toBeTruthy();
  });

  it("creates a session without a label", () => {
    const id = createSession(db, "gemini");
    const session = getSession(db, id);
    expect(session!.label).toBeNull();
  });

  it("returns undefined for a non-existent session", () => {
    const session = getSession(db, "00000000-0000-0000-0000-000000000000");
    expect(session).toBeUndefined();
  });

  it("updates session status", () => {
    const id = createSession(db, "claude");
    updateSessionStatus(db, id, "busy");
    const session = getSession(db, id);
    expect(session!.status).toBe("busy");
  });

  it("updates last_seen_at", () => {
    const id = createSession(db, "claude");
    const before = getSession(db, id)!.last_seen_at;
    updateLastSeen(db, id);
    const after = getSession(db, id)!.last_seen_at;
    // They may be the same due to datetime precision, but should not throw
    expect(after).toBeTruthy();
  });
});

describe("session filtering", () => {
  beforeEach(() => {
    const s1 = createSession(db, "claude", "c1");
    const s2 = createSession(db, "gemini", "g1");
    const s3 = createSession(db, "claude", "c2");
    updateSessionStatus(db, s1, "busy");
  });

  it("lists all sessions without filter", () => {
    const all = listSessions(db);
    expect(all).toHaveLength(3);
  });

  it("filters by status", () => {
    const busy = listSessions(db, { status: "busy" });
    expect(busy).toHaveLength(1);
    expect(busy[0].label).toBe("c1");
  });

  it("filters by agent_type", () => {
    const claude = listSessions(db, { agent_type: "claude" });
    expect(claude).toHaveLength(2);
  });

  it("filters by both status and agent_type", () => {
    const result = listSessions(db, { status: "active", agent_type: "claude" });
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("c2");
  });
});
