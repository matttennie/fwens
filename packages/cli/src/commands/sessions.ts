import { openDb } from "./open-db.js";

export function runSessions(projectDir: string): void {
  const db = openDb(projectDir);

  try {
    const sessions = db
      .prepare(
        "SELECT id, agent_type, label, status, connected_at, last_seen_at FROM sessions ORDER BY last_seen_at DESC",
      )
      .all() as Array<{
      id: string;
      agent_type: string;
      label: string | null;
      status: string;
      connected_at: string;
      last_seen_at: string;
    }>;

    if (sessions.length === 0) {
      console.log("No sessions found.");
      return;
    }

    console.log("=== Sessions ===");
    for (const s of sessions) {
      const label = s.label ? ` (${s.label})` : "";
      console.log(`  ${s.agent_type}${label} [${s.status}] — ${s.id}`);
      console.log(`    Connected: ${s.connected_at}  Last seen: ${s.last_seen_at}`);
      console.log();
    }
  } finally {
    db.close();
  }
}
