import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { initializeDb } from "@fwens/server/schema";
import { createSession, createTask } from "@fwens/server/db";
import { validatePath } from "@fwens/server/validation";

interface SeedTask {
  description: string;
  context?: string;
  assigned_to?: string;
}

export function runSeed(projectDir: string, taskFile: string): void {
  const dbPath = path.join(projectDir, ".fwens", "fwens.db");
  if (!fs.existsSync(dbPath)) {
    console.error("No .fwens/fwens.db found. Run an agent in this project first.");
    process.exit(1);
  }

  // Confine the seed file path to the project root so a malicious project
  // (cloned by a victim, with instructions to run `fwens seed /etc/passwd`)
  // cannot exfiltrate arbitrary files into the task database.
  let filePath: string;
  try {
    filePath = validatePath(taskFile, projectDir);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
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
    console.error("Assigned: claude-worker");
    console.error("Context: optional context here");
    process.exit(1);
  }

  const db = new Database(dbPath);
  initializeDb(db);

  const sessions = db
    .prepare(
      `SELECT id, label FROM sessions WHERE status != 'disconnected'
       ORDER BY last_seen_at DESC`,
    )
    .all() as { id: string; label: string | null }[];

  const sessionByLabel = new Map<string, string>();
  for (const s of sessions) {
    if (s.label && !sessionByLabel.has(s.label)) {
      sessionByLabel.set(s.label, s.id);
    }
  }

  // Register a synthetic "seed" session as the creator so completeTask's
  // assignee/creator authorization check has a real session to reference.
  // Marked disconnected immediately; not a participant.
  const seedSessionId = createSession(db, "fwens-seed", process.pid);
  db.prepare(`UPDATE sessions SET status = 'disconnected' WHERE id = ?`).run(seedSessionId);

  let created = 0;
  for (const task of tasks) {
    let assignedTo: string | undefined;

    if (task.assigned_to) {
      const resolved = sessionByLabel.get(task.assigned_to);
      if (resolved) {
        assignedTo = resolved;
      } else {
        console.warn(
          `  Warning: no active session labeled "${task.assigned_to}", creating unassigned`,
        );
      }
    }

    createTask(db, seedSessionId, {
      description: task.description,
      context: task.context,
      assigned_to: assignedTo,
    });

    const assignLabel = assignedTo ? task.assigned_to : "(unassigned)";
    console.log(`  Created: ${task.description.slice(0, 60)} -> ${assignLabel}`);
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
