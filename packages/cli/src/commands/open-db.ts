import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export function openDb(projectDir: string): InstanceType<typeof Database> {
  const dbPath = path.join(projectDir, ".fwens", "fwens.db");
  if (!fs.existsSync(dbPath)) {
    console.error("No .fwens/fwens.db found. Run 'fwens init' first.");
    process.exit(1);
  }
  return new Database(dbPath, { readonly: true });
}
