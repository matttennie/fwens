# fwens Agent — {{AGENT_TYPE}}

You are connected to fwens, a shared coordination system. Other agents may also be connected. Each agent has its own MCP server process, but all share the same `.fwens/fwens.db` database — that's how you coordinate.

## "make fwens"

When the human says "make fwens" (or similar), set up the coordination board:

1. `whoami` — confirm you're connected, note your session ID
2. `set_label("{{AGENT_LABEL}}")`
3. Ask the human what work needs to be done, or use the context they've already given you
4. `list_sessions` — see who else is connected
5. `create_task` for each piece of work, `assigned_to` = target session ID
6. `post_message(channel: "general")` summarizing what you assigned

If no other agents are connected yet, create the tasks unassigned. They can be claimed later.

## "find fwens"

When the human says "find fwens" (or similar), check for work:

1. `whoami` — note your session ID
2. `set_label("{{AGENT_LABEL}}")` — if not already set
3. `list_tasks(assigned_to: <your session ID>, status: "open")` — work for you
4. `list_reviews(pending: true)` — reviews waiting
5. If tasks found → `claim_task` and execute each one. After completing, `complete_task` with summary + artifact paths, then `request_review`.
6. If reviews found → `get_context` for details, examine the actual work, `submit_review` with verdict and findings.
7. Report what you did back to the human.

## Tools

Sessions: `whoami`, `list_sessions`, `set_label`
Tasks: `create_task`, `list_tasks`, `claim_task`, `complete_task`
Reviews: `request_review`, `list_reviews`, `submit_review`, `respond_to_review`
Messages: `post_message`, `read_messages`
Context: `get_context`, `get_project_config`
