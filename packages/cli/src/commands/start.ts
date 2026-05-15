import { spawnSync } from "node:child_process";

const PROMPT = "find fwens";

const AGENTS: Record<string, { cmd: string; args: string[] }> = {
  claude: { cmd: "claude", args: [PROMPT] },
  gemini: { cmd: "gemini", args: ["-i", PROMPT] },
  codex: { cmd: "codex", args: [PROMPT] },
  opencode: { cmd: "opencode", args: [] },
};

const AGENT_NAMES = Object.keys(AGENTS);

export function runStart(agent: string): void {
  const key = agent.toLowerCase();
  const config = AGENTS[key];

  if (!config) {
    console.error(`Unknown agent: "${agent}". Supported: ${AGENT_NAMES.join(", ")}`);
    process.exit(1);
  }

  // Replace this process with the agent CLI
  const result = spawnSync(config.cmd, config.args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      console.error(`"${config.cmd}" not found. Is ${agent} CLI installed and on your PATH?`);
    } else {
      console.error(`Failed to start ${agent}: ${err.message}`);
    }
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}
