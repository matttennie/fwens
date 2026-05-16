# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Session resume**: Agents can reconnect to their previous session via `FWENS_RESUME_LABEL` or `FWENS_SESSION_ID` env vars. Preserves task assignments, messages, and reviews across restarts.
- **Session history log**: Every session start/resume is logged to `.fwens/session-history.jsonl`.
- **Eager session registration**: The MCP server writes its session row at boot rather than on first tool call, so any agent appears in `list_sessions` immediately and is assignable as a task target.
- **PID-based stale session pruning**: Sessions whose owning process has exited or whose `last_seen_at` exceeds `FWENS_PRUNE_MAX_IDLE_MS` (default 24h) are marked `disconnected`. `FWENS_DISABLE_PRUNE=1` opts out for sandboxed environments. Per-event audit records written to `.fwens/prune-events.jsonl`.
- **`prune_sessions` MCP tool**: Explicit, observable prune sweep — `handleListSessions` is now idempotent and no longer mutates state.
- **`update_status` MCP tool**: Set session status (`active`/`idle`/`busy`/`stuck`) and report cumulative token usage.

### Changed

- **State machine hardened**: `claim_task` uses an atomic conditional UPDATE (closes the multi-process race); `complete_task` requires assignee or creator; `submit_review` with `needs_changes` routes the task back to `in_progress` rather than `reviewed`; `request_review` requires the task to be `done` first.
- **Heartbeat debouncing**: `last_seen_at` writes are debounced to 30s by default (`FWENS_HEARTBEAT_DEBOUNCE_MS`). Reduces write amplification under polling-heavy workloads by ~30x.
- **No destructive cleanup at startup**: `cleanup_completed_tasks` is no longer called at server boot. It remains exposed as an MCP tool for explicit, human-initiated cleanup.
- **CLI scope reduced to diagnostics**: Removed `fwens init`, `fwens start`, and `fwens watch`. Surviving commands (`status`, `tasks`, `reviews`, `messages`, `sessions`, `seed`) are read-only inspectors of the local `.fwens/fwens.db`.
- **Deterministic ordering**: `list_tasks` and `list_reviews` now sort by `created_at ASC, id ASC`.
- **Hardened `isProcessAlive`**: Explicit `ESRCH` → dead, `EPERM` → alive, unknown error codes → preserve (treat as alive in sandboxes).
- **Explicit SQLite busy timeout**: 5s.

### Fixed

- **OpenCode MCP config**: Template now uses the correct schema (`mcp` key, `command` as array, `environment` key) instead of the Claude/Gemini `mcpServers` format.
- **TOML injection**: Codex config generation now escapes special characters in paths.
- **Cross-agent session hijack**: Explicit session ID resume now enforces `agent_type` match.
- **UUID validation**: `FWENS_SESSION_ID` is validated at startup, consistent with handler-level validation.
- **Schema migration safety**: ALTER TABLE catch now narrows to "duplicate column name" only; other migration errors propagate instead of being silently swallowed.

### Security

- Bumped `vite` to 7.3.2 (fixes path traversal, fs.deny bypass, WebSocket file read).
- Bumped `hono` to 4.12.18 (fixes cookie, IP restriction, path traversal in SSG, JSX SSR injection, JWT date validation, Cache middleware Vary handling, bodyLimit bypass).
- Bumped `@hono/node-server` to 1.19.14 (fixes middleware bypass).
- Bumped `fast-uri` to 3.1.2 (fixes path traversal via percent-encoded dot segments, host confusion via percent-encoded authority delimiters).
- Bumped `ip-address` to 10.2.0 (fixes XSS in Address6 HTML-emitting methods).
- Bumped `express-rate-limit` to 8.5.2 (transitive ip-address fix).

## [0.1.0] - 2026-04-03

### Added

- MCP server with stdio transport for multi-agent coordination.
- Task board: create, claim, update, and complete tasks.
- Review queue: request and deliver code reviews between agents.
- Message bus: broadcast and subscribe to coordination messages.
- SQLite-backed shared state.
- `fwens init` CLI command for project setup.
- Support for Claude Code, Gemini CLI, Codex CLI, and OpenCode.
