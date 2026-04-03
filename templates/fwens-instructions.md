# fwens Coordination

This project uses fwens for multi-agent coordination. You have MCP tools available for task management, code review, and messaging.

## On Session Start

1. Call `whoami` to confirm your session is registered
2. Call `list_tasks` with `mine: true` or filter by your session to check for assigned work
3. Call `list_reviews` with `pending: true` to check for reviews awaiting your input

## Available Tools

- **Tasks**: `create_task`, `list_tasks`, `claim_task`, `complete_task`
- **Reviews**: `request_review`, `list_reviews`, `submit_review`, `respond_to_review`
- **Messages**: `post_message`, `read_messages`
- **Context**: `get_context` (full task + reviews + messages), `get_project_config`
- **Sessions**: `whoami`, `list_sessions`, `set_label`

## Workflow

When delegating: call `list_sessions` to see who's available, then `create_task` with their session ID in `assigned_to`.

When reviewing: call `list_reviews(pending: true)`, use `get_context` for full task details, then `submit_review` with verdict and findings.

When completing work: call `complete_task` with a summary and artifact file paths, then `request_review` if review is needed.
