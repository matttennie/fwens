import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression guard against the duplication issue raised in the adversarial
// review (Codex finding #6): index.ts must remain a thin MCP-registration
// layer that delegates session lifecycle to createRuntimeManager. If anyone
// adds inline DB setup, session create/resume, prune, or cleanup directly
// into index.ts, these assertions fail loudly — which is what we want.
//
// These tests parse the source, not the behavior. They are intentionally
// brittle: that brittleness is the point. They will scream the moment a
// shortcut is taken.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.join(__dirname, "..", "index.ts");

function readIndex(): string {
  return fs.readFileSync(indexPath, "utf8");
}

describe("index.ts shape — drift guard for runtime/index duplication", () => {
  const src = readIndex();

  it("imports createRuntimeManager from runtime.js", () => {
    expect(src).toMatch(/import\s+\{\s*createRuntimeManager\s*\}\s+from\s+["']\.\/runtime\.js["']/);
  });

  it("does not import session lifecycle functions directly from db.js", () => {
    const forbidden = [
      "createSession",
      "resumeSession",
      "findDisconnectedSession",
      "pruneStaleSessions",
      "cleanupCompletedTasks",
      "updateLastSeen",
      "updateSessionStatus",
    ];
    for (const sym of forbidden) {
      // Match `<sym>` as part of an import-from-"./db.js" statement.
      const importFromDb = new RegExp(
        `import[^;]*\\b${sym}\\b[^;]*from\\s+["']\\.\\/db\\.js["']`,
        "s",
      );
      expect(src, `index.ts must not import ${sym} from ./db.js — use runtime.ts`).not.toMatch(
        importFromDb,
      );
    }
  });

  it("does not import the SQLite driver directly", () => {
    expect(
      src,
      "index.ts must not import better-sqlite3 — DB ownership lives in runtime.ts",
    ).not.toMatch(/from\s+["']better-sqlite3["']/);
  });

  it("does not import the schema initializer directly", () => {
    expect(src, "index.ts must not call initializeDb — runtime.ts owns DB setup").not.toMatch(
      /\binitializeDb\b/,
    );
  });

  it("does not write session-history.jsonl inline", () => {
    expect(src, "index.ts must not own session-history logging — runtime.ts does").not.toMatch(
      /session-history/,
    );
  });
});
