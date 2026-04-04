import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

interface SeedTask {
  description: string;
  context?: string;
  assigned_to?: string; // agent type: "claude", "gemini", "codex", "opencode"
}

export function runSeed(projectDir: string, taskFile: string): void {
  const dbPath = path.join(projectDir, ".fwens", "fwens.db");
  if (!fs.existsSync(dbPath)) {
    console.error("No .fwens/fwens.db found. Run 'fwens init' first.");
    process.exit(1);
  }

  const filePath = path.resolve(taskFile);
  if (!fs.existsSync(filePath)) {
    console.error(`Task file not found: ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const tasks = parseTaskFile(content);

  if (tasks.length === 0) {
    console.error("No tasks found in file. Use this format:");
    console.error("");
    console.error("## Task: Description here");
    console.error("Assigned: claude");
    console.error("Context: optional context here");
    process.exit(1);
  }

  const db = new Database(dbPath);

  // Find active sessions to resolve agent type → session ID
  const sessions = db
    .prepare(
      "SELECT id, agent_type, label FROM sessions WHERE status != 'disconnected' ORDER BY last_seen_at DESC"
    )
    .all() as { id: string; agent_type: string; label: string | null }[];

  const sessionByType = new Map<string, string>();
  for (const s of sessions) {
    if (!sessionByType.has(s.agent_type)) {
      sessionByType.set(s.agent_type, s.id);
    }
  }

  let created = 0;
  for (const task of tasks) {
    const id = crypto.randomUUID();
    let assignedTo: string | null = null;

    if (task.assigned_to) {
      assignedTo = sessionByType.get(task.assigned_to) ?? null;
      if (!assignedTo) {
        console.warn(
          `  Warning: no active session for "${task.assigned_to}", creating unassigned`
        );
      }
    }

    db.prepare(
      "INSERT INTO tasks (id, description, context, assigned_to) VALUES (?, ?, ?, ?)"
    ).run(id, task.description, task.context ?? null, assignedTo);

    const assignLabel = assignedTo
      ? task.assigned_to
      : "(unassigned)";
    console.log(`  Created: ${task.description.slice(0, 60)} → ${assignLabel}`);
    created++;
  }

  db.close();
  console.log(`\nSeeded ${created} tasks from ${filePath}`);
}

function parseTaskFile(content: string): SeedTask[] {
  const tasks: SeedTask[] = [];
  const blocks = content.split(/^## Task:/m).slice(1);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const description = lines[0].trim();

    let assigned_to: string | undefined;
    let context: string | undefined;
    const contextLines: string[] = [];
    let inContext = false;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const assignMatch = line.match(/^Assigned:\s*(.+)/i);
      const contextMatch = line.match(/^Context:\s*(.+)/i);

      if (assignMatch) {
        assigned_to = assignMatch[1].trim().toLowerCase();
        inContext = false;
      } else if (contextMatch) {
        contextLines.push(contextMatch[1].trim());
        inContext = true;
      } else if (inContext && line.trim()) {
        contextLines.push(line.trim());
      } else if (line.trim() === "") {
        inContext = false;
      }
    }

    if (contextLines.length > 0) {
      context = contextLines.join("\n");
    }

    tasks.push({ description, context, assigned_to });
  }

  return tasks;
}
