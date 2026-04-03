# fwens — Multi-Agent Coordination MCP Server

**Date**: 2026-04-03
**Status**: Draft
**Author**: Matt Tennie + Claude Code

---

## 1. Overview

fwens is a local MCP server that enables five CLI coding agents to collaborate on shared projects through task delegation and mutual adversarial review. It provides a shared coordination layer (task board, review queue, message bus) without ever spawning, wrapping, or piping output between agents.

### Supported CLIs

| CLI | Provider | MCP Config Location |
|-----|----------|-------------------|
| Claude Code | Anthropic | `.mcp.json` or `~/.claude/settings.json` |
| Gemini CLI | Google | `~/.gemini/settings.json` or `.gemini/settings.json` |
| Codex CLI | OpenAI | `~/.codex/config.toml` or `.codex/config.toml` |
| OpenCode | Various | `opencode.json` |
| Aider | Various | `.aider.conf.yml` or CLI flags |

### What fwens is NOT

- Not an agent orchestrator — it never invokes any CLI
- Not a model proxy — no API keys, no model calls
- Not a harness — no OAuth, no subscription wrapping
- Not a product — personal coordination tooling

---

## 2. Architecture

```
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Claude Code  │ │ Gemini CLI   │ │  Codex CLI   │ │  OpenCode    │ │   Aider      │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │ stdio          │ stdio          │ stdio          │ stdio          │ stdio
       └────────────────┴────────────────┼────────────────┴────────────────┘
                                         │
                                ┌────────▼────────┐
                                │  fwens MCP       │
                                │  server          │
                                └────────┬─────────┘
                                         │
                                ┌────────▼────────┐
                                │  SQLite          │
                                │  .fwens/fwens.db │
                                └─────────────────┘
```

- **Transport**: stdio only (local, no network)
- **State**: SQLite database in `<project>/.fwens/fwens.db`
- **Concurrency**: WAL mode for safe concurrent reads from multiple agent sessions
- **No roles**: Every agent gets every tool. Behavior is determined by the human's instructions, not the server.

---

## 3. ToS Compliance Design

### Compliance boundary

The server passes **coordination metadata** between agents — task descriptions, file paths, status flags, review verdicts, and structured findings. It does not:

- Forward raw model output as prompts to another model
- Spawn or invoke any CLI or API
- Handle any API keys or credentials
- Train, fine-tune, or develop any model
- Substitute for or compete with any provider's product

### Known gray area

Review findings and messages may contain model-generated prose that is consumed by another provider's model at inference time. This is the same data flow as a human reading one terminal and typing in another. Mitigations:

- The server is local-only, personal use, not a product or service
- Each agent session is launched independently by the human
- The human can inspect all coordination state at any time
- The architecture matches patterns officially supported by providers (OpenAI documents `codex mcp-server` for cross-client consumption)

### What would change compliance posture (avoid these)

- Hosting fwens as a remote service
- Automating agent session launches (agent A spawns agent B)
- Distributing fwens as a commercial product
- Using fwens output to train or fine-tune models

---

## 4. Data Model

```sql
-- All tables in .fwens/fwens.db

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  description  TEXT NOT NULL,
  context      TEXT,
  assigned_to  TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK(status IN ('open','in_progress','done','review_requested','reviewed')),
  created_by   TEXT,
  artifacts    TEXT,  -- JSON array of validated file paths
  summary      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE reviews (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  reviewer     TEXT,
  verdict      TEXT CHECK(verdict IN ('pass','fail','needs_changes')),
  findings     TEXT,
  response     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  channel      TEXT NOT NULL DEFAULT 'general',
  author       TEXT,
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_reviews_task ON reviews(task_id);
CREATE INDEX idx_messages_channel_time ON messages(channel, created_at);
```

---

## 5. MCP Tool Surface

All tools available to every connected agent.

### Task Management

| Tool | Inputs | Returns |
|------|--------|---------|
| `create_task` | `description` (required), `context?`, `assigned_to?` | `{ task_id }` |
| `list_tasks` | `filter?` (status, assigned_to) | `task[]` |
| `claim_task` | `task_id` | updated task |
| `complete_task` | `task_id`, `summary`, `artifacts?` (file paths) | updated task |

### Review

| Tool | Inputs | Returns |
|------|--------|---------|
| `request_review` | `task_id`, `rubric?` | `{ review_id }` |
| `list_reviews` | `filter?` (status, task_id) | `review[]` |
| `submit_review` | `task_id`, `verdict`, `findings` | review |
| `respond_to_review` | `review_id`, `response` | updated review |

