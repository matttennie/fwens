import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packagesDir = path.join(root, "packages");

for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  const dist = path.join(packagesDir, entry.name, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
}
