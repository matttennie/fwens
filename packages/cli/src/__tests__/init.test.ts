import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../commands/init.js";

describe("runInit", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fwens-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .fwens directory", () => {
    runInit(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, ".fwens"))).toBe(true);
  });

  it("creates config.json with project_root", () => {
    runInit(tmpDir);
    const configPath = path.join(tmpDir, ".fwens", "config.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.project_root).toBe(tmpDir);
  });

  it("creates SQLite database", () => {
    runInit(tmpDir);
    const dbPath = path.join(tmpDir, ".fwens", "fwens.db");
    expect(fs.existsSync(dbPath)).toBe(true);

    // Verify the database has the expected tables
    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    db.close();

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("reviews");
    expect(tableNames).toContain("messages");
  });

  it("generates MCP config snippets", () => {
    runInit(tmpDir);
    const mcpDir = path.join(tmpDir, ".fwens", "mcp-configs");

    expect(fs.existsSync(path.join(mcpDir, "claude.json"))).toBe(true);
    expect(fs.existsSync(path.join(mcpDir, "gemini.json"))).toBe(true);
    expect(fs.existsSync(path.join(mcpDir, "codex.toml"))).toBe(true);
    expect(fs.existsSync(path.join(mcpDir, "opencode.json"))).toBe(true);

    // Verify claude.json content
    const claudeConfig = JSON.parse(
      fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8")
    );
    expect(claudeConfig.mcpServers.fwens.env.FWENS_AGENT_TYPE).toBe("claude");
    expect(claudeConfig.mcpServers.fwens.env.FWENS_PROJECT).toBe(tmpDir);
  });

  it("is idempotent (running twice does not error)", () => {
    runInit(tmpDir);
    // Should not throw
    expect(() => runInit(tmpDir)).not.toThrow();

    // config.json should still have original project_root
    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".fwens", "config.json"), "utf-8")
    );
    expect(config.project_root).toBe(tmpDir);
  });
});