### Communication

| Tool | Inputs | Returns |
|------|--------|---------|
| `post_message` | `channel`, `content` | `{ message_id }` |
| `read_messages` | `channel?`, `since?`, `limit?` | `message[]` |

### Context

| Tool | Inputs | Returns |
|------|--------|---------|
| `get_context` | `task_id` | task + all reviews + related messages |
| `get_project_config` | (none) | project fwens config |

---

## 6. Input Validation & Security

All enforced at the server level, before any database operation.

| Rule | Implementation |
|------|---------------|
| SQL injection prevention | Parameterized queries only, no string interpolation |
| Path traversal prevention | All artifact paths resolved with `realpath`, must be within project root |
| ID validation | UUIDs validated against format before query |
| Enum enforcement | `status`, `verdict`, `channel` checked against allowlists |
| Length limits | All string fields capped (description: 10K, findings: 50K, message: 10K) |
| No credentials | Server never accepts or stores API keys, tokens, or secrets |

---

## 7. CLI Companion

`fwens` CLI for human use outside agent sessions. Optional — all functionality available via MCP tools inside agent sessions.

```
fwens init                      # Create .fwens/ in current project, generate per-CLI configs
fwens status                    # Task board summary
fwens tasks [--filter=open]     # List tasks
fwens reviews [--pending]       # Pending reviews
fwens messages [--channel=x]    # Read messages
fwens launch <agent>            # Convenience launcher (cd + start CLI)
fwens config                    # View/edit project config
```

`fwens init` generates:
- `.fwens/fwens.db` (SQLite database)
- `.fwens/config.json` (project config)
- MCP server config snippets for each of the five CLIs
- Agent instruction file templates (CLAUDE.md additions, GEMINI.md, AGENTS.md, etc.)

---

## 8. Per-CLI Agent Instructions

Each CLI gets a project instruction template explaining fwens. Templates are generated by `fwens init` and customized per project. They contain:

- What fwens tools are available and what they do
- How to check for assigned tasks on session start
- How to request and submit reviews
- Project-specific conventions

No template assigns roles or constrains which tools an agent can use.

---

## 9. Project Structure

```
~/Desktop/AI/fwens/
├── packages/
│   ├── server/                  # MCP server (TypeScript)
│   │   ├── src/
│   │   │   ├── index.ts         # Entry point, stdio transport setup
│   │   │   ├── tools/
│   │   │   │   ├── tasks.ts     # Task management tools
│   │   │   │   ├── reviews.ts   # Review tools
│   │   │   │   ├── messages.ts  # Communication tools
│   │   │   │   └── context.ts   # Context aggregation tools
│   │   │   ├── db.ts            # SQLite operations (parameterized only)
│   │   │   ├── validation.ts    # Input validation, path sanitization
│   │   │   └── schema.ts        # Database schema & migrations
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/                     # fwens CLI companion (TypeScript)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── commands/        # One file per command
│   │   └── package.json
│   │
│   └── python-server/           # Alternative Python implementation (FastMCP)
│       ├── fwens_server/
│       │   ├── __init__.py
│       │   ├── server.py
│       │   ├── tools.py
│       │   ├── db.py
│       │   └── validation.py
│       └── pyproject.toml
│
├── templates/                   # Per-CLI instruction templates
│   ├── claude.md
│   ├── gemini.md
│   ├── codex.md
│   ├── opencode.md
│   └── aider.md
│
├── package.json                 # Workspace root (npm workspaces)
├── tsconfig.base.json
└── README.md
```

---

## 10. Build & Install

```bash
# Clone and build
cd ~/Desktop/AI/fwens
npm install
npm run build

# Initialize in a project
cd /path/to/my-project
fwens init

# Each CLI connects to the same server
# Config snippets generated by fwens init
```

The server is a local npm package, not published. Installed globally or referenced by absolute path in MCP configs.

---

## 11. Implementation Priorities

1. **SQLite schema + db layer** — foundation, parameterized queries, WAL mode
2. **MCP server with task tools** — create, list, claim, complete
3. **Review tools** — request, submit, respond
4. **Message tools** — post, read
5. **Context aggregation** — get_context combining tasks + reviews + messages
6. **CLI companion** — init, status, tasks, reviews, messages
7. **Agent instruction templates** — one per CLI
8. **Python server** — parallel FastMCP implementation
9. **Security hardening pass** — path traversal tests, injection tests, fuzzing
