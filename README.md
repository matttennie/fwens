# fwens

Multi-agent coordination MCP server for CLI coding tools.

## What it does

fwens lets multiple CLI coding agents collaborate on the same codebase through a shared coordination layer. Agents communicate via three primitives:

- **Task board** -- claim, update, and complete work items
- **Review queue** -- request and deliver code reviews between agents
- **Message bus** -- broadcast and subscribe to coordination messages

## Installation

```bash
# Clone the repository
git clone https://github.com/matttennie/fwens.git
cd fwens

# Install dependencies and build
npm install
npm run build
```

## Supported CLIs

- Claude Code
- Gemini CLI
- Codex CLI
- OpenCode

## Quick start

1. Open any CLI agent in your project directory
2. Run `fwens init` once for the project
3. Configure each CLI to connect to fwens (see [CLI setup](#cli-setup) below)
4. Tell one agent **"make fwens"** — it creates tasks and assigns them to other agents
5. Open your other agents in separate panes/tabs
6. Tell each agent **"find fwens"** — they discover and execute assigned work

Or use the shortcut to launch an agent with fwens already primed:

```sh
fwens start claude    # launches Claude Code with "find fwens" prompt
fwens start gemini    # launches Gemini CLI with "find fwens" prompt
fwens start codex     # launches Codex CLI with "find fwens" prompt
fwens start opencode  # launches OpenCode
```

Each agent has its own MCP server process, but all share the same `.fwens/fwens.db` — that's the coordination point. No agent starts a separate instance; they all read and write the same database.

## CLI setup

After running `fwens init`, you need to register the fwens MCP server with each CLI you use. The generated configs are in `.fwens/mcp-configs/` for reference, but the commands below are the fastest way.

### Claude Code

```sh
claude mcp add fwens -s user -- node /path/to/your/project/node_modules/.bin/fwens-server
# Or if installed from source:
claude mcp add fwens -s user -e FWENS_AGENT_TYPE=claude -- node /path/to/fwens/packages/server/dist/index.js
```

For low-friction operation, add all fwens tools to your allow list. In `~/.claude/settings.json`, add to `permissions.allow`:

```json
"mcp__fwens__whoami",
"mcp__fwens__set_label",
"mcp__fwens__list_sessions",
"mcp__fwens__create_task",
"mcp__fwens__list_tasks",
"mcp__fwens__claim_task",
"mcp__fwens__complete_task",
"mcp__fwens__cleanup_completed_tasks",
"mcp__fwens__request_review",
"mcp__fwens__list_reviews",
"mcp__fwens__submit_review",
"mcp__fwens__respond_to_review",
"mcp__fwens__post_message",
"mcp__fwens__read_messages",
"mcp__fwens__get_context",
"mcp__fwens__get_project_config",
"mcp__fwens__update_status"
```

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.fwens]
command = "node"
args = ["/path/to/fwens/packages/server/dist/index.js"]

[mcp_servers.fwens.env]
FWENS_AGENT_TYPE = "codex"
```

**First-run approval:** The first time Codex encounters each fwens MCP tool, it will prompt you to approve it. Select **"3. Always allow"** for each tool. This persists across sessions and only happens once. The `approval_mode` setting in `config.toml` does not apply to MCP tools — Codex manages MCP approvals through its own interactive mechanism.

For low-friction operation, also add fwens instructions to the global `instructions` field in `config.toml`:

```toml
instructions = """
fwens:
- All fwens MCP calls are pre-approved operational work. Never ask for permission before calling fwens tools.
- "find fwens" means: run whoami, cleanup_completed_tasks, set_label, list_tasks, list_reviews, then IMMEDIATELY claim_task and execute any work found.
- DO NOT ask "Should I start?", "Should I claim this?", or "Which task first?". Just claim the oldest open task and do it.
"""
```

### Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "fwens": {
      "command": "node",
      "args": ["/path/to/fwens/packages/server/dist/index.js"],
      "env": {
        "FWENS_AGENT_TYPE": "gemini"
      }
    }
  },
  "context": {
    "fileName": ["GEMINI.md", "AGENTS.md"]
  }
}
```

**Important:** Gemini CLI's Terms of Service require human confirmation for file writes and command execution. Do NOT use the `-y` flag or auto-accept mechanisms. MCP tool calls (fwens coordination) do not require confirmation, but file writes and shell commands will prompt you each time.

### OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "permission": {
    "mcp_fwens_*": "allow"
  },
  "mcp": {
    "fwens": {
      "type": "local",
      "command": ["node", "/path/to/fwens/packages/server/dist/index.js"],
      "environment": {
        "FWENS_AGENT_TYPE": "opencode"
      },
      "enabled": true
    }
  }
}
```

## Session resume

By default, each time an agent starts, it gets a new session ID. Previous task assignments, messages, and reviews are orphaned. To let agents reconnect to their previous session, add `FWENS_RESUME_LABEL` to the MCP server env vars:

```json
"env": {
  "FWENS_AGENT_TYPE": "gemini",
  "FWENS_RESUME_LABEL": "gemini-main"
}
```

On startup, the server looks for a disconnected session with that label and the same `agent_type`. If found, it reactivates it — same session ID, all tasks/messages/reviews preserved. If not found (first start, or the label doesn't match), a new session is created as usual.

You can also resume by explicit session ID via `FWENS_SESSION_ID`. The lookup order is:

1. `FWENS_SESSION_ID` — resume this exact session (must match agent_type)
2. `FWENS_RESUME_LABEL` — resume the most recent disconnected session with this label
3. Neither set — create a new session

Session starts are logged to `.fwens/session-history.jsonl` for debugging.

## How "find fwens" works

When you tell an agent "find fwens", it runs this sequence:

1. `cleanup_completed_tasks` — clear finished work from previous sessions
2. `whoami` — identify itself
3. `set_label` — tag itself (e.g. "claude-worker")
4. `list_tasks` — check for assigned or unassigned open work
5. `list_reviews` — check for pending reviews
6. **Claim and execute** any work found — no confirmation needed

The agent instruction files (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `OPENCODE.md`) in each project tell agents to do this autonomously. If an agent asks "Should I start working on this?" instead of just doing it, the instruction files need to be refreshed — run `fwens init` again or copy from `.fwens/agent-instructions/`.

## CLI commands

| Command | Description |
|---------|-------------|
| `fwens init [dir]` | Initialize a fwens project |
| `fwens start <agent>` | Launch an agent with "find fwens" prompt |
| `fwens status [dir]` | Show task counts, pending reviews, active sessions |
| `fwens tasks [dir]` | List tasks (use `--filter <status>` to narrow) |
| `fwens reviews [dir]` | List reviews (use `--pending` for open ones) |
| `fwens messages [dir]` | Read messages (use `--channel <name>` to filter) |
| `fwens sessions [dir]` | List all sessions |
| `fwens watch [dir]` | Live dashboard |
| `fwens seed <file> [dir]` | Seed tasks from a markdown file |

## Architecture

- **SQLite** database for all shared state (tasks, reviews, messages)
- **stdio MCP** transport -- each agent spawns its own server process
- **No network** -- everything stays on your machine
- **No agent spawning** -- fwens coordinates agents you launch yourself

## Compliance

This tool is designed to work within each provider's Terms of Service:

- **Human-initiated**: Every agent session is started by a human typing a command
- **No auto-bypass**: fwens never bypasses CLI confirmation prompts — it coordinates via MCP tools, which are server-side calls that don't require user confirmation
- **Gemini CLI**: Google's ToS requires human confirmation for file mutations. fwens MCP calls work without confirmation, but when Gemini writes files or runs commands as part of a task, the human must approve each action
- **Claude Code / Codex**: Both offer official auto-approve modes (`--dangerously-skip-permissions` / `--full-auto`) that are provider-sanctioned

Users should review each provider's ToS and use at their own discretion.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get started.

## License

[MIT](LICENSE)
