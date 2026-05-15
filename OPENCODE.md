<!-- fwens:start -->
# fwens Coordination

This project uses fwens for multi-agent coordination. fwens is active whenever the `fwens` MCP tools are available.

## Mandatory Startup Check

At the start of every new agent session, do this without waiting for the human to say "find fwens":

1. Call `cleanup_completed_tasks` to remove terminal completed tasks from previous sessions. This must preserve open, in-progress, and review-requested work.
2. Call `whoami` to confirm the fwens session and note your session ID.
3. Call `set_label` with a short label based on your CLI and role, such as `codex-worker`, `claude-worker`, `gemini-worker`, or `opencode-worker`.
4. Call `list_tasks` with `assigned_to` set to your session ID and `status: "open"`.
5. Call `list_reviews` with `pending: true`.
6. If assigned open tasks exist, you MUST immediately call `claim_task` for one task and begin work. Do not ask the human whether to claim or begin. Pick the highest-priority task from the task description or general-channel messages; if priority is unclear, pick the oldest assigned open task. Execute it end to end, then call `complete_task` with a concise summary and artifact paths. Only call `request_review` if the task description or the human explicitly asks for a review.
7. If there are pending reviews, call `get_context`, inspect the actual files or artifacts, then call `submit_review` with `pass`, `fail`, or `needs_changes` and specific findings. After submitting, post the review findings to the general channel with `post_message(channel: "general")` so all agents and the human can reference them from one place.
8. If there is no assigned task and no pending review, call `list_tasks` with `status: "open"`. You may only claim tasks that are either assigned directly to you or have no assignment (`assigned_to` is null). Never claim a task assigned to another agent.

Do not stop after reporting that fwens exists. Do not ask for permission to start assigned work. The expected behavior is to find actionable work, claim it, execute it, and update fwens.

## Orchestrating Work

When the human asks you to make fwens, coordinate work, split work across agents, or create tasks:

1. Call `whoami` and `set_label`.
2. Call `list_sessions` to see available agents.
3. Before creating new tasks, check for unfinished work from previous sessions by calling `list_tasks` for `status: "open"`, `status: "in_progress"`, and `status: "review_requested"`.
4. If unfinished tasks exist, print a concise list with task ID, status, assignee, and short name. Ask the human whether to reassign, keep, or cancel them. Do not reassign or overwrite unfinished tasks without explicit human confirmation.
5. Create concrete tasks with `create_task`. Prefer assigning tasks to a current live session ID when a target agent is already connected; otherwise leave tasks unassigned.
6. Include enough context in each task for the worker to execute without more prompting.
7. Post a summary to `post_message` on the `general` channel.

## Tool Groups

- Sessions: `whoami`, `list_sessions`, `set_label`, `update_status`
- Tasks: `create_task`, `list_tasks`, `claim_task`, `complete_task`, `cleanup_completed_tasks`
- Reviews: `request_review`, `list_reviews`, `submit_review`, `respond_to_review`
- Messages: `post_message`, `read_messages`
- Context: `get_context`, `get_project_config`

The shared fwens database for this project is at `.fwens/fwens.db`.
<!-- fwens:end -->
