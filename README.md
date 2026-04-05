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
# Initialize fwens in your project
fwens init

# Copy the generated MCP config into each agent's configuration
# (fwens init prints the path)

# Launch your agents and tell each one:
check fwens
```

Each agent connects to the same local MCP server and can see tasks, reviews, and messages from the others.

## Architecture

- **SQLite** database for all shared state (tasks, reviews, messages)
- **stdio MCP** transport -- each agent spawns its own server process
- **No network** -- everything stays on your machine
- **No agent spawning** -- fwens coordinates agents you launch yourself

## License

[MIT](LICENSE)
