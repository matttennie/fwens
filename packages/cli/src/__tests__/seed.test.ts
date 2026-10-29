import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeDb } from "@fwens/server/schema";
import { createSession } from "@fwens/server/db";
import { runSeed } from "../commands/seed.js";

describe("runSeed", () => {
  it("assigns tasks to sessions by label, ignoring case", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fwens-seed-"));
    fs.mkdirSync(path.join(dir, ".fwens"));
    const db = new Database(path.join(dir, ".fwens", "fwens.db"));
    initializeDb(db);
    const worker = createSession(db, "Codex-Worker");
    db.close();

    fs.writeFileSync(
      path.join(dir, "tasks.md"),
      "## Task: Mixed case\nAssigned: Codex-Worker\n\n## Task: Lower case\nAssigned: codex-worker\n",
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    runSeed(dir, "tasks.md");

    const check = new Database(path.join(dir, ".fwens", "fwens.db"), { readonly: true });
    const assigned = check
      .prepare("SELECT assigned_to FROM tasks ORDER BY created_at, rowid")
      .pluck()
      .all();
    check.close();
    fs.rmSync(dir, { recursive: true, force: true });

    expect(assigned).toEqual([worker, worker]);
  });
});
