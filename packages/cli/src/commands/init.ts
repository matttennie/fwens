import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  description  TEXT NOT NULL,
  context      TEXT,
  assigned_to  TEXT REFERENCES sessions(id),
  short_name   TEXT,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function writeMcpConfigs(mcpDir: string, projectDir: string): void {
  const serverPath = path.resolve(__dirname, "../../../server/dist/index.js");

  const makeJsonConfig = (agentType: string) =>
    JSON.stringify(
      {
        mcpServers: {
          fwens: {
            command: "node",
            args: [serverPath],
            env: {
              FWENS_PROJECT: projectDir,
              FWENS_AGENT_TYPE: agentType,
            },
          },
        },
      },
      null,
      2
    );

  fs.writeFileSync(
    path.join(mcpDir, "claude.json"),
    makeJsonConfig("claude") + "\n"
  );
  fs.writeFileSync(
    path.join(mcpDir, "gemini.json"),
    makeJsonConfig("gemini") + "\n"
  );
  fs.writeFileSync(
    path.join(mcpDir, "opencode.json"),
    makeJsonConfig("opencode") + "\n"
  );
  // Codex CLI uses TOML format
  const codexToml = `[mcp_servers.fwens]
command = "node"
args = ["${serverPath}"]

[mcp_servers.fwens.env]
FWENS_PROJECT = "${projectDir}"
FWENS_AGENT_TYPE = "codex"
`;
  fs.writeFileSync(path.join(mcpDir, "codex.toml"), codexToml);
}

export function runInit(projectDir: string): void {
  const fwensDir = path.join(projectDir, ".fwens");
  const mcpDir = path.join(fwensDir, "mcp-configs");

  // 1. Create directories
  fs.mkdirSync(fwensDir, { recursive: true });
  fs.mkdirSync(mcpDir, { recursive: true });

  // 2. Write config.json (skip if exists for idempotency)
  const configPath = path.join(fwensDir, "config.json");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ project_root: projectDir }, null, 2) + "\n"
    );
  }

  // 3. Create and initialize SQLite database
  const dbPath = path.join(fwensDir, "fwens.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  db.close();

  // 4. Generate MCP config snippets
  writeMcpConfigs(mcpDir, projectDir);

  console.log(`Initialized fwens project at ${fwensDir}`);
}
