/**
 * Thorough tests for generated MCP config files.
 *
 * Each CLI (Claude, Gemini, Codex, OpenCode) has its own config schema.
 * These tests verify that every generated config:
 *   1. Uses the correct top-level key and structure for that CLI
 *   2. Contains valid values (server path, agent type, project dir)
 *   3. Does NOT contain keys from a different CLI's schema
 *   4. Points to a server path that resolves consistently
 *   5. Survives re-init (idempotent)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../commands/init.js";

let tmpDir: string;
let mcpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fwens-mcp-test-"));
  runInit(tmpDir);
  mcpDir = path.join(tmpDir, ".fwens", "mcp-configs");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: the server path is relative to the compiled CLI, so we compute
// what init.ts would have resolved it to.
// ---------------------------------------------------------------------------

function expectedServerPath(): string {
  // init.ts does: path.resolve(__dirname, "../../../server/dist/index.js")
  // __dirname at runtime is the compiled CLI output: packages/cli/dist/commands/
  // so ../../../server/dist/index.js => packages/server/dist/index.js
  // We just check that every config contains a path ending with this suffix.
  return "packages/server/dist/index.js";
}

// ---------------------------------------------------------------------------
// Claude Code — mcpServers format
// ---------------------------------------------------------------------------

describe("claude.json", () => {
  it("exists after init", () => {
    expect(fs.existsSync(path.join(mcpDir, "claude.json"))).toBe(true);
  });

  it("is valid JSON", () => {
    const raw = fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("uses mcpServers top-level key", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    expect(config).toHaveProperty("mcpServers");
    expect(config).toHaveProperty("mcpServers.fwens");
  });

  it("has command as a string", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    expect(config.mcpServers.fwens.command).toBe("node");
  });

  it("has args as an array with the server path", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    const args = config.mcpServers.fwens.args;
    expect(Array.isArray(args)).toBe(true);
    expect(args).toHaveLength(1);
    expect(args[0]).toContain(expectedServerPath());
  });

  it("sets FWENS_AGENT_TYPE to claude", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    expect(config.mcpServers.fwens.env.FWENS_AGENT_TYPE).toBe("claude");
  });

  it("sets FWENS_PROJECT to the project directory", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    expect(config.mcpServers.fwens.env.FWENS_PROJECT).toBe(tmpDir);
  });

  it("does not contain OpenCode-specific keys", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    expect(config.mcp).toBeUndefined();
    expect(config.mcpServers.fwens.type).toBeUndefined();
    expect(config.mcpServers.fwens.environment).toBeUndefined();
    expect(config.mcpServers.fwens.enabled).toBeUndefined();
  });

  it("has only expected keys in the fwens entry", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    const keys = Object.keys(config.mcpServers.fwens).sort();
    expect(keys).toEqual(["args", "command", "env"]);
  });

  it("has only expected env vars", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    const envKeys = Object.keys(config.mcpServers.fwens.env).sort();
    expect(envKeys).toEqual(["FWENS_AGENT_TYPE", "FWENS_PROJECT"]);
  });
});

// ---------------------------------------------------------------------------
// Gemini CLI — mcpServers format (same schema as Claude)
// ---------------------------------------------------------------------------

describe("gemini.json", () => {
  it("exists after init", () => {
    expect(fs.existsSync(path.join(mcpDir, "gemini.json"))).toBe(true);
  });

  it("is valid JSON", () => {
    const raw = fs.readFileSync(path.join(mcpDir, "gemini.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("uses mcpServers top-level key", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "gemini.json"), "utf-8"));
    expect(config).toHaveProperty("mcpServers");
    expect(config).toHaveProperty("mcpServers.fwens");
  });

  it("has command as a string and args as an array", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "gemini.json"), "utf-8"));
    expect(config.mcpServers.fwens.command).toBe("node");
    expect(Array.isArray(config.mcpServers.fwens.args)).toBe(true);
    expect(config.mcpServers.fwens.args[0]).toContain(expectedServerPath());
  });

  it("sets FWENS_AGENT_TYPE to gemini", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "gemini.json"), "utf-8"));
    expect(config.mcpServers.fwens.env.FWENS_AGENT_TYPE).toBe("gemini");
  });

  it("sets FWENS_PROJECT to the project directory", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "gemini.json"), "utf-8"));
    expect(config.mcpServers.fwens.env.FWENS_PROJECT).toBe(tmpDir);
  });

  it("does not contain OpenCode-specific keys", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "gemini.json"), "utf-8"));
    expect(config.mcp).toBeUndefined();
    expect(config.mcpServers.fwens.type).toBeUndefined();
    expect(config.mcpServers.fwens.environment).toBeUndefined();
    expect(config.mcpServers.fwens.enabled).toBeUndefined();
  });

  it("has the same structure as claude.json (except agent_type)", () => {
    const claude = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    const gemini = JSON.parse(fs.readFileSync(path.join(mcpDir, "gemini.json"), "utf-8"));

    // Same keys
    expect(Object.keys(gemini.mcpServers.fwens).sort()).toEqual(
      Object.keys(claude.mcpServers.fwens).sort(),
    );
    // Same command
    expect(gemini.mcpServers.fwens.command).toBe(claude.mcpServers.fwens.command);
    // Same server path
    expect(gemini.mcpServers.fwens.args).toEqual(claude.mcpServers.fwens.args);
    // Different agent type
    expect(gemini.mcpServers.fwens.env.FWENS_AGENT_TYPE).not.toBe(
      claude.mcpServers.fwens.env.FWENS_AGENT_TYPE,
    );
  });
});

// ---------------------------------------------------------------------------
// Codex CLI — TOML format
// ---------------------------------------------------------------------------

describe("codex.toml", () => {
  it("exists after init", () => {
    expect(fs.existsSync(path.join(mcpDir, "codex.toml"))).toBe(true);
  });

  it("is not valid JSON (it's TOML)", () => {
    const raw = fs.readFileSync(path.join(mcpDir, "codex.toml"), "utf-8");
    expect(() => JSON.parse(raw)).toThrow();
  });

  it("has [mcp_servers.fwens] section header", () => {
    const raw = fs.readFileSync(path.join(mcpDir, "codex.toml"), "utf-8");
    expect(raw).toContain("[mcp_servers.fwens]");
  });

  it("has [mcp_servers.fwens.env] section header", () => {
    const raw = fs.readFileSync(path.join(mcpDir, "codex.toml"), "utf-8");
    expect(raw).toContain("[mcp_servers.fwens.env]");
  });

  it("sets command to node", () => {
    const raw = fs.readFileSync(path.join(mcpDir, "codex.toml"), "utf-8");
    expect(raw).toMatch(/command\s*=\s*"node"/);
  });

  it("has args as a TOML array with the server path", () => {
    const raw = fs.readFileSync(path.join(mcpDir, "codex.toml"), "utf-8");
    expect(raw).toMatch(/args\s*=\s*\["/);
    expect(raw).toContain(expectedServerPath());
  });

  it("sets FWENS_AGENT_TYPE to codex", () => {
    const raw = fs.readFileSync(path.join(mcpDir, "codex.toml"), "utf-8");
    expect(raw).toMatch(/FWENS_AGENT_TYPE\s*=\s*"codex"/);
  });

  it("sets FWENS_PROJECT to the project directory", () => {
    const raw = fs.readFileSync(path.join(mcpDir, "codex.toml"), "utf-8");
    expect(raw).toContain(`FWENS_PROJECT = "${tmpDir}"`);
  });

  it("does not use JSON-style keys (mcpServers, mcp)", () => {
    const raw = fs.readFileSync(path.join(mcpDir, "codex.toml"), "utf-8");
    expect(raw).not.toContain("mcpServers");
    expect(raw).not.toContain('"mcp"');
  });

  it("uses mcp_servers (underscore) not mcpServers (camelCase)", () => {
    const raw = fs.readFileSync(path.join(mcpDir, "codex.toml"), "utf-8");
    expect(raw).toContain("mcp_servers");
    expect(raw).not.toContain("mcpServers");
  });
});

// ---------------------------------------------------------------------------
// OpenCode — mcp format (different from Claude/Gemini)
// ---------------------------------------------------------------------------

describe("opencode.json", () => {
  it("exists after init", () => {
    expect(fs.existsSync(path.join(mcpDir, "opencode.json"))).toBe(true);
  });

  it("is valid JSON", () => {
    const raw = fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("uses mcp top-level key (NOT mcpServers)", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    expect(config).toHaveProperty("mcp");
    expect(config).toHaveProperty("mcp.fwens");
    expect(config.mcpServers).toBeUndefined();
  });

  it("sets type to local", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    expect(config.mcp.fwens.type).toBe("local");
  });

  it("has command as an array (not string + args)", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    const cmd = config.mcp.fwens.command;
    expect(Array.isArray(cmd)).toBe(true);
    expect(cmd[0]).toBe("node");
    expect(cmd[1]).toContain(expectedServerPath());
  });

  it("does NOT have a separate args field", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    expect(config.mcp.fwens.args).toBeUndefined();
  });

  it("uses environment key (NOT env)", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    expect(config.mcp.fwens.environment).toBeDefined();
    expect(config.mcp.fwens.env).toBeUndefined();
  });

  it("sets FWENS_AGENT_TYPE to opencode", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    expect(config.mcp.fwens.environment.FWENS_AGENT_TYPE).toBe("opencode");
  });

  it("sets FWENS_PROJECT to the project directory", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    expect(config.mcp.fwens.environment.FWENS_PROJECT).toBe(tmpDir);
  });

  it("sets enabled to true", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    expect(config.mcp.fwens.enabled).toBe(true);
  });

  it("has only expected keys in the fwens entry", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    const keys = Object.keys(config.mcp.fwens).sort();
    expect(keys).toEqual(["command", "enabled", "environment", "type"]);
  });

  it("has only expected environment vars", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    const envKeys = Object.keys(config.mcp.fwens.environment).sort();
    expect(envKeys).toEqual(["FWENS_AGENT_TYPE", "FWENS_PROJECT"]);
  });

  it("command array has exactly 2 elements (node + path)", () => {
    const config = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    expect(config.mcp.fwens.command).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Cross-config consistency
// ---------------------------------------------------------------------------

describe("cross-config consistency", () => {
  it("all configs point to the same server path", () => {
    const claude = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    const gemini = JSON.parse(fs.readFileSync(path.join(mcpDir, "gemini.json"), "utf-8"));
    const opencode = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    const codexRaw = fs.readFileSync(path.join(mcpDir, "codex.toml"), "utf-8");

    const claudePath = claude.mcpServers.fwens.args[0];
    const geminiPath = gemini.mcpServers.fwens.args[0];
    const opencodePath = opencode.mcp.fwens.command[1];
    // Extract path from TOML: args = ["<path>"]
    const codexMatch = codexRaw.match(/args\s*=\s*\["([^"]+)"\]/);
    const codexPath = codexMatch?.[1];

    expect(claudePath).toBe(geminiPath);
    expect(claudePath).toBe(opencodePath);
    expect(claudePath).toBe(codexPath);
  });

  it("all configs set the correct project directory", () => {
    const claude = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    const gemini = JSON.parse(fs.readFileSync(path.join(mcpDir, "gemini.json"), "utf-8"));
    const opencode = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));

    expect(claude.mcpServers.fwens.env.FWENS_PROJECT).toBe(tmpDir);
    expect(gemini.mcpServers.fwens.env.FWENS_PROJECT).toBe(tmpDir);
    expect(opencode.mcp.fwens.environment.FWENS_PROJECT).toBe(tmpDir);
  });

  it("each config sets a unique agent type", () => {
    const claude = JSON.parse(fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"));
    const gemini = JSON.parse(fs.readFileSync(path.join(mcpDir, "gemini.json"), "utf-8"));
    const opencode = JSON.parse(fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"));
    const codexRaw = fs.readFileSync(path.join(mcpDir, "codex.toml"), "utf-8");

    const types = new Set([
      claude.mcpServers.fwens.env.FWENS_AGENT_TYPE,
      gemini.mcpServers.fwens.env.FWENS_AGENT_TYPE,
      opencode.mcp.fwens.environment.FWENS_AGENT_TYPE,
    ]);
    // Extract from TOML
    const codexTypeMatch = codexRaw.match(/FWENS_AGENT_TYPE\s*=\s*"([^"]+)"/);
    types.add(codexTypeMatch![1]);

    expect(types.size).toBe(4);
    expect(types).toContain("claude");
    expect(types).toContain("gemini");
    expect(types).toContain("codex");
    expect(types).toContain("opencode");
  });

  it("all four config files exist", () => {
    const files = fs.readdirSync(mcpDir).sort();
    expect(files).toEqual(["claude.json", "codex.toml", "gemini.json", "opencode.json"]);
  });
});

// ---------------------------------------------------------------------------
// TOML injection prevention
// ---------------------------------------------------------------------------

describe("codex TOML injection prevention", () => {
  it("escapes double quotes in project directory path", () => {
    const evilDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fwens-mcp-evil"test-'));
    try {
      runInit(evilDir);
      const raw = fs.readFileSync(
        path.join(evilDir, ".fwens", "mcp-configs", "codex.toml"),
        "utf-8",
      );
      // The quote should be escaped, not raw
      expect(raw).not.toContain(`"${evilDir}"`);
      expect(raw).toContain('\\"');
    } finally {
      fs.rmSync(evilDir, { recursive: true, force: true });
    }
  });

  it("escapes backslashes in project directory path", () => {
    const evilDir = fs.mkdtempSync(path.join(os.tmpdir(), "fwens-mcp-back\\slash-"));
    try {
      runInit(evilDir);
      const raw = fs.readFileSync(
        path.join(evilDir, ".fwens", "mcp-configs", "codex.toml"),
        "utf-8",
      );
      // Backslashes should be escaped
      expect(raw).toContain("\\\\");
    } finally {
      fs.rmSync(evilDir, { recursive: true, force: true });
    }
  });

  it("JSON configs handle special characters via JSON.stringify", () => {
    const evilDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fwens-mcp-json"test-'));
    try {
      runInit(evilDir);
      // JSON.stringify escapes quotes automatically — just verify it parses
      const claude = JSON.parse(
        fs.readFileSync(path.join(evilDir, ".fwens", "mcp-configs", "claude.json"), "utf-8"),
      );
      expect(claude.mcpServers.fwens.env.FWENS_PROJECT).toBe(evilDir);

      const opencode = JSON.parse(
        fs.readFileSync(path.join(evilDir, ".fwens", "mcp-configs", "opencode.json"), "utf-8"),
      );
      expect(opencode.mcp.fwens.environment.FWENS_PROJECT).toBe(evilDir);
    } finally {
      fs.rmSync(evilDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  it("re-running init produces identical configs", () => {
    const readAll = () => ({
      claude: fs.readFileSync(path.join(mcpDir, "claude.json"), "utf-8"),
      gemini: fs.readFileSync(path.join(mcpDir, "gemini.json"), "utf-8"),
      codex: fs.readFileSync(path.join(mcpDir, "codex.toml"), "utf-8"),
      opencode: fs.readFileSync(path.join(mcpDir, "opencode.json"), "utf-8"),
    });

    const before = readAll();
    runInit(tmpDir);
    const after = readAll();

    expect(after.claude).toBe(before.claude);
    expect(after.gemini).toBe(before.gemini);
    expect(after.codex).toBe(before.codex);
    expect(after.opencode).toBe(before.opencode);
  });
});
