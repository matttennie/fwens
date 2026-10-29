#!/usr/bin/env bash
# Live relay test across real clients sharing one fwens board:
# claude -> codex -> antigravity (agy), each in its own tmux window.
# The run id appears only in claude's prompt, so seeing it in antigravity's
# message proves each agent read the previous agent's post.
# Watch with: tmux attach -t fwens-livetest. Approve prompts yourself (folder
# trust on first run, fwens tool calls); Antigravity's ToS forbids scripting them.
set -euo pipefail

dir=/tmp/fwens-playground
db="$dir/.fwens/fwens.db"
run="run-$(date +%s)"
mkdir -p "$dir"
tmux kill-session -t fwens-livetest 2>/dev/null || true

# Poll the board (5s x 120 = 10 min) for a general message containing $1 and the run id.
wait_for() {
  for _ in $(seq 120); do
    if [ -n "$(sqlite3 -readonly "$db" "SELECT 1 FROM messages WHERE channel = 'general' AND content LIKE '%$1%' AND content LIKE '%$run%' LIMIT 1" 2>/dev/null)" ]; then
      echo "ok: $1"
      return
    fi
    sleep 5
  done
  echo "FAIL: no '$1' message for $run"
  exit 1
}

relay='Using the fwens MCP tools: read_messages on channel "general", then post_message to "general" with content'

tmux new-session -d -s fwens-livetest -n claude -c "$dir" \
  claude "Using the fwens MCP tools: post_message to channel \"general\" with content \"ping $run\". Do nothing else."
wait_for ping

tmux new-window -t fwens-livetest -n codex -c "$dir" \
  codex "$relay \"codex saw: \" followed by the newest message's content. Do nothing else."
wait_for "codex saw"

tmux new-window -t fwens-livetest -n antigravity -c "$dir" \
  agy -i "$relay \"antigravity saw: \" followed by the newest message's content. Do nothing else."
wait_for "antigravity saw"

echo "PASS: $run relayed claude -> codex -> antigravity"
