# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-05-17

A consolidation release. Two adversarial review passes shaped the work: an OSS-readiness cleanup (security/correctness/hygiene) and a production-readiness pass (concurrency, durability, recovery visibility). Every dependency was bumped to its current major.

### Added

- **Session resume**: Agents can reconnect to their previous session via `FWENS_RESUME_LABEL` or `FWENS_SESSION_ID` env vars. Preserves task assignments, messages, and reviews across restarts.
- **Session history log**: Every session start/resume is logged to `.fwens/session-history.jsonl`.
- **Eager session registration**: The MCP server writes its session row at boot rather than on first tool call, so any agent appears in `list_sessions` immediately and is assignable as a task target.
- **PID-based stale session pruning**: Sessions whose owning process has exited or whose `last_seen_at` exceeds `FWENS_PRUNE_MAX_IDLE_MS` (default 24h) are marked `disconnected`. `FWENS_DISABLE_PRUNE=1` opts out for sandboxed environments. Per-event audit records written to `.fwens/prune-events.jsonl`.
- **`prune_sessions` MCP tool**: Explicit, observable prune sweep. `handleListSessions` is now idempotent and no longer mutates state.
- **`update_status` MCP tool**: Set session status (`active`/`idle`/`busy`/`stuck`) and report cumulative token usage.
- **Stuck-task visibility**: `list_tasks(assigned_to_disconnected: true)` surfaces work stranded by a crashed agent. The `claim_task` reassign-from-disconnected carve-out already existed; this makes the stranded work findable.
- **Shared status enum exports**: `SESSION_STATUSES`, `SETTABLE_SESSION_STATUSES`, `TASK_STATUSES`, `REVIEW_VERDICTS` exported from `db.ts` as single source of truth.
- **`@fwens/server/db` and `@fwens/server/validation` subpath exports**: CLI and future consumers can use the same helpers as the server.
- **`CODE_OF_CONDUCT.md`** (Contributor Covenant 2.1).
- **`.nvmrc`** and **`engines: { node: ">=22" }`** in all `package.json` files.
- **CI / license / Node badges** in README.
- **`.github/dependabot.yml`**: weekly npm and GitHub Actions updates.
- **`.github/rulesets/main.json`**: record of the live main-branch protection ruleset (no force-push, no deletion, required status checks).
- **Per-CLI MCP registration examples** in README (Claude Code, Gemini CLI, Codex CLI, OpenCode).

### Changed

- **State machine hardened**: `claim_task` uses an atomic conditional UPDATE (closes the multi-process race); `complete_task` requires assignee or creator; `submit_review` with `needs_changes` routes the task back to `in_progress` rather than `reviewed`; `request_review` requires the task to be `done` first.
- **Heartbeat debouncing**: `last_seen_at` writes are debounced to 30s by default (`FWENS_HEARTBEAT_DEBOUNCE_MS`). Reduces write amplification under polling-heavy workloads by ~30x.
- **No destructive cleanup at startup**: `cleanup_completed_tasks` is no longer called at server boot. It remains exposed as an MCP tool for explicit, human-initiated cleanup.
- **CLI scope reduced to diagnostics**: Removed `fwens init`, `fwens start`, and `fwens watch`. Surviving commands (`status`, `tasks`, `reviews`, `messages`, `sessions`, `seed`) are read-only inspectors of the local `.fwens/fwens.db`.
- **Deterministic ordering**: `list_tasks` and `list_reviews` now sort by `created_at ASC, id ASC`.
- **Hardened `isProcessAlive`**: Explicit `ESRCH` → dead, `EPERM` → alive, unknown error codes → preserve (treat as alive in sandboxes).
- **Explicit SQLite busy timeout**: 5s.
- **`resumeSession` is atomic**: conditional UPDATE on `status='disconnected'` returns `Session | undefined`. Two simultaneous server boots racing on the same disconnected row no longer both "succeed"; the loser falls through to a fresh `createSession` instead of crashing on the post-hoc status guard.
- **`updateStatus` is atomic**: a single UPDATE applies both `status` and `tokens_used`. Previously two separate UPDATEs that could leave the row half-updated.
- **`Task.artifacts` is `string[] | null`** (was `string | null`; the column stored JSON-stringified arrays). Read paths deserialize via a centralized helper. **Breaking change** for any consumer that previously parsed the raw string.
- **`respondToReview` requires `sessionId`**: only the assignee or creator can respond. **Breaking change** for direct callers of the function.
- **Default LIMITs**: `list_tasks` (500), `list_reviews` (500), `read_messages` (100), `list_sessions` (500). `MAX_LIST_LIMIT=1000` caps caller overrides.
- **`PRAGMA synchronous=FULL`** set explicitly. Under WAL the default varies by platform; FULL is the only setting safe under power loss on all targets.
- **`seed.ts` refactored** to route through `createSession` + `createTask`. A synthetic "fwens-seed" session is the `created_by` so `complete_task`'s authz check works for seeded tasks.
- **Vitest `dist/` exclude**: explicit exclusion in `vitest.config.ts` for both workspaces; vitest v4 no longer applies it by default.
- **Dependency majors**: `zod` 3 → 4, `typescript` 5.9 → 6.0, `vitest` 3 → 4, `commander` 13 → 14, `@types/node` 22 → 25.
- **GitHub Actions**: `actions/checkout` v5 → v6, `actions/setup-node` v5 → v6.

