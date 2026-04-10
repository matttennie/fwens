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

const MANAGED_BLOCK_START = "<!-- fwens:start -->";
const MANAGED_BLOCK_END = "<!-- fwens:end -->";

const AGENT_INSTRUCTION_FILENAMES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "OPENCODE.md",
] as const;

function buildManagedInstructionBlock(projectDir: string): string {
  return `${MANAGED_BLOCK_START}
# fwens Coordination

This project uses fwens for multi-agent coordination. fwens is active whenever the \`fwens\` MCP tools are available.

## Mandatory Startup Check

At the start of every new agent session, do this without waiting for the human to say "find fwens":

1. Call \`cleanup_completed_tasks\` to remove terminal completed tasks from previous sessions. This must preserve open, in-progress, and review-requested work.
2. Call \`whoami\` to confirm the fwens session and note your session ID.
3. Call \`set_label\` with a short label based on your CLI and role, such as \`codex-worker\`, \`claude-worker\`, \`gemini-worker\`, or \`opencode-worker\`.
4. Call \`list_tasks\` with \`assigned_to\` set to your session ID and \`status: "open"\`.
5. Call \`list_reviews\` with \`pending: true\`.
6. If assigned open tasks exist, you MUST immediately call \`claim_task\` for one task and begin work. Do not ask the human whether to claim or begin. Pick the highest-priority task from the task description or general-channel messages; if priority is unclear, pick the oldest assigned open task. Execute it end to end, then call \`complete_task\` with a concise summary and artifact paths. Request review with \`request_review\` unless the task explicitly says not to.
7. If there are pending reviews, call \`get_context\`, inspect the actual files or artifacts, then call \`submit_review\` with \`pass\`, \`fail\`, or \`needs_changes\` and specific findings.
8. If there is no assigned task and no pending review, call \`list_tasks\` with \`status: "open"\`. Claim suitable unassigned work only when it is clearly safe for your session to take it.

Do not stop after reporting that fwens exists. Do not ask for permission to start assigned work. The expected behavior is to find actionable work, claim it, execute it, and update fwens.

## Orchestrating Work

When the human asks you to make fwens, coordinate work, split work across agents, or create tasks:

1. Call \`whoami\` and \`set_label\`.
2. Call \`list_sessions\` to see available agents.
3. Before creating new tasks, check for unfinished work from previous sessions by calling \`list_tasks\` for \`status: "open"\`, \`status: "in_progress"\`, and \`status: "review_requested"\`.
4. If unfinished tasks exist, print a concise list with task ID, status, assignee, and short name. Ask the human whether to reassign, keep, or cancel them. Do not reassign or overwrite unfinished tasks without explicit human confirmation.
5. Create concrete tasks with \`create_task\`. Prefer assigning tasks to a current live session ID when a target agent is already connected; otherwise leave tasks unassigned.
6. Include enough context in each task for the worker to execute without more prompting.
7. Post a summary to \`post_message\` on the \`general\` channel.

## Tool Groups

- Sessions: \`whoami\`, \`list_sessions\`, \`set_label\`, \`update_status\`
- Tasks: \`create_task\`, \`list_tasks\`, \`claim_task\`, \`complete_task\`, \`cleanup_completed_tasks\`
- Reviews: \`request_review\`, \`list_reviews\`, \`submit_review\`, \`respond_to_review\`
- Messages: \`post_message\`, \`read_messages\`
- Context: \`get_context\`, \`get_project_config\`

The shared fwens database for this project is at \`${path.join(
    projectDir,
    ".fwens",
    "fwens.db"
  )}\`.
${MANAGED_BLOCK_END}`;
}

function upsertManagedBlock(existing: string, managedBlock: string): string {
  const startIndex = existing.indexOf(MANAGED_BLOCK_START);
  const endIndex = existing.indexOf(MANAGED_BLOCK_END);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = existing.slice(0, startIndex).trimEnd();
    const after = existing
      .slice(endIndex + MANAGED_BLOCK_END.length)
      .trimStart();
    return [before, managedBlock, after].filter(Boolean).join("\n\n") + "\n";
  }

  const trimmed = existing.trimEnd();
  return trimmed ? `${trimmed}\n\n${managedBlock}\n` : `${managedBlock}\n`;
}

function writeAgentInstructions(projectDir: string, fwensDir: string): void {
  const managedBlock = buildManagedInstructionBlock(projectDir);
  const instructionsDir = path.join(fwensDir, "agent-instructions");
  fs.mkdirSync(instructionsDir, { recursive: true });

  for (const filename of AGENT_INSTRUCTION_FILENAMES) {
    const projectInstructionPath = path.join(projectDir, filename);
    const existing = fs.existsSync(projectInstructionPath)
      ? fs.readFileSync(projectInstructionPath, "utf-8")
      : "";

    fs.writeFileSync(
      projectInstructionPath,
      upsertManagedBlock(existing, managedBlock)
    );
    fs.writeFileSync(
      path.join(instructionsDir, filename),
      `${managedBlock}\n`
    );
  }
}

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

  // 5. Install project instruction files so agents check fwens on startup
  writeAgentInstructions(projectDir, fwensDir);

  console.log(`Initialized fwens project at ${fwensDir}`);
}
