# fwens Coordination

This project uses fwens for multi-agent coordination. fwens is active whenever the `fwens` MCP tools are available.

## Session Startup

At the start of every new agent session, run this immediately — do not wait for the human:

1. `whoami` — note your session ID. (The session row is already in the DB — the MCP server registered it on boot.)
2. `set_label` — use a short label based on your CLI and role, such as `codex-worker`, `claude-worker`, `gemini-worker`, or `opencode-worker`.
3. `list_tasks(assigned_to: <your session ID>, status: "open")` — check for assigned work.
4. `list_reviews(pending: true)` — check for pending reviews.
5. **If tasks are assigned to you** — `claim_task` and execute immediately. Pick the highest-priority task from the task description or general-channel messages; if priority is unclear, pick the oldest assigned open task. See "Executing Work" below.
6. **If reviews are pending** — `get_context`, inspect the artifacts, `submit_review` with verdict and findings. After submitting, post the review findings to the general channel with `post_message(channel: "general")` so all agents and the human can reference them from one place.
7. **If neither** — `list_tasks(status: "open")` to find unassigned tasks. You may only claim tasks that are either assigned directly to you or have no assignment (`assigned_to` is null). Never claim a task assigned to another agent.

**Do NOT call `cleanup_completed_tasks` as part of this startup check.** That tool deletes done/reviewed/cancelled tasks and is destructive to multi-wave coordination workflows that reference prior task IDs. Call it explicitly only when the human asks you to clean up, never automatically.

## "find fwens"

When the human says "find fwens" (or "check fwens", "fwens status", etc.), run the same startup sequence above. This is a trigger to poll for work — treat it as an instruction to find actionable work and do it.

After running the startup check, also look for orphaned work:
- `list_tasks(status: "open")` — any unassigned open tasks are fair game. Claim and execute, but never claim a task assigned to another agent.
- `list_tasks(status: "in_progress")` — check if any in-progress tasks are assigned to disconnected sessions (stale work). If so, report them to the human.

## Executing Work

When you find a task to execute:

1. `claim_task(task_id)` — this marks it in-progress and assigns it to you.
2. Read the task description and context. Execute the work end to end.
3. `complete_task(task_id, summary, artifacts)` — mark it done with a summary and file paths.
4. `request_review(task_id)` — only if the task description or the human explicitly asks for a review.
5. If you need to create follow-on tasks while executing, always include a `short_name` (2-4 words) for dashboard display.
6. Check for more work: `list_tasks(assigned_to: <your session ID>, status: "open")`.

## CRITICAL: No Confirmation Required

Claiming and executing fwens tasks is pre-approved operational work. The human created these tasks specifically for agents to execute autonomously.

**DO NOT** do any of the following:
- Ask "Should I start working on this task?" — just start.
- Ask "Would you like me to claim this?" — just claim it.
- Present a plan and wait for approval before executing.
- Say "I found N tasks" and then stop — find them AND do them.
- Ask "Which task should I work on first?" — pick the oldest open one.
- Report that fwens exists without checking for work.
- Wait for the human to say "go ahead" or "yes" or "proceed".

The correct behavior is: discover work -> claim it -> execute it -> complete it -> report what you did.

## "make fwens"

When the human says "make fwens" (or similar), set up the coordination board:

1. `whoami` and `set_label`.
2. `list_sessions` — see who else is connected.
3. Check for unfinished work: `list_tasks(status: "open")`, `list_tasks(status: "in_progress")`, `list_tasks(status: "review_requested")`.
4. If unfinished tasks exist, print a concise list (task ID, status, assignee, short name). Ask the human whether to reassign, keep, or cancel. Do not overwrite unfinished tasks without human confirmation.
5. Create tasks based on the context the human has already given you. Only ask what work needs to be done if no context was provided.
6. `create_task` for each piece of work, `assigned_to` = target session ID. Always include a `short_name` (2-4 words) for dashboard display.
7. Never assign tasks to different agents that touch the same files. If two tasks both need to edit a file, assign them to the same agent.
8. `post_message(channel: "general")` summarizing assignments.

If no other agents are connected yet, create the tasks unassigned. They can be claimed later.

## Session Resume

If `FWENS_RESUME_LABEL` is set in the MCP server config, your session will automatically reconnect to the most recent disconnected session with that label (and matching agent_type). This means your session ID, task assignments, messages, and reviews carry over across restarts. You do not need to do anything special — `whoami` will return the same session ID as before.

The shared fwens database for this project is at `.fwens/fwens.db`.

## Tools

Sessions: `whoami`, `list_sessions`, `set_label`, `update_status`
Tasks: `create_task`, `list_tasks`, `claim_task`, `complete_task`, `cleanup_completed_tasks`
Reviews: `request_review`, `list_reviews`, `submit_review`, `respond_to_review`
Messages: `post_message`, `read_messages`
Context: `get_context`, `get_project_config`