### Fixed

- **OpenCode MCP config**: Template now uses the correct schema (`mcp` key, `command` as array, `environment` key) instead of the Claude/Gemini `mcpServers` format.
- **TOML injection**: Codex config generation now escapes special characters in paths.
- **Cross-agent session hijack**: Explicit session ID resume now enforces `agent_type` match.
- **UUID validation**: `FWENS_SESSION_ID` is validated at startup, consistent with handler-level validation.
- **Schema migration safety**: ALTER TABLE catch now narrows to "duplicate column name" only; other migration errors propagate instead of being silently swallowed.
- **Symlink escape in `validatePath`**: `fs.realpathSync` now applied to both the project root and the input through a single `canonicalize` helper. A symlink inside the project pointing outside no longer satisfies the confinement check. `SECURITY.md`'s confinement claim is now backed by code.
- **Review-tool authorization**: `requestReview`, `submitReview`, `respondToReview` now enforce authz. Assignee cannot self-review; the orchestrator-as-creator review pattern is preserved.
- **`seed.ts` arbitrary file read**: `validatePath` applied to the `taskFile` argument. A malicious project repo telling a victim `fwens seed /etc/passwd` can no longer exfiltrate arbitrary files into the task DB.
- **`FWENS_PROJECT` env var**: null-byte rejection + absolute-path resolution. Was previously passed through raw.
- **`runtime.ts` startup robustness**: `session-history.jsonl` write wrapped in `try/catch`. A read-only filesystem or full disk no longer crashes the server at boot.
- **`artifacts` array bounded**: `z.array(z.string().max(4096)).max(100)` on `complete_task`. Each artifact triggers fs syscalls in `validatePath`, so an unbounded array was a resource-exhaustion vector.

### Security

- Bumped `vite` to 7.3.2 (fixes path traversal, fs.deny bypass, WebSocket file read).
- Bumped `hono` to 4.12.18 (fixes cookie, IP restriction, path traversal in SSG, JSX SSR injection, JWT date validation, Cache middleware Vary handling, bodyLimit bypass).
- Bumped `@hono/node-server` to 1.19.14 (fixes middleware bypass).
- Bumped `fast-uri` to 3.1.2 (fixes path traversal via percent-encoded dot segments, host confusion via percent-encoded authority delimiters).
- Bumped `ip-address` to 10.2.0 (fixes XSS in Address6 HTML-emitting methods).
- Bumped `express-rate-limit` to 8.5.2 (transitive ip-address fix).

### Documentation

- README: removed em dashes, shortened Contributing to a single linked sentence, added per-CLI MCP install examples.
- CONTRIBUTING.md: filled `<repo-url>` placeholder, linked Code of Conduct.
- SECURITY.md: dropped GitHub-only emoji shortcodes, replaced vague "contact the maintainer" with a concrete GitHub Security Advisories link.
- Removed internal docs: `docs/release-legal-audit-2026-04-16.md`, `docs/fwens-ring-*.md`, `docs/plans/`, `docs/specs/`.
- Removed committed test artifacts in `test-output/` (now gitignored).
- `templates/fwens-instructions.md`: filled `{{FWENS_DB_PATH}}` placeholder; instructs agents to use `assigned_to_disconnected` when looking for orphan work.

## [0.1.0] - 2026-04-03

### Added

- MCP server with stdio transport for multi-agent coordination.
- Task board: create, claim, update, and complete tasks.
- Review queue: request and deliver code reviews between agents.
- Message bus: broadcast and subscribe to coordination messages.
- SQLite-backed shared state.
- `fwens init` CLI command for project setup.
- Support for Claude Code, Gemini CLI, Codex CLI, and OpenCode.
