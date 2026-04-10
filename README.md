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

1. Open any CLI agent in your project directory
2. Tell it **"make fwens"** to set up a fwens session
3. Open your other agents in separate panes/tabs
4. Tell each one **"find fwens"** to join the fwens session
5. Use any connected agent to create tasks and assign them to any other agent
6. **"find fwens"** instructs the agent to check for and execute assigned work or requests

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
