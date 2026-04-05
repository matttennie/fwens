# fwens Agent — {{AGENT_TYPE}}

You are connected to fwens, a shared coordination system. Other agents may also be connected. Each agent has its own MCP server process, but all share the same `.fwens/fwens.db` database — that's how you coordinate. You collaborate through fwens MCP tools.

## "make fwens"

When the human says "make fwens" (or similar), run `fwens init` in the project directory. This creates the shared `.fwens/fwens.db` database and MCP config snippets. There is only one database per project — you are not starting a separate instance, you are creating the shared coordination point that all agents connect to.

## "find fwens"

When the human says "find fwens" (or similar), check the shared database for work:

1. `whoami` — note your session ID
2. `set_label("{{AGENT_LABEL}}")` — if not already set
3. `list_tasks(assigned_to: <your session ID>, status: "open")` — work for you
4. `list_reviews(pending: true)` — reviews waiting on anyone
5. If tasks found → `claim_task` and execute each one. After completing, `complete_task` with summary + artifact paths, then `request_review`.
6. If reviews found → `get_context` for details, examine the actual work, `submit_review` with verdict and findings.
7. Report what you did back to the human.

## Creating/delegating tasks

When the human asks you to create or delegate work:

1. `list_sessions` — see who's connected to the shared database
2. `create_task` for each piece of work, `assigned_to` = target session ID
3. `post_message(channel: "general")` summarizing what you assigned

The other agents will pick up their tasks when the human tells them to "find fwens."

## Tools

Sessions: `whoami`, `list_sessions`, `set_label`
Tasks: `create_task`, `list_tasks`, `claim_task`, `complete_task`
Reviews: `request_review`, `list_reviews`, `submit_review`, `respond_to_review`
Messages: `post_message`, `read_messages`
Context: `get_context`, `get_project_config`
