import type Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  agent_type   TEXT NOT NULL,
  label        TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK(status IN ('active','idle','busy','stuck','disconnected')),
  tokens_used  INTEGER NOT NULL DEFAULT 0,
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  short_name   TEXT,
  description  TEXT NOT NULL,
  context      TEXT,
  assigned_to  TEXT REFERENCES sessions(id),
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK(status IN ('open','in_progress','done','review_requested','reviewed','cancelled')),
  created_by   TEXT REFERENCES sessions(id),
  artifacts    TEXT,
  summary      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  reviewer     TEXT REFERENCES sessions(id),
  verdict      TEXT CHECK(verdict IN ('pass','fail','needs_changes')),
  findings     TEXT,
  response     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  channel      TEXT NOT NULL DEFAULT 'general',
  author       TEXT REFERENCES sessions(id),
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_reviews_task ON reviews(task_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON messages(channel, created_at);
`;

export function initializeDb(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);
}

function migrate(db: Database.Database): void {
  // Add columns that may not exist in older databases
  const migrations = [
    "ALTER TABLE sessions ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE tasks ADD COLUMN short_name TEXT",
  ];

  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists — safe to ignore
    }
  }
}
