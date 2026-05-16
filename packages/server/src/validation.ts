import fs from "node:fs";
import path from "node:path";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUuid(value: string): string {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid UUID: "${value}"`);
  }
  return value;
}

// Symlink-safe: dereferences symlinks via fs.realpathSync on both the project
// root and the input path before the prefix check. A symlink inside the
// project that points outside no longer satisfies the confinement check.
// For paths whose leaf does not yet exist (artifact paths to be written), we
// walk up to the deepest existing ancestor, realpath it, then append the
// remainder. Root and target are canonicalized through the same helper so
// missing-prefix mismatches never produce false-positive traversal errors.
export function validatePath(filePath: string, projectRoot: string): string {
  const realRoot = canonicalize(path.resolve(projectRoot));
  const realResolved = canonicalize(path.resolve(projectRoot, filePath));

  if (!realResolved.startsWith(realRoot + path.sep) && realResolved !== realRoot) {
    throw new Error(`Path traversal detected: "${filePath}" resolves outside project root`);
  }
  return realResolved;
}

function canonicalize(absolutePath: string): string {
  let probe = absolutePath;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return absolutePath;
    probe = parent;
  }
  const realProbe = fs.realpathSync(probe);
  const remainder = path.relative(probe, absolutePath);
  return remainder ? path.join(realProbe, remainder) : realProbe;
}

export function validateStringLength(value: string, maxLength: number, fieldName: string): string {
  if (value.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength}`);
  }
  return value;
}

export function validateEnum(value: string, allowed: readonly string[], fieldName: string): string {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${fieldName}: "${value}". Allowed: ${allowed.join(", ")}`);
  }
  return value;
}
