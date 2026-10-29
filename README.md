# fwens

[![CI](https://github.com/matttennie/fwens/actions/workflows/ci.yml/badge.svg)](https://github.com/matttennie/fwens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 22.14+](https://img.shields.io/badge/Node-22.14%2B-339933.svg)](.nvmrc)

Multi-agent coordination MCP server for CLI coding tools.

## What it does

fwens lets multiple CLI coding agents collaborate on the same codebase through a shared coordination layer. Agents communicate via three primitives:

- **Task board**: claim, update, and complete work items
- **Review queue**: request and deliver code reviews between agents
- **Message bus**: broadcast and subscribe to coordination messages

## Supported CLIs

- Claude Code
- Codex CLI
- OpenCode
- Antigravity CLI (`agy`)

## Install

Requires Node.js 22.14 or later.

```bash
git clone https://github.com/matttennie/fwens.git
cd fwens
npm install && npm run build
```

fwens is an MCP server. Register `node /path/to/fwens/packages/server/dist/index.js` in each CLI's MCP config. Concrete examples:

**Claude Code** (run from your project, or omit `--scope project` to register globally):

```bash
claude mcp add fwens \
  --scope project \
  -- node /absolute/path/to/fwens/packages/server/dist/index.js
```

**Codex CLI** (`~/.codex/config.toml`):

```toml
[mcp_servers.fwens]
command = "node"
args = ["/absolute/path/to/fwens/packages/server/dist/index.js"]
```

**OpenCode** (project `opencode.json` or `~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "fwens": {
      "type": "local",
      "command": ["node", "/absolute/path/to/fwens/packages/server/dist/index.js"]
    }
  }
}
```

**Antigravity CLI** (writes `~/.gemini/config/mcp_config.json`):

```bash
agy mcp add fwens node /absolute/path/to/fwens/packages/server/dist/index.js
```

Optionally pre-approve every fwens tool so coordination calls don't prompt each time. These are server-wide rules, so tools added later are covered too:

- **Claude Code**: `"mcp__fwens"` in `permissions.allow` (`~/.claude/settings.json`)
- **Codex CLI**: `default_tools_approval_mode = "approve"` under `[mcp_servers.fwens]`
- **Antigravity CLI**: `"mcp(fwens/*)"` in `permissions.allow` (`~/.gemini/antigravity-cli/settings.json`)
- **OpenCode**: `"fwens_*": "allow"` in `permission` (OpenCode names MCP tools `fwens_<tool>`)

Agents are distinguished by their `label`, which they call `set_label` to apply at startup (e.g. `claude-worker`, `agy-worker`).

## Use

Each agent registers with fwens automatically when its CLI session starts. The MCP server self-registers on boot, so any agent you run appears in `list_sessions` and is assignable.

For the verbal workflow (**"make fwens"** / **"find fwens"**), each CLI also reads an instruction file at your project root: Claude Code reads `CLAUDE.md`; Codex, Antigravity, and OpenCode read `AGENTS.md`. Append the contents of `templates/fwens-instructions.md` to whichever ones you use. Without that block, the agent won't know what those phrases mean; you'd have to orchestrate by invoking fwens MCP tools directly. For persistent setup, put the same block in your CLI's user-level instruction file instead.

1. Start each CLI agent yourself, in its own pane.
2. Tell one agent **"make fwens"** with what work needs doing. Example:

   > make fwens. Assign an adversarial code review to all available agents in this fwens session and report their findings here.

3. Tell each other agent **"find fwens"**. They check the shared database, claim their tasks, and execute.

Each agent has its own MCP server process; all share the same `.fwens/fwens.db` per project.

### Live test

`scripts/live-test.sh` checks real clients end to end: Claude Code, Codex, and Antigravity each open in their own tmux window and relay a run id through one fwens board in `/tmp/fwens-playground`. It prints `PASS` once the id reaches Antigravity's message. Needs `tmux`, `sqlite3`, `claude`, `codex`, and `agy`. Watch with `tmux attach -t fwens-livetest`, and answer any folder-trust or tool prompts in the windows yourself.

## Architecture

- **SQLite** database for all shared state (tasks, reviews, messages)
- **stdio MCP** transport: each agent spawns its own server process
- **No network**: everything stays on your machine
- **No agent spawning**: fwens coordinates agents you launch yourself

## Compliance

This tool was designed to comply with each provider's Terms of Service. However, users should review ToS themselves and use at their own discretion.

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
