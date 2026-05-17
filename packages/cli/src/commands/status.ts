import { openDb } from "./open-db.js";

export function runStatus(projectDir: string): void {
  const db = openDb(projectDir);

  try {
    // Task counts by status
    const taskCounts = db
      .prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status")
      .all() as Array<{ status: string; count: number }>;

    console.log("=== Task Status ===");
    if (taskCounts.length === 0) {
      console.log("  No tasks found.");
    } else {
      for (const row of taskCounts) {
        console.log(`  ${row.status}: ${row.count}`);
      }
    }

    // Pending review count
    const pendingReviews = db
      .prepare("SELECT COUNT(*) as count FROM reviews WHERE verdict IS NULL")
      .get() as { count: number };

    console.log(`\n=== Pending Reviews ===`);
    console.log(`  ${pendingReviews.count} pending`);

    // Active sessions
    const activeSessions = db
      .prepare("SELECT id, label, status FROM sessions WHERE status != 'disconnected'")
      .all() as Array<{
      id: string;
      label: string | null;
      status: string;
    }>;

    console.log(`\n=== Active Sessions ===`);
    if (activeSessions.length === 0) {
      console.log("  No active sessions.");
    } else {
      for (const s of activeSessions) {
        const label = s.label ?? "(unlabeled)";
        console.log(`  ${label} [${s.status}] — ${s.id}`);
      }
    }
  } finally {
    db.close();
  }
}
