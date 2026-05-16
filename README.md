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

## Install

```bash
git clone https://github.com/matttennie/fwens.git
cd fwens
npm install && npm run build
```

fwens is an MCP server. Register `node /path/to/fwens/packages/server/dist/index.js` in your CLI's MCP config the way you normally register MCP servers. Set `FWENS_AGENT_TYPE=<claude|gemini|codex|opencode>` per registration.

## Use

Each CLI reads an instruction file at your project root (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `OPENCODE.md`). Append the contents of `templates/fwens-instructions.md` to whichever ones you use. That's what teaches each agent to run the fwens startup check on every session — without it, "make fwens" and "find fwens" do nothing.

For persistent setup, put the same block in your CLI's user-level instruction file instead.

1. Start each CLI agent yourself, in its own pane.
2. Tell one agent **"make fwens"** with what work needs doing and to whom. Example:

   > make fwens. Gemini: refactor `auth.ts` to use the new session API. Codex: add tests. Claude: review when both are done.

3. Tell each other agent **"find fwens"** — they check the shared database, claim their tasks, and execute.

Each agent has its own MCP server process; all share the same `.fwens/fwens.db` per project.

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
