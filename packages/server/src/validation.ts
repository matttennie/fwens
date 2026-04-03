import path from "node:path";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUuid(value: string): string {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid UUID: "${value}"`);
  }
  return value;
}

export function validatePath(filePath: string, projectRoot: string): string {
  const resolved = path.resolve(projectRoot, filePath);
  const normalizedRoot = path.resolve(projectRoot);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error(`Path traversal detected: "${filePath}" resolves outside project root`);
  }
  return resolved;
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
