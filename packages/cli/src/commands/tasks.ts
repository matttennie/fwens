import { openDb } from "./open-db.js";

export function runTasks(projectDir: string, filter?: string): void {
  const db = openDb(projectDir);

  try {
    let query = `
      SELECT t.id, t.description, t.status, t.created_at, t.updated_at,
             s.label AS assignee_label, s.id AS assignee_id
      FROM tasks t
      LEFT JOIN sessions s ON t.assigned_to = s.id
    `;
    const params: string[] = [];

    if (filter) {
      query += " WHERE t.status = ?";
      params.push(filter);
    }

    query += " ORDER BY t.created_at DESC";

    const tasks = db.prepare(query).all(...params) as Array<{
      id: string;
      description: string;
      status: string;
      created_at: string;
      updated_at: string;
      assignee_label: string | null;
      assignee_id: string | null;
    }>;

    if (tasks.length === 0) {
      console.log(filter ? `No tasks with status '${filter}'.` : "No tasks found.");
      return;
    }

    console.log(`=== Tasks${filter ? ` (${filter})` : ""} ===`);
    for (const t of tasks) {
      const assignee = t.assignee_label ?? t.assignee_id ?? "unassigned";
      console.log(`  [${t.status}] ${t.id}`);
      console.log(`    ${t.description}`);
      console.log(`    Assigned to: ${assignee}`);
      console.log(`    Created: ${t.created_at}  Updated: ${t.updated_at}`);
      console.log();
    }
  } finally {
    db.close();
  }
}
