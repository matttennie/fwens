# fwens

Multi-agent coordination MCP server for CLI coding tools.

## What it does

fwens lets multiple CLI coding agents collaborate on the same codebase through a shared coordination layer. Agents communicate via three primitives:

- **Task board** -- claim, update, and complete work items
- **Review queue** -- request and deliver code reviews between agents
- **Message bus** -- broadcast and subscribe to coordination messages

## Supported CLIs

- Claude Code
- Gemini CLI
- Codex CLI
- OpenCode

## Quick start

```bash
# Tell any agent to set up the shared database:
#   "make fwens"
# This runs fwens init and creates .fwens/fwens.db

# Launch agents in tmux (or however you like)
# Each connects to the same .fwens/fwens.db via its MCP config

# Tell the orchestrating agent to create and assign tasks
# Then tell each agent:
#   "find fwens"
# They'll check the shared database, pick up assigned work, and execute
```

Each agent has its own MCP server process, but all share the same `.fwens/fwens.db` — that's the coordination point. No agent starts a separate instance; they all read and write the same database.

## Architecture

- **SQLite** database for all shared state (tasks, reviews, messages)
- **stdio MCP** transport -- each agent spawns its own server process
- **No network** -- everything stays on your machine
- **No agent spawning** -- fwens coordinates agents you launch yourself

## Compliance

This tool was designed to comply with each provider's Terms of Service. However, users should review ToS themselves and use at their own discretion.

## License

[MIT](LICENSE)
