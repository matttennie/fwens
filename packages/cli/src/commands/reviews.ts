import { openDb } from "./open-db.js";

export function runReviews(projectDir: string, pending?: boolean): void {
  const db = openDb(projectDir);

  try {
    let query = `
      SELECT r.id, r.task_id, r.verdict, r.findings, r.created_at,
             s.agent_type AS reviewer_type, s.label AS reviewer_label
      FROM reviews r
      LEFT JOIN sessions s ON r.reviewer = s.id
    `;

    if (pending) {
      query += " WHERE r.verdict IS NULL";
    }

    query += " ORDER BY r.created_at DESC";

    const reviews = db.prepare(query).all() as Array<{
      id: string;
      task_id: string;
      verdict: string | null;
      findings: string | null;
      created_at: string;
      reviewer_type: string | null;
      reviewer_label: string | null;
    }>;

    if (reviews.length === 0) {
      console.log(pending ? "No pending reviews." : "No reviews found.");
      return;
    }

    const heading = pending ? "Pending Reviews" : "Reviews";
    console.log(`=== ${heading} ===`);
    for (const r of reviews) {
      const reviewer = r.reviewer_type
        ? `${r.reviewer_type}${r.reviewer_label ? ` (${r.reviewer_label})` : ""}`
        : "unassigned";
      const verdict = r.verdict ?? "pending";
      console.log(`  [${verdict}] ${r.id} — task: ${r.task_id}`);
      console.log(`    Reviewer: ${reviewer}`);
      if (r.findings) {
        console.log(`    Findings: ${r.findings}`);
      }
      console.log(`    Created: ${r.created_at}`);
      console.log();
    }
  } finally {
    db.close();
  }
}
