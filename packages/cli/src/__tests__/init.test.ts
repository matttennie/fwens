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
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
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

    // Verify claude.json content (mcpServers format)
    const claudeConfig = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    expect(claudeConfig.mcpServers.fwens.env.FWENS_AGENT_TYPE).toBe("claude");
    expect(claudeConfig.mcpServers.fwens.env.FWENS_PROJECT).toBe(tmpDir);

    // Verify opencode.json uses OpenCode's schema (not mcpServers)
    const opencodeConfig = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    expect(opencodeConfig.mcp.fwens.type).toBe("local");
    expect(opencodeConfig.mcp.fwens.command).toBeInstanceOf(Array);
    expect(opencodeConfig.mcp.fwens.command[0]).toBe("node");
    expect(opencodeConfig.mcp.fwens.environment.FWENS_AGENT_TYPE).toBe("opencode");
    expect(opencodeConfig.mcp.fwens.environment.FWENS_PROJECT).toBe(tmpDir);
    expect(opencodeConfig.mcp.fwens.enabled).toBe(true);
    // Should NOT have the wrong keys
    expect(opencodeConfig.mcpServers).toBeUndefined();
    expect(opencodeConfig.mcp.fwens.env).toBeUndefined();
    expect(opencodeConfig.mcp.fwens.args).toBeUndefined();
  });

  it("installs project instruction files that make agents check fwens on startup", () => {
    runInit(tmpDir);

    for (const filename of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "OPENCODE.md"]) {
      const instructionPath = path.join(tmpDir, filename);
      expect(fs.existsSync(instructionPath)).toBe(true);

      const content = fs.readFileSync(instructionPath, "utf-8");
      expect(content).toContain("<!-- fwens:start -->");
      expect(content).toContain("<!-- fwens:end -->");
      expect(content).toContain("## Session Startup");
      expect(content).toContain(
        "Pick the highest-priority task from the task description or general-channel messages",
      );
      expect(content).toContain('## "find fwens"');
      expect(content).toContain("never claim a task assigned to another agent");
      expect(content).toContain("## Executing Work");
      expect(content).toContain("Always include a `short_name` (2-4 words) for dashboard display");
      expect(content).toContain("## CRITICAL: No Confirmation Required");
      expect(content).toContain('## "make fwens"');
      expect(content).toContain("## Session Resume");
      expect(content).toContain("## Tools");
      expect(content).toContain(
        "The shared fwens database for this project is at `.fwens/fwens.db`.",
      );
      expect(content).not.toContain(tmpDir);
    }
  });

  it("writes mirrored instruction files under .fwens for manual setup", () => {
    runInit(tmpDir);
    const instructionsDir = path.join(tmpDir, ".fwens", "agent-instructions");

    for (const filename of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "OPENCODE.md"]) {
      const mirroredPath = path.join(instructionsDir, filename);
      expect(fs.existsSync(mirroredPath)).toBe(true);

      const content = fs.readFileSync(mirroredPath, "utf-8");
      expect(content).toContain("## Session Startup");
      expect(content).toContain('## "find fwens"');
      expect(content).toContain("## Executing Work");
      expect(content).toContain("## CRITICAL: No Confirmation Required");
    }
  });

  it("preserves existing instruction content while adding the fwens block", () => {
    const agentsPath = path.join(tmpDir, "AGENTS.md");
    fs.writeFileSync(agentsPath, "# Project Instructions\n\nKeep local conventions intact.\n");

    runInit(tmpDir);

    const content = fs.readFileSync(agentsPath, "utf-8");
    expect(content).toContain("# Project Instructions");
    expect(content).toContain("Keep local conventions intact.");
    expect(content).toContain("<!-- fwens:start -->");
    expect(content).toContain("## Session Startup");
  });

  it("replaces an existing managed instruction block instead of duplicating it", () => {
    const agentsPath = path.join(tmpDir, "AGENTS.md");
    fs.writeFileSync(
      agentsPath,
      [
        "# Project Instructions",
        "",
        "<!-- fwens:start -->",
        "old fwens instructions",
        "<!-- fwens:end -->",
        "",
        "Keep this footer.",
        "",
      ].join("\n"),
    );

    runInit(tmpDir);
    runInit(tmpDir);

    const content = fs.readFileSync(agentsPath, "utf-8");
    expect(content).toContain("# Project Instructions");
    expect(content).toContain("Keep this footer.");
    expect(content).toContain("## Session Startup");
    expect(content).not.toContain("old fwens instructions");
    expect(content.match(/<!-- fwens:start -->/g)).toHaveLength(1);
    expect(content.match(/<!-- fwens:end -->/g)).toHaveLength(1);
  });

  it("is idempotent (running twice does not error)", () => {
    runInit(tmpDir);
    // Should not throw
    expect(() => runInit(tmpDir)).not.toThrow();

    // config.json should still have original project_root
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, ".fwens", "config.json"), "utf-8"));
    expect(config.project_root).toBe(tmpDir);
  });
});
