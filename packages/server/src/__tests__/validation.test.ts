import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  validateUuid,
  validatePath,
  validateStringLength,
  validateEnum,
} from "../validation.js";

describe("validateUuid", () => {
  it("accepts a valid UUID", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(validateUuid(uuid)).toBe(uuid);
  });

  it("accepts an uppercase UUID", () => {
    const uuid = "550E8400-E29B-41D4-A716-446655440000";
    expect(validateUuid(uuid)).toBe(uuid);
  });

  it("rejects a non-UUID string", () => {
    expect(() => validateUuid("not-a-uuid")).toThrow('Invalid UUID: "not-a-uuid"');
  });

  it("rejects an empty string", () => {
    expect(() => validateUuid("")).toThrow('Invalid UUID: ""');
  });

  it("rejects a SQL injection attempt", () => {
    const sqlInjection = "'; DROP TABLE users; --";
    expect(() => validateUuid(sqlInjection)).toThrow(`Invalid UUID: "${sqlInjection}"`);
  });
});

describe("validatePath", () => {
  const projectRoot = "/home/user/project";

  it("accepts a valid path within root", () => {
    const result = validatePath("src/index.ts", projectRoot);
    expect(result).toBe(path.resolve(projectRoot, "src/index.ts"));
  });

  it("rejects .. traversal outside root", () => {
    expect(() => validatePath("../../etc/passwd", projectRoot)).toThrow(
      "Path traversal detected"
    );
  });

  it("rejects an absolute path outside root", () => {
    expect(() => validatePath("/etc/passwd", projectRoot)).toThrow(
      "Path traversal detected"
    );
  });

  it("rejects a normalized traversal (foo/../../..)", () => {
    expect(() => validatePath("foo/../../../etc/passwd", projectRoot)).toThrow(
      "Path traversal detected"
    );
  });

  it("accepts the project root itself", () => {
    const result = validatePath(".", projectRoot);
    expect(result).toBe(path.resolve(projectRoot));
  });
});

describe("validateStringLength", () => {
  it("accepts a string within the limit", () => {
    expect(validateStringLength("hello", 10, "name")).toBe("hello");
  });

  it("accepts a string exactly at the limit", () => {
    expect(validateStringLength("hello", 5, "name")).toBe("hello");
  });

  it("rejects a string exceeding the limit", () => {
    expect(() => validateStringLength("hello world", 5, "name")).toThrow(
      "name exceeds maximum length of 5"
    );
  });
});

describe("validateEnum", () => {
  const allowed = ["active", "inactive", "pending"] as const;

  it("accepts a valid value", () => {
    expect(validateEnum("active", allowed, "status")).toBe("active");
  });

  it("rejects an invalid value", () => {
    expect(() => validateEnum("deleted", allowed, "status")).toThrow(
      'Invalid status: "deleted". Allowed: active, inactive, pending'
    );
  });
});
