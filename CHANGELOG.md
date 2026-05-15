# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Session resume**: Agents can reconnect to their previous session via `FWENS_RESUME_LABEL` or `FWENS_SESSION_ID` env vars. Preserves task assignments, messages, and reviews across restarts.
- **`fwens start <agent>`**: Launch an agent CLI (claude, gemini, codex, opencode) with the "find fwens" prompt pre-loaded.
- **Session history log**: Every session start/resume is logged to `.fwens/session-history.jsonl`.

### Fixed

- **OpenCode MCP config**: Template now uses the correct schema (`mcp` key, `command` as array, `environment` key) instead of the Claude/Gemini `mcpServers` format.
- **TOML injection**: Codex config generation now escapes special characters in paths.
- **Cross-agent session hijack**: Explicit session ID resume now enforces `agent_type` match.
- **UUID validation**: `FWENS_SESSION_ID` is validated at startup, consistent with handler-level validation.

### Security

- Bumped `vite` to 7.3.2 (fixes path traversal, fs.deny bypass, WebSocket file read).
- Bumped `hono` to 4.12.14 (fixes cookie, IP restriction, path traversal in SSG).
- Bumped `@hono/node-server` to 1.19.14 (fixes middleware bypass).

## [0.1.0] - 2026-04-03

### Added

- MCP server with stdio transport for multi-agent coordination.
- Task board: create, claim, update, and complete tasks.
- Review queue: request and deliver code reviews between agents.
- Message bus: broadcast and subscribe to coordination messages.
- SQLite-backed shared state.
- `fwens init` CLI command for project setup.
- Support for Claude Code, Gemini CLI, Codex CLI, and OpenCode.
