import Database from "better-sqlite3";
import { initializeDb } from "./packages/server/dist/schema.js";
import { createSession, createTask, claimTask, postMessage, updateStatus } from "./packages/server/dist/db.js";

async function testRaceCondition() {
  console.log("Testing claimTask race condition...");
  const db = new Database(":memory:");
  initializeDb(db);

  const sessionId1 = createSession(db, "agent1");
  const sessionId2 = createSession(db, "agent2");
  const taskId = createTask(db, sessionId1, { description: "Race task" });

  console.log("Initial task status:", db.prepare("SELECT status, assigned_to FROM tasks WHERE id = ?").get(taskId));

  // Simulating what happens in two separate processes:
  // Process 1 reads status
  const taskP1 = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  // Process 2 reads status
  const taskP2 = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);

  console.log("Both processes see status as 'open'");

  // Process 1 claims
  if (taskP1.status === 'open') {
      db.transaction(() => {
        db.prepare(`UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?`).run(sessionId1, taskId);
      })();
  }
  console.log("After Process 1 claims:", db.prepare("SELECT status, assigned_to FROM tasks WHERE id = ?").get(taskId));

  // Process 2 claims - it ALREADY CHECKED status and saw 'open', so it proceeds
  if (taskP2.status === 'open') {
      db.transaction(() => {
        db.prepare(`UPDATE tasks SET status = 'in_progress', assigned_to = ? WHERE id = ?`).run(sessionId2, taskId);
      })();
  }
  
  const finalTask = db.prepare("SELECT status, assigned_to FROM tasks WHERE id = ?").get(taskId);
  console.log("After Process 2 claims:", finalTask);
  if (finalTask.assigned_to === sessionId2) {
      console.log("FAIL: Process 2 successfully overwrote Process 1's claim because the status check was outside the transaction!");
  }
}

async function testSqliteBusy() {
  console.log("\nTesting SQLITE_BUSY...");
  const fs = require("node:fs");
  const dbPath = "busy_test.db";
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db1 = new Database(dbPath);
  initializeDb(db1);
  const db2 = new Database(dbPath);

  const sessionId = createSession(db1, "busy-agent");

  console.log("Connection 1 starts an IMMEDIATE transaction (locks the DB)...");
  db1.prepare("BEGIN IMMEDIATE").run();

  console.log("Connection 2 tries to write...");
  try {
    db2.prepare("INSERT INTO messages (id, content) VALUES (?, ?)").run("msg1", "hello");
    console.log("Connection 2 SHOULD HAVE FAILED but succeeded? (maybe because of WAL or no write yet)");
  } catch (e) {
    console.log("SUCCESS: Connection 2 failed with expected error:", e.message);
    if (e.message.includes("database is locked")) {
        console.log("This confirms that without a timeout, concurrent writes will cause immediate crashes.");
    }
  }

  db1.prepare("COMMIT").run();
  db1.close();
  db2.close();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
}

async function main() {
  await testRaceCondition();
  await testSqliteBusy();
}

main().catch(console.error);
