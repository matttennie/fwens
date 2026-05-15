import Database from "better-sqlite3";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";

interface SessionRow {
  id: string;
  agent_type: string;
  label: string | null;
  status: string;
  tokens_used: number;
  connected_at: string;
  last_seen_at: string;
}

interface TaskRow {
  id: string;
  short_name: string | null;
  description: string;
  status: string;
  assigned_to: string | null;
  created_at: string;
}

interface ReviewRow {
  id: string;
  task_id: string;
  verdict: string | null;
}

function getState(db: Database.Database) {
  // Most recent session per agent_type only — no old disconnected sessions
  const sessions = db
    .prepare(
      `SELECT s.* FROM sessions s
       INNER JOIN (
         SELECT agent_type, MAX(connected_at) as max_connected
         FROM sessions
         GROUP BY agent_type
       ) latest ON s.agent_type = latest.agent_type AND s.connected_at = latest.max_connected
       ORDER BY s.agent_type`,
    )
    .all() as SessionRow[];

  // Get ALL session IDs for each agent type that has a current session
  // so tasks assigned to previous sessions of the same agent still show up
  const agentTypes = sessions.map((s) => s.agent_type);
  const typePlaceholders = agentTypes.map(() => "?").join(",");

  const allAgentSessionIds =
    agentTypes.length > 0
      ? (db
          .prepare(`SELECT id, agent_type FROM sessions WHERE agent_type IN (${typePlaceholders})`)
          .all(...agentTypes) as { id: string; agent_type: string }[])
      : [];

  // Map old session IDs to current session ID for that agent type
  const currentSessionByType = new Map(sessions.map((s) => [s.agent_type, s.id]));
  const sessionIdToCurrentId = new Map<string, string>();
  for (const row of allAgentSessionIds) {
    const currentId = currentSessionByType.get(row.agent_type);
    if (currentId) sessionIdToCurrentId.set(row.id, currentId);
  }

  const allSessionIds = allAgentSessionIds.map((r) => r.id);
  const allPlaceholders = allSessionIds.map(() => "?").join(",");

  const rawTasks =
    allSessionIds.length > 0
      ? (db
          .prepare(
            `SELECT id, short_name, description, status, assigned_to, created_at
             FROM tasks
             WHERE assigned_to IN (${allPlaceholders}) OR assigned_to IS NULL
             ORDER BY created_at`,
          )
          .all(...allSessionIds) as TaskRow[])
      : (db
          .prepare(
            "SELECT id, short_name, description, status, assigned_to, created_at FROM tasks ORDER BY created_at",
          )
          .all() as TaskRow[]);

  // Remap old session assignments to current session IDs for display
  const tasks = rawTasks.map((t) => ({
    ...t,
    assigned_to: t.assigned_to ? (sessionIdToCurrentId.get(t.assigned_to) ?? t.assigned_to) : null,
  }));

  const reviews = db.prepare("SELECT id, task_id, verdict FROM reviews").all() as ReviewRow[];

  return { sessions, tasks, reviews };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fwens watch</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
    background: #0d1117;
    color: #e6edf3;
    padding: 20px;
    min-height: 100vh;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding: 12px 16px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
  }

  header h1 { font-size: 16px; font-weight: 600; color: #58a6ff; }

  header .stats {
    font-size: 12px;
    color: #8b949e;
    display: flex;
    gap: 16px;
  }

  .agent-grid { display: flex; flex-direction: column; gap: 12px; }

  .agent-row {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 14px 16px;
    display: grid;
    grid-template-columns: 180px 80px 80px 1fr;
    gap: 12px;
    align-items: start;
    min-height: 56px;
  }

  .agent-row.disconnected { opacity: 0.4; }

  .agent-name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 14px;
  }

  .dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  .dot.active, .dot.idle { background: #3fb950; box-shadow: 0 0 6px #3fb95066; }
  .dot.busy { background: #d29922; box-shadow: 0 0 6px #d2992266; }
  .dot.stuck { background: #f85149; box-shadow: 0 0 6px #f8514966; }
  .dot.disconnected { background: #484f58; }

  .agent-status {
    font-size: 11px; color: #8b949e;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding-top: 2px;
  }

  .agent-tokens { font-size: 12px; color: #8b949e; padding-top: 1px; }

  .tasks-container {
    display: flex;
    gap: 8px;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .tasks-container::-webkit-scrollbar { height: 4px; }
  .tasks-container::-webkit-scrollbar-track { background: transparent; }
  .tasks-container::-webkit-scrollbar-thumb { background: #30363d; border-radius: 2px; }

  .task-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid #30363d;
    border-radius: 6px;
    font-size: 12px;
    white-space: nowrap;
    flex-shrink: 0;
    background: #0d1117;
  }

  .task-chip.in_progress { border-color: #d29922; color: #d29922; }
  .task-chip.open { border-color: #484f58; color: #8b949e; }
  .task-chip.done, .task-chip.reviewed { border-color: #238636; color: #3fb950; }
  .task-chip.review_requested { border-color: #1f6feb; color: #58a6ff; }
  .task-chip.cancelled { border-color: #f85149; color: #f85149; text-decoration: line-through; opacity: 0.6; }

  .task-icon { font-size: 13px; }

  .review-badge {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #1f6feb;
    display: inline-block;
  }

  .no-tasks { font-size: 12px; color: #484f58; font-style: italic; padding-top: 2px; }

  .unassigned-row { background: #0d1117; border: 1px dashed #30363d; }
  .unassigned-row .agent-name { color: #484f58; }

  @keyframes spin {
    0% { content: '\\2800'; }
    12% { content: '\\2801'; }
    25% { content: '\\2803'; }
    37% { content: '\\2807'; }
    50% { content: '\\280F'; }
    62% { content: '\\281F'; }
    75% { content: '\\283F'; }
    87% { content: '\\287F'; }
    100% { content: '\\28FF'; }
  }

  .spinner::after { content: '\\2801'; animation: spin 0.8s steps(8) infinite; }

  footer {
    margin-top: 20px;
    padding: 10px 16px;
    font-size: 11px;
    color: #484f58;
    text-align: center;
  }
</style>
</head>
<body>
  <header>
    <h1>fwens watch</h1>
    <div class="stats">
      <span id="stat-tasks"></span>
      <span id="stat-reviews"></span>
      <span id="stat-tokens"></span>
    </div>
  </header>
  <div class="agent-grid" id="grid"></div>
  <footer>polling every 1.5s</footer>

<script>
const TASK_SORT = { in_progress: 0, open: 1, review_requested: 2, done: 3, reviewed: 4, cancelled: 5 };
const TASK_ICONS = { open: '\\u25FB', in_progress: '', done: '\\u2713', reviewed: '\\u2713', review_requested: '\\u25C8', cancelled: '\\u2717' };

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.textContent;
}

function formatTokens(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(1) + 'k';
  return (n / 1e6).toFixed(2) + 'M';
}

function makeChip(task, reviews) {
  const chip = document.createElement('div');
  chip.className = 'task-chip ' + task.status;

  const icon = document.createElement('span');
  icon.className = task.status === 'in_progress' ? 'task-icon spinner' : 'task-icon';
  if (task.status !== 'in_progress') icon.textContent = TASK_ICONS[task.status] || '';
  chip.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = task.short_name || task.description.slice(0, 20);
  chip.appendChild(label);

  const pending = reviews.some(r => r.task_id === task.id && r.verdict === null);
  if (pending) {
    const badge = document.createElement('span');
    badge.className = 'review-badge';
    chip.appendChild(badge);
  }

  return chip;
}

function render(data) {
  const { sessions, tasks, reviews } = data;
  const grid = document.getElementById('grid');
  grid.replaceChildren();

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => t.status === 'done' || t.status === 'reviewed').length;
  const pendingReviews = reviews.filter(r => r.verdict === null).length;
  const totalTokens = sessions.reduce((s, a) => s + (a.tokens_used || 0), 0);

  document.getElementById('stat-tasks').textContent = doneTasks + '/' + totalTasks + ' tasks done';
  document.getElementById('stat-reviews').textContent = pendingReviews + ' reviews pending';
  document.getElementById('stat-tokens').textContent = formatTokens(totalTokens) + ' tokens';

  for (const session of sessions) {
    const agentTasks = tasks
      .filter(t => t.assigned_to === session.id)
      .sort((a, b) => (TASK_SORT[a.status] ?? 9) - (TASK_SORT[b.status] ?? 9));

    const row = document.createElement('div');
    row.className = 'agent-row' + (session.status === 'disconnected' ? ' disconnected' : '');

    // Name
    const name = document.createElement('div');
    name.className = 'agent-name';
    const dot = document.createElement('span');
    dot.className = 'dot ' + session.status;
    name.appendChild(dot);
    const nameText = document.createTextNode(' ' + (session.label || session.agent_type));
    name.appendChild(nameText);
    row.appendChild(name);

    // Status
    const status = document.createElement('div');
    status.className = 'agent-status';
    status.textContent = session.status;
    row.appendChild(status);

    // Tokens
    const tokens = document.createElement('div');
    tokens.className = 'agent-tokens';
    tokens.textContent = formatTokens(session.tokens_used);
    row.appendChild(tokens);

    // Tasks
    const container = document.createElement('div');
    container.className = 'tasks-container';
    if (agentTasks.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'no-tasks';
      empty.textContent = 'no tasks';
      container.appendChild(empty);
    } else {
      for (const task of agentTasks) {
        container.appendChild(makeChip(task, reviews));
      }
    }
    row.appendChild(container);
    grid.appendChild(row);
  }

  // Unassigned
  const unassigned = tasks.filter(t => t.assigned_to === null);
  if (unassigned.length > 0) {
    const row = document.createElement('div');
    row.className = 'agent-row unassigned-row';

    const name = document.createElement('div');
    name.className = 'agent-name';
    name.textContent = 'unassigned';
    row.appendChild(name);

    row.appendChild(document.createElement('div'));
    row.appendChild(document.createElement('div'));

    const container = document.createElement('div');
    container.className = 'tasks-container';
    for (const task of unassigned.sort((a, b) => (TASK_SORT[a.status] ?? 9) - (TASK_SORT[b.status] ?? 9))) {
      container.appendChild(makeChip(task, reviews));
    }
    row.appendChild(container);
    grid.appendChild(row);
  }
}

async function poll() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    render(data);
  } catch (e) {}
}

poll();
setInterval(poll, 1500);
</script>
</body>
</html>`;

export function runWatch(projectDir: string, pollMs: number): void {
  const dbPath = path.join(projectDir, ".fwens", "fwens.db");
  if (!fs.existsSync(dbPath)) {
    console.error("No .fwens/fwens.db found. Run 'fwens init' first.");
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });

  try {
    db.prepare("SELECT tokens_used FROM sessions LIMIT 0").run();
    db.prepare("SELECT short_name FROM tasks LIMIT 0").run();
  } catch {
    console.error(
      "Database schema is outdated. Start any agent in this project to auto-migrate, then try again.",
    );
    process.exit(1);
  }

  const port = 3456;

  const srv = http.createServer((req, res) => {
    if (req.url === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getState(db)));
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(DASHBOARD_HTML);
    }
  });

  // Bind explicitly to 127.0.0.1 — the dashboard is local-only by design;
  // it must not be reachable from other hosts on the network.
  srv.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`fwens watch → ${url}`);
    console.log("Press Ctrl-C to quit.\n");

    import("node:child_process").then(({ execFile }) => {
      execFile("open", [url]);
    });
  });

  process.on("SIGINT", () => {
    db.close();
    srv.close();
    process.exit(0);
  });
}
