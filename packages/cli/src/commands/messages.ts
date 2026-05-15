import { openDb } from "./open-db.js";

export function runMessages(projectDir: string, channel?: string): void {
  const db = openDb(projectDir);

  try {
    let query = `
      SELECT m.id, m.channel, m.content, m.created_at,
             s.agent_type AS author_type, s.label AS author_label
      FROM messages m
      LEFT JOIN sessions s ON m.author = s.id
    `;
    const params: string[] = [];

    if (channel) {
      query += " WHERE m.channel = ?";
      params.push(channel);
    }

    query += " ORDER BY m.created_at ASC";

    const messages = db.prepare(query).all(...params) as Array<{
      id: string;
      channel: string;
      content: string;
      created_at: string;
      author_type: string | null;
      author_label: string | null;
    }>;

    if (messages.length === 0) {
      console.log(channel ? `No messages in channel '${channel}'.` : "No messages found.");
      return;
    }

    const heading = channel ? `Messages (#${channel})` : "Messages";
    console.log(`=== ${heading} ===`);
    for (const m of messages) {
      const author = m.author_type
        ? `${m.author_type}${m.author_label ? ` (${m.author_label})` : ""}`
        : "unknown";
      console.log(`  [${m.created_at}] #${m.channel} ${author}: ${m.content}`);
    }
  } finally {
    db.close();
  }
}
