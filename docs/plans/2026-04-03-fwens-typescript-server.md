# fwens TypeScript Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the fwens MCP server (TypeScript) and CLI companion that enables five coding CLIs to coordinate through shared task, review, and messaging tools.

**Architecture:** Single MCP server over stdio, backed by SQLite (WAL mode). Each CLI spawns its own server process; shared state lives in `<project>/.fwens/fwens.db`. Session identity is per-process, tracked via UUID. CLI companion reads the same database for human inspection.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`, `vitest`, `commander`

**Note:** The Python FastMCP server is a separate plan (same spec, parallel implementation).

---

### Task 1: Project Scaffolding

**Files:**
- Create: `~/Desktop/AI/fwens/package.json`
- Create: `~/Desktop/AI/fwens/tsconfig.base.json`
- Create: `~/Desktop/AI/fwens/packages/server/package.json`
- Create: `~/Desktop/AI/fwens/packages/server/tsconfig.json`
- Create: `~/Desktop/AI/fwens/packages/cli/package.json`
- Create: `~/Desktop/AI/fwens/packages/cli/tsconfig.json`
- Create: `~/Desktop/AI/fwens/.gitignore`

- [ ] **Step 1: Create workspace root package.json**

```json
{
  "name": "fwens",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces",
    "clean": "rm -rf packages/*/dist"
  }
}
```

- [ ] **Step 2: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 3: Create server package.json**

```json
{
  "name": "@fwens/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "fwens-server": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "better-sqlite3": "^11.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 4: Create server tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Create CLI package.json**

```json
{
  "name": "@fwens/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "fwens": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "commander": "^13.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 6: Create CLI tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 7: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-wal
*.db-shm
.DS_Store
```

- [ ] **Step 8: Install dependencies**

Run: `cd ~/Desktop/AI/fwens && npm install`
Expected: Successful install, `node_modules/` created, lockfile generated.

- [ ] **Step 9: Verify build works with empty source**

Create placeholder files:
- `packages/server/src/index.ts` with content: `export {};`
- `packages/cli/src/index.ts` with content: `export {};`

Run: `cd ~/Desktop/AI/fwens && npm run build`
Expected: Successful compilation, `dist/` directories created.

- [ ] **Step 10: Commit**

```
feat: scaffold fwens workspace with server and cli packages
```

---

### Task 2: Validation Module

**Files:**
- Create: `packages/server/src/validation.ts`
- Create: `packages/server/src/__tests__/validation.test.ts`

- [ ] **Step 1: Write failing tests for validation**

```typescript
// packages/server/src/__tests__/validation.test.ts
import { describe, it, expect } from "vitest";
import {
  validateUuid,
  validatePath,
  validateStringLength,
  validateEnum,
} from "../validation.js";

describe("validateUuid", () => {
  it("accepts valid v4 UUID", () => {
    expect(() =>
      validateUuid("550e8400-e29b-41d4-a716-446655440000")
    ).not.toThrow();
  });

  it("rejects non-UUID string", () => {
    expect(() => validateUuid("not-a-uuid")).toThrow("Invalid UUID");
  });

  it("rejects empty string", () => {
    expect(() => validateUuid("")).toThrow("Invalid UUID");
  });

  it("rejects SQL injection attempt", () => {
    expect(() =>
      validateUuid("'; DROP TABLE tasks; --")
    ).toThrow("Invalid UUID");
  });
});

describe("validatePath", () => {
  it("accepts path within project root", () => {
    const result = validatePath("/project/src/main.ts", "/project");
    expect(result).toBe("/project/src/main.ts");
  });

  it("rejects path traversal with ..", () => {
    expect(() =>
      validatePath("/project/../etc/passwd", "/project")
    ).toThrow("Path traversal");
  });

  it("rejects absolute path outside project", () => {
    expect(() =>
      validatePath("/etc/passwd", "/project")
    ).toThrow("Path traversal");
  });

  it("normalizes path and checks", () => {
    expect(() =>
      validatePath("/project/src/../../etc/passwd", "/project")
    ).toThrow("Path traversal");
  });
});

describe("validateStringLength", () => {
  it("accepts string within limit", () => {
    expect(() => validateStringLength("hello", 100, "test")).not.toThrow();
  });

  it("rejects string exceeding limit", () => {
    expect(() => validateStringLength("a".repeat(101), 100, "test")).toThrow(
      "test exceeds maximum length of 100"
    );
  });
});

describe("validateEnum", () => {
  it("accepts valid enum value", () => {
    expect(() =>
      validateEnum("open", ["open", "in_progress", "done"], "status")
    ).not.toThrow();
  });

  it("rejects invalid enum value", () => {
    expect(() =>
      validateEnum("invalid", ["open", "in_progress", "done"], "status")
    ).toThrow('Invalid status: "invalid"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/AI/fwens/packages/server && npx vitest run src/__tests__/validation.test.ts`
Expected: FAIL — module `../validation.js` not found.

- [ ] **Step 3: Implement validation module**

```typescript
// packages/server/src/validation.ts
import path from "node:path";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export function validateStringLength(
  value: string,
  maxLength: number,
  fieldName: string
): string {
  if (value.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength}`);
  }
  return value;
}

export function validateEnum(
  value: string,
  allowed: readonly string[],
  fieldName: string
): string {
  if (!allowed.includes(value)) {
    throw new Error(
      `Invalid ${fieldName}: "${value}". Allowed: ${allowed.join(", ")}`
    );
  }
  return value;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Desktop/AI/fwens/packages/server && npx vitest run src/__tests__/validation.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```
feat: add input validation module with path traversal and SQL injection prevention
```

---

### Task 3: SQLite Schema and Database Layer

**Files:**
- Create: `packages/server/src/schema.ts`
- Create: `packages/server/src/db.ts`
- Create: `packages/server/src/__tests__/db.test.ts`

- [ ] **Step 1: Write failing tests for database initialization and session operations**

```typescript
// packages/server/src/__tests__/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import {
  createSession,
  getSession,
  listSessions,
  updateSessionStatus,
  updateLastSeen,
} from "../db.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
});

afterEach(() => {
  db.close();
});

describe("initializeDb", () => {
  it("creates all tables", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("sessions");
    expect(names).toContain("tasks");
    expect(names).toContain("reviews");
    expect(names).toContain("messages");
  });

  it("enables WAL mode", () => {
    const result = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(result.journal_mode).toBe("wal");
  });
});

describe("session operations", () => {
  it("creates and retrieves a session", () => {
    const id = createSession(db, "claude", "my-label");
    const session = getSession(db, id);
    expect(session).toBeDefined();
    expect(session!.agent_type).toBe("claude");
    expect(session!.label).toBe("my-label");
    expect(session!.status).toBe("active");
  });

  it("lists sessions filtered by status", () => {
    createSession(db, "claude");
    createSession(db, "gemini");
    const id3 = createSession(db, "codex");
    updateSessionStatus(db, id3, "disconnected");

    const active = listSessions(db, { status: "active" });
    expect(active).toHaveLength(2);

    const disconnected = listSessions(db, { status: "disconnected" });
    expect(disconnected).toHaveLength(1);
  });

  it("lists sessions filtered by agent_type", () => {
    createSession(db, "claude");
    createSession(db, "gemini");
    createSession(db, "gemini");

    const geminis = listSessions(db, { agent_type: "gemini" });
    expect(geminis).toHaveLength(2);
  });

  it("updates session status", () => {
    const id = createSession(db, "claude");
    updateSessionStatus(db, id, "busy");
    const session = getSession(db, id);
    expect(session!.status).toBe("busy");
  });

  it("updates last_seen_at", () => {
    const id = createSession(db, "claude");
    updateLastSeen(db, id);
    const session = getSession(db, id);
    expect(session!.last_seen_at).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/AI/fwens/packages/server && npx vitest run src/__tests__/db.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement schema.ts**

```typescript
// packages/server/src/schema.ts
import type Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  agent_type   TEXT NOT NULL,
  label        TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK(status IN ('active','idle','busy','disconnected')),
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  description  TEXT NOT NULL,
  context      TEXT,
  assigned_to  TEXT REFERENCES sessions(id),
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK(status IN ('open','in_progress','done','review_requested','reviewed')),
  created_by   TEXT REFERENCES sessions(id),
  artifacts    TEXT,
  summary      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  reviewer     TEXT REFERENCES sessions(id),
  verdict      TEXT CHECK(verdict IN ('pass','fail','needs_changes')),
  findings     TEXT,
  response     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  channel      TEXT NOT NULL DEFAULT 'general',
  author       TEXT REFERENCES sessions(id),
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_reviews_task ON reviews(task_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON messages(channel, created_at);
`;

export function initializeDb(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
}
```

- [ ] **Step 4: Implement db.ts with session operations**

```typescript
// packages/server/src/db.ts
import type Database from "better-sqlite3";
import crypto from "node:crypto";

export interface Session {
  id: string;
  agent_type: string;
  label: string | null;
  status: string;
  connected_at: string;
  last_seen_at: string;
}

export interface SessionFilter {
  status?: string;
  agent_type?: string;
}

export function createSession(
  db: Database.Database,
  agentType: string,
  label?: string
): string {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO sessions (id, agent_type, label) VALUES (?, ?, ?)"
  ).run(id, agentType, label ?? null);
  return id;
}

export function getSession(
  db: Database.Database,
  id: string
): Session | undefined {
  return db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(id) as Session | undefined;
}

export function listSessions(
  db: Database.Database,
  filter?: SessionFilter
): Session[] {
  let sql = "SELECT * FROM sessions WHERE 1=1";
  const params: unknown[] = [];

  if (filter?.status) {
    sql += " AND status = ?";
    params.push(filter.status);
  }
  if (filter?.agent_type) {
    sql += " AND agent_type = ?";
    params.push(filter.agent_type);
  }

  sql += " ORDER BY connected_at DESC";
  return db.prepare(sql).all(...params) as Session[];
}

export function updateSessionStatus(
  db: Database.Database,
  id: string,
  status: string
): void {
  db.prepare(
    "UPDATE sessions SET status = ?, last_seen_at = datetime('now') WHERE id = ?"
  ).run(status, id);
}

export function updateLastSeen(db: Database.Database, id: string): void {
  db.prepare(
    "UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?"
  ).run(id);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/Desktop/AI/fwens/packages/server && npx vitest run src/__tests__/db.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```
feat: add SQLite schema with WAL mode and session db operations
```

---

### Task 4: Task Database Operations

**Files:**
- Modify: `packages/server/src/db.ts`
- Create: `packages/server/src/__tests__/db-tasks.test.ts`

- [ ] **Step 1: Write failing tests for task operations**

```typescript
// packages/server/src/__tests__/db-tasks.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import { createSession } from "../db.js";
import {
  createTask,
  getTask,
  listTasks,
  claimTask,
  completeTask,
  requestReview,
} from "../db.js";

let db: Database.Database;
let sessionId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "claude");
});

afterEach(() => {
  db.close();
});

describe("task operations", () => {
  it("creates and retrieves a task", () => {
    const taskId = createTask(db, sessionId, {
      description: "Fix the auth bug",
      context: "See line 42 of auth.ts",
    });
    const task = getTask(db, taskId);
    expect(task).toBeDefined();
    expect(task!.description).toBe("Fix the auth bug");
    expect(task!.context).toBe("See line 42 of auth.ts");
    expect(task!.created_by).toBe(sessionId);
    expect(task!.status).toBe("open");
  });

  it("creates a task assigned to a specific session", () => {
    const geminiSession = createSession(db, "gemini");
    const taskId = createTask(db, sessionId, {
      description: "Review the PR",
      assigned_to: geminiSession,
    });
    const task = getTask(db, taskId);
    expect(task!.assigned_to).toBe(geminiSession);
  });

  it("lists tasks filtered by status", () => {
    createTask(db, sessionId, { description: "Task 1" });
    createTask(db, sessionId, { description: "Task 2" });
    const taskId3 = createTask(db, sessionId, { description: "Task 3" });
    claimTask(db, taskId3, sessionId);

    const open = listTasks(db, { status: "open" });
    expect(open).toHaveLength(2);

    const inProgress = listTasks(db, { status: "in_progress" });
    expect(inProgress).toHaveLength(1);
  });

  it("lists tasks filtered by assigned_to", () => {
    const geminiSession = createSession(db, "gemini");
    createTask(db, sessionId, {
      description: "Task 1",
      assigned_to: geminiSession,
    });
    createTask(db, sessionId, { description: "Task 2" });

    const geminiTasks = listTasks(db, { assigned_to: geminiSession });
    expect(geminiTasks).toHaveLength(1);
  });

  it("lists tasks filtered by mine (created_by)", () => {
    const other = createSession(db, "gemini");
    createTask(db, sessionId, { description: "My task" });
    createTask(db, other, { description: "Their task" });

    const mine = listTasks(db, { mine: sessionId });
    expect(mine).toHaveLength(1);
    expect(mine[0].description).toBe("My task");
  });

  it("claims a task and updates session to busy", () => {
    const taskId = createTask(db, sessionId, { description: "Do this" });
    const geminiSession = createSession(db, "gemini");
    claimTask(db, taskId, geminiSession);

    const task = getTask(db, taskId);
    expect(task!.status).toBe("in_progress");
    expect(task!.assigned_to).toBe(geminiSession);
  });

  it("throws when claiming already in-progress task", () => {
    const taskId = createTask(db, sessionId, { description: "Do this" });
    claimTask(db, taskId, sessionId);
    expect(() => claimTask(db, taskId, sessionId)).toThrow("Task is not open");
  });

  it("completes a task with summary and artifacts", () => {
    const taskId = createTask(db, sessionId, { description: "Do this" });
    claimTask(db, taskId, sessionId);
    completeTask(db, taskId, sessionId, {
      summary: "Fixed the bug",
      artifacts: ["/project/src/fix.ts"],
    });

    const task = getTask(db, taskId);
    expect(task!.status).toBe("done");
    expect(task!.summary).toBe("Fixed the bug");
    expect(JSON.parse(task!.artifacts!)).toEqual(["/project/src/fix.ts"]);
  });

  it("moves task to review_requested", () => {
    const taskId = createTask(db, sessionId, { description: "Do this" });
    claimTask(db, taskId, sessionId);
    completeTask(db, taskId, sessionId, { summary: "Done" });
    requestReview(db, taskId, sessionId);

    const task = getTask(db, taskId);
    expect(task!.status).toBe("review_requested");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/AI/fwens/packages/server && npx vitest run src/__tests__/db-tasks.test.ts`
Expected: FAIL — functions not exported from `../db.js`.

- [ ] **Step 3: Add task operations to db.ts**

Append to `packages/server/src/db.ts`:

```typescript
// --- Task types and operations ---

export interface Task {
  id: string;
  description: string;
  context: string | null;
  assigned_to: string | null;
  status: string;
  created_by: string | null;
  artifacts: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  description: string;
  context?: string;
  assigned_to?: string;
}

export interface TaskFilter {
  status?: string;
  assigned_to?: string;
  mine?: string;
}

export interface CompleteTaskInput {
  summary: string;
  artifacts?: string[];
}

export function createTask(
  db: Database.Database,
  sessionId: string,
  input: CreateTaskInput
): string {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO tasks (id, description, context, assigned_to, created_by) VALUES (?, ?, ?, ?, ?)"
  ).run(id, input.description, input.context ?? null, input.assigned_to ?? null, sessionId);
  return id;
}

export function getTask(
  db: Database.Database,
  id: string
): Task | undefined {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
}

export function listTasks(
  db: Database.Database,
  filter?: TaskFilter
): Task[] {
  let sql = "SELECT * FROM tasks WHERE 1=1";
  const params: unknown[] = [];

  if (filter?.status) {
    sql += " AND status = ?";
    params.push(filter.status);
  }
  if (filter?.assigned_to) {
    sql += " AND assigned_to = ?";
    params.push(filter.assigned_to);
  }
  if (filter?.mine) {
    sql += " AND created_by = ?";
    params.push(filter.mine);
  }

  sql += " ORDER BY created_at DESC";
  return db.prepare(sql).all(...params) as Task[];
}

export function claimTask(
  db: Database.Database,
  taskId: string,
  sessionId: string
): Task {
  const task = getTask(db, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status !== "open") throw new Error("Task is not open");

  db.prepare(
    "UPDATE tasks SET status = 'in_progress', assigned_to = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(sessionId, taskId);

  updateSessionStatus(db, sessionId, "busy");
  return getTask(db, taskId)!;
}

export function completeTask(
  db: Database.Database,
  taskId: string,
  sessionId: string,
  input: CompleteTaskInput
): Task {
  const task = getTask(db, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status !== "in_progress")
    throw new Error("Task is not in progress");

  const artifactsJson = input.artifacts ? JSON.stringify(input.artifacts) : null;

  db.prepare(
    "UPDATE tasks SET status = 'done', summary = ?, artifacts = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(input.summary, artifactsJson, taskId);

  updateSessionStatus(db, sessionId, "idle");
  return getTask(db, taskId)!;
}

export function requestReview(
  db: Database.Database,
  taskId: string,
  sessionId: string,
  rubric?: string
): string {
  const task = getTask(db, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status !== "done")
    throw new Error("Task must be done before requesting review");

  db.prepare(
    "UPDATE tasks SET status = 'review_requested', updated_at = datetime('now') WHERE id = ?"
  ).run(taskId);

  const reviewId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO reviews (id, task_id, findings) VALUES (?, ?, ?)"
  ).run(reviewId, taskId, rubric ? `Rubric: ${rubric}` : null);

  return reviewId;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Desktop/AI/fwens/packages/server && npx vitest run src/__tests__/db-tasks.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```
feat: add task db operations (create, list, claim, complete, request review)
```

---

### Task 5: Review and Message Database Operations

**Files:**
- Modify: `packages/server/src/db.ts`
- Create: `packages/server/src/__tests__/db-reviews.test.ts`
- Create: `packages/server/src/__tests__/db-messages.test.ts`

- [ ] **Step 1: Write failing tests for review operations**

```typescript
// packages/server/src/__tests__/db-reviews.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import {
  createSession,
  createTask,
  claimTask,
  completeTask,
  requestReview,
  getReview,
  listReviews,
  submitReview,
  respondToReview,
} from "../db.js";

let db: Database.Database;
let sessionId: string;
let reviewerSession: string;
let taskId: string;
let reviewId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "claude");
  reviewerSession = createSession(db, "gemini");
  taskId = createTask(db, sessionId, { description: "Build feature" });
  claimTask(db, taskId, sessionId);
  completeTask(db, taskId, sessionId, { summary: "Done" });
  reviewId = requestReview(db, taskId, sessionId);
});

afterEach(() => {
  db.close();
});

describe("review operations", () => {
  it("submits a review with verdict and findings", () => {
    submitReview(db, reviewId, reviewerSession, {
      verdict: "needs_changes",
      findings: "Missing error handling on line 42",
    });
    const review = getReview(db, reviewId);
    expect(review!.verdict).toBe("needs_changes");
    expect(review!.findings).toBe("Missing error handling on line 42");
    expect(review!.reviewer).toBe(reviewerSession);
  });

  it("responds to a review", () => {
    submitReview(db, reviewId, reviewerSession, {
      verdict: "needs_changes",
      findings: "Missing error handling",
    });
    respondToReview(db, reviewId, "Added try/catch block");
    const review = getReview(db, reviewId);
    expect(review!.response).toBe("Added try/catch block");
  });

  it("lists reviews by task_id", () => {
    const reviews = listReviews(db, { task_id: taskId });
    expect(reviews).toHaveLength(1);
  });

  it("lists pending reviews (no verdict yet)", () => {
    const pending = listReviews(db, { pending: true });
    expect(pending).toHaveLength(1);

    submitReview(db, reviewId, reviewerSession, {
      verdict: "pass",
      findings: "Looks good",
    });

    const afterSubmit = listReviews(db, { pending: true });
    expect(afterSubmit).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Write failing tests for message operations**

```typescript
// packages/server/src/__tests__/db-messages.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import { createSession, postMessage, readMessages } from "../db.js";

let db: Database.Database;
let sessionId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "claude");
});

afterEach(() => {
  db.close();
});

describe("message operations", () => {
  it("posts and reads a message", () => {
    postMessage(db, sessionId, { channel: "general", content: "Hello team" });
    const messages = readMessages(db);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Hello team");
    expect(messages[0].author).toBe(sessionId);
  });

  it("filters by channel", () => {
    postMessage(db, sessionId, { channel: "general", content: "General msg" });
    postMessage(db, sessionId, {
      channel: "blockers",
      content: "Blocked on X",
    });

    const general = readMessages(db, { channel: "general" });
    expect(general).toHaveLength(1);
    expect(general[0].content).toBe("General msg");
  });

  it("filters by since timestamp", () => {
    postMessage(db, sessionId, { channel: "general", content: "Old message" });
    const now = new Date().toISOString();
    postMessage(db, sessionId, { channel: "general", content: "New message" });

    const recent = readMessages(db, { since: now });
    expect(recent.length).toBeGreaterThanOrEqual(1);
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      postMessage(db, sessionId, {
        channel: "general",
        content: `msg ${i}`,
      });
    }
    const limited = readMessages(db, { limit: 3 });
    expect(limited).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd ~/Desktop/AI/fwens/packages/server && npx vitest run src/__tests__/db-reviews.test.ts src/__tests__/db-messages.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 4: Add review and message operations to db.ts**

Append to `packages/server/src/db.ts`:

```typescript
// --- Review types and operations ---

export interface Review {
  id: string;
  task_id: string;
  reviewer: string | null;
  verdict: string | null;
  findings: string | null;
  response: string | null;
  created_at: string;
}

export interface SubmitReviewInput {
  verdict: "pass" | "fail" | "needs_changes";
  findings: string;
}

export interface ReviewFilter {
  task_id?: string;
  pending?: boolean;
  mine?: string;
}

export function getReview(
  db: Database.Database,
  id: string
): Review | undefined {
  return db
    .prepare("SELECT * FROM reviews WHERE id = ?")
    .get(id) as Review | undefined;
}

export function listReviews(
  db: Database.Database,
  filter?: ReviewFilter
): Review[] {
  let sql = "SELECT * FROM reviews WHERE 1=1";
  const params: unknown[] = [];

  if (filter?.task_id) {
    sql += " AND task_id = ?";
    params.push(filter.task_id);
  }
  if (filter?.pending) {
    sql += " AND verdict IS NULL";
  }
  if (filter?.mine) {
    sql += " AND reviewer = ?";
    params.push(filter.mine);
  }

  sql += " ORDER BY created_at DESC";
  return db.prepare(sql).all(...params) as Review[];
}

export function submitReview(
  db: Database.Database,
  reviewId: string,
  sessionId: string,
  input: SubmitReviewInput
): Review {
  const review = getReview(db, reviewId);
  if (!review) throw new Error(`Review not found: ${reviewId}`);

  db.prepare(
    "UPDATE reviews SET reviewer = ?, verdict = ?, findings = ? WHERE id = ?"
  ).run(sessionId, input.verdict, input.findings, reviewId);

  db.prepare(
    "UPDATE tasks SET status = 'reviewed', updated_at = datetime('now') WHERE id = ?"
  ).run(review.task_id);

  return getReview(db, reviewId)!;
}

export function respondToReview(
  db: Database.Database,
  reviewId: string,
  response: string
): Review {
  const review = getReview(db, reviewId);
  if (!review) throw new Error(`Review not found: ${reviewId}`);

  db.prepare("UPDATE reviews SET response = ? WHERE id = ?").run(
    response,
    reviewId
  );

  return getReview(db, reviewId)!;
}

// --- Message types and operations ---

export interface Message {
  id: string;
  channel: string;
  author: string | null;
  content: string;
  created_at: string;
}

export interface PostMessageInput {
  channel: string;
  content: string;
}

export interface MessageFilter {
  channel?: string;
  since?: string;
  limit?: number;
}

export function postMessage(
  db: Database.Database,
  sessionId: string,
  input: PostMessageInput
): string {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO messages (id, channel, author, content) VALUES (?, ?, ?, ?)"
  ).run(id, input.channel, sessionId, input.content);
  return id;
}

export function readMessages(
  db: Database.Database,
  filter?: MessageFilter
): Message[] {
  let sql = "SELECT * FROM messages WHERE 1=1";
  const params: unknown[] = [];

  if (filter?.channel) {
    sql += " AND channel = ?";
    params.push(filter.channel);
  }
  if (filter?.since) {
    sql += " AND created_at > ?";
    params.push(filter.since);
  }

  sql += " ORDER BY created_at DESC";

  if (filter?.limit) {
    sql += " LIMIT ?";
    params.push(filter.limit);
  }

  return db.prepare(sql).all(...params) as Message[];
}

// --- Context aggregation ---

export interface TaskContext {
  task: Task;
  reviews: Review[];
  messages: Message[];
}

export function getTaskContext(
  db: Database.Database,
  taskId: string
): TaskContext {
  const task = getTask(db, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const reviews = listReviews(db, { task_id: taskId });
  const messages = readMessages(db, { channel: `task:${taskId}` });

  return { task, reviews, messages };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/Desktop/AI/fwens/packages/server && npx vitest run src/__tests__/db-reviews.test.ts src/__tests__/db-messages.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```
feat: add review, message, and context aggregation db operations
```

---

### Task 6: MCP Server Entry Point and Session Tools

**Files:**
- Create: `packages/server/src/tools/sessions.ts`
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/src/__tests__/tools-sessions.test.ts`

- [ ] **Step 1: Write failing tests for session tool handlers**

```typescript
// packages/server/src/__tests__/tools-sessions.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeDb } from "../schema.js";
import { createSession, getSession } from "../db.js";
import {
  handleWhoami,
  handleListSessions,
  handleSetLabel,
} from "../tools/sessions.js";

let db: Database.Database;
let sessionId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDb(db);
  sessionId = createSession(db, "claude", "lead");
});

afterEach(() => {
  db.close();
});

describe("whoami handler", () => {
  it("returns current session info", () => {
    const result = handleWhoami(db, sessionId);
    expect(result.id).toBe(sessionId);
    expect(result.agent_type).toBe("claude");
    expect(result.label).toBe("lead");
  });
});

describe("list_sessions handler", () => {
  it("returns all active sessions", () => {
    createSession(db, "gemini");
    const result = handleListSessions(db, {});
    expect(result).toHaveLength(2);
  });

  it("filters by agent_type", () => {
    createSession(db, "gemini");
    createSession(db, "gemini");
    const result = handleListSessions(db, { agent_type: "gemini" });
    expect(result).toHaveLength(2);
  });
});

describe("set_label handler", () => {
  it("updates the session label", () => {
    handleSetLabel(db, sessionId, "new-label");
    const session = getSession(db, sessionId);
    expect(session!.label).toBe("new-label");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/AI/fwens/packages/server && npx vitest run src/__tests__/tools-sessions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement session tool handlers**

```typescript
// packages/server/src/tools/sessions.ts
import type Database from "better-sqlite3";
import {
  getSession,
  listSessions,
  type Session,
  type SessionFilter,
} from "../db.js";

export function handleWhoami(
  db: Database.Database,
  sessionId: string
): Session {
  const session = getSession(db, sessionId);
  if (!session) throw new Error("Session not found");
  return session;
}

export function handleListSessions(
  db: Database.Database,
  filter: SessionFilter
): Session[] {
  return listSessions(db, filter);
}

export function handleSetLabel(
  db: Database.Database,
  sessionId: string,
  label: string
): Session {
  db.prepare("UPDATE sessions SET label = ? WHERE id = ?").run(
    label,
    sessionId
  );
  const session = getSession(db, sessionId);
  if (!session) throw new Error("Session not found");
  return session;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Desktop/AI/fwens/packages/server && npx vitest run src/__tests__/tools-sessions.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Implement the MCP server entry point**

Write `packages/server/src/index.ts` — this is the full server with all tool registrations. See the spec for the complete tool surface. Key architectural points:

- Reads `FWENS_PROJECT` (project root), `FWENS_AGENT_TYPE`, and `FWENS_LABEL` from environment
- Creates `.fwens/` directory and SQLite database on startup if needed
- Registers a session on startup, marks it `disconnected` on exit
- Calls `updateLastSeen()` (heartbeat) on every tool call
- All tool handlers delegate to `tools/*.ts` and `db.ts`
- Uses `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
- Uses `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
- Uses `zod` for input schemas in `registerTool()`
- Returns JSON via `{ content: [{ type: "text", text: JSON.stringify(data) }] }`
- Returns errors via `{ content: [{ type: "text", text: msg }], isError: true }`
- Cleanup on SIGINT, SIGTERM, and stdin end

Tool registrations (all using `server.registerTool(name, { description, inputSchema }, handler)`):

| Tool | Input Schema | Handler |
|------|-------------|---------|
| `whoami` | `z.object({})` | `handleWhoami(db, sessionId)` |
| `list_sessions` | `z.object({ status?, agent_type? })` | `handleListSessions(db, args)` |
| `set_label` | `z.object({ label: z.string().max(100) })` | `handleSetLabel(db, sessionId, args.label)` |
| `create_task` | `z.object({ description, context?, assigned_to? })` | `handleCreateTask(db, sessionId, args, projectRoot)` |
| `list_tasks` | `z.object({ status?, assigned_to?, mine? })` | `handleListTasks(db, sessionId, args)` |
| `claim_task` | `z.object({ task_id })` | `handleClaimTask(db, sessionId, args.task_id)` |
| `complete_task` | `z.object({ task_id, summary, artifacts? })` | `handleCompleteTask(db, sessionId, args, projectRoot)` |
| `request_review` | `z.object({ task_id, rubric? })` | `handleRequestReview(db, sessionId, args)` |
| `list_reviews` | `z.object({ task_id?, pending?, mine? })` | `handleListReviews(db, sessionId, args)` |
| `submit_review` | `z.object({ review_id, verdict, findings })` | `handleSubmitReview(db, sessionId, args)` |
| `respond_to_review` | `z.object({ review_id, response })` | `handleRespondToReview(db, args)` |
| `post_message` | `z.object({ channel, content })` | `handlePostMessage(db, sessionId, args)` |
| `read_messages` | `z.object({ channel?, since?, limit? })` | `handleReadMessages(db, args)` |
| `get_context` | `z.object({ task_id })` | `handleGetContext(db, args.task_id)` |
| `get_project_config` | `z.object({})` | reads `.fwens/config.json` or returns defaults |

- [ ] **Step 6: Build and verify compilation**

Run: `cd ~/Desktop/AI/fwens && npm run build`
Expected: Successful compilation, no errors.

- [ ] **Step 7: Commit**

```
feat: implement MCP server entry point with all tools and session lifecycle
```

---

### Task 7: Tool Handler Files (tasks, reviews, messages, context)

**Files:**
- Create: `packages/server/src/tools/tasks.ts`
- Create: `packages/server/src/tools/reviews.ts`
- Create: `packages/server/src/tools/messages.ts`
- Create: `packages/server/src/tools/context.ts`

These files extract handler logic from `index.ts` into focused, testable modules. Each function validates inputs, calls the db layer, and returns the result. The tool _registration_ stays in `index.ts`; the handler _logic_ lives here.

- [ ] **Step 1: Create tasks.ts**

```typescript
// packages/server/src/tools/tasks.ts
import type Database from "better-sqlite3";
import {
  createTask,
  listTasks,
  claimTask,
  completeTask,
  type Task,
} from "../db.js";
import { validateUuid, validatePath, validateStringLength } from "../validation.js";

const MAX_DESCRIPTION = 10_000;
const MAX_SUMMARY = 10_000;

export function handleCreateTask(
  db: Database.Database,
  sessionId: string,
  args: { description: string; context?: string; assigned_to?: string },
  projectRoot: string
): { task_id: string } {
  if (args.assigned_to) validateUuid(args.assigned_to);
  validateStringLength(args.description, MAX_DESCRIPTION, "description");
  if (args.context)
    validateStringLength(args.context, MAX_DESCRIPTION, "context");

  const taskId = createTask(db, sessionId, {
    description: args.description,
    context: args.context,
    assigned_to: args.assigned_to,
  });
  return { task_id: taskId };
}

export function handleListTasks(
  db: Database.Database,
  sessionId: string,
  args: { status?: string; assigned_to?: string; mine?: boolean }
): Task[] {
  return listTasks(db, {
    status: args.status,
    assigned_to: args.assigned_to,
    mine: args.mine ? sessionId : undefined,
  });
}

export function handleClaimTask(
  db: Database.Database,
  sessionId: string,
  taskId: string
): Task {
  validateUuid(taskId);
  return claimTask(db, taskId, sessionId);
}

export function handleCompleteTask(
  db: Database.Database,
  sessionId: string,
  args: { task_id: string; summary: string; artifacts?: string[] },
  projectRoot: string
): Task {
  validateUuid(args.task_id);
  validateStringLength(args.summary, MAX_SUMMARY, "summary");
  if (args.artifacts) {
    args.artifacts.forEach((p) => validatePath(p, projectRoot));
  }
  return completeTask(db, args.task_id, sessionId, {
    summary: args.summary,
    artifacts: args.artifacts,
  });
}
```

- [ ] **Step 2: Create reviews.ts**

```typescript
// packages/server/src/tools/reviews.ts
import type Database from "better-sqlite3";
import {
  requestReview,
  listReviews,
  submitReview,
  respondToReview,
  type Review,
} from "../db.js";
import { validateUuid, validateStringLength } from "../validation.js";

const MAX_DESCRIPTION = 10_000;
const MAX_FINDINGS = 50_000;

export function handleRequestReview(
  db: Database.Database,
  sessionId: string,
  args: { task_id: string; rubric?: string }
): { review_id: string } {
  validateUuid(args.task_id);
  if (args.rubric)
    validateStringLength(args.rubric, MAX_DESCRIPTION, "rubric");
  const reviewId = requestReview(db, args.task_id, sessionId, args.rubric);
  return { review_id: reviewId };
}

export function handleListReviews(
  db: Database.Database,
  sessionId: string,
  args: { task_id?: string; pending?: boolean; mine?: boolean }
): Review[] {
  return listReviews(db, {
    task_id: args.task_id,
    pending: args.pending,
    mine: args.mine ? sessionId : undefined,
  });
}

export function handleSubmitReview(
  db: Database.Database,
  sessionId: string,
  args: {
    review_id: string;
    verdict: "pass" | "fail" | "needs_changes";
    findings: string;
  }
): Review {
  validateUuid(args.review_id);
  validateStringLength(args.findings, MAX_FINDINGS, "findings");
  return submitReview(db, args.review_id, sessionId, {
    verdict: args.verdict,
    findings: args.findings,
  });
}

export function handleRespondToReview(
  db: Database.Database,
  args: { review_id: string; response: string }
): Review {
  validateUuid(args.review_id);
  validateStringLength(args.response, MAX_FINDINGS, "response");
  return respondToReview(db, args.review_id, args.response);
}
```

- [ ] **Step 3: Create messages.ts**

```typescript
// packages/server/src/tools/messages.ts
import type Database from "better-sqlite3";
import { postMessage, readMessages, type Message } from "../db.js";
import { validateStringLength } from "../validation.js";

const MAX_MESSAGE = 10_000;

export function handlePostMessage(
  db: Database.Database,
  sessionId: string,
  args: { channel: string; content: string }
): { message_id: string } {
  validateStringLength(args.content, MAX_MESSAGE, "content");
  validateStringLength(args.channel, 200, "channel");
  const messageId = postMessage(db, sessionId, {
    channel: args.channel,
    content: args.content,
  });
  return { message_id: messageId };
}

export function handleReadMessages(
  db: Database.Database,
  args: { channel?: string; since?: string; limit?: number }
): Message[] {
  return readMessages(db, {
    channel: args.channel,
    since: args.since,
    limit: args.limit,
  });
}
```

- [ ] **Step 4: Create context.ts**

```typescript
// packages/server/src/tools/context.ts
import type Database from "better-sqlite3";
import { getTaskContext, type TaskContext } from "../db.js";
import { validateUuid } from "../validation.js";

export function handleGetContext(
  db: Database.Database,
  taskId: string
): TaskContext {
  validateUuid(taskId);
  return getTaskContext(db, taskId);
}
```

- [ ] **Step 5: Update index.ts imports to use tool handler files**

Replace inline handler logic in each `registerTool` call to delegate to the handler functions. Keep tool registration in `index.ts`, handler logic in `tools/*.ts`.

- [ ] **Step 6: Build and run all tests**

Run: `cd ~/Desktop/AI/fwens && npm run build && cd packages/server && npx vitest run`
Expected: Build succeeds. All tests pass.

- [ ] **Step 7: Commit**

```
refactor: extract tool handler logic into focused files under tools/
```

---

### Task 8: CLI Companion — Init Command

**Files:**
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/init.ts`
- Create: `packages/cli/src/__tests__/init.test.ts`

- [ ] **Step 1: Write failing test for init command**

```typescript
// packages/cli/src/__tests__/init.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runInit } from "../commands/init.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fwens-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("fwens init", () => {
  it("creates .fwens directory", () => {
    runInit(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, ".fwens"))).toBe(true);
  });

  it("creates config.json", () => {
    runInit(tmpDir);
    const configPath = path.join(tmpDir, ".fwens", "config.json");
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.project_root).toBe(tmpDir);
  });

  it("creates SQLite database", () => {
    runInit(tmpDir);
    expect(
      fs.existsSync(path.join(tmpDir, ".fwens", "fwens.db"))
    ).toBe(true);
  });

  it("generates MCP config snippets", () => {
    runInit(tmpDir);
    const snippetsDir = path.join(tmpDir, ".fwens", "mcp-configs");
    expect(fs.existsSync(snippetsDir)).toBe(true);
    expect(
      fs.existsSync(path.join(snippetsDir, "claude.json"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(snippetsDir, "gemini.json"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(snippetsDir, "codex.toml"))
    ).toBe(true);
  });

  it("is idempotent", () => {
    runInit(tmpDir);
    runInit(tmpDir);
    expect(
      fs.existsSync(path.join(tmpDir, ".fwens", "config.json"))
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/AI/fwens/packages/cli && npx vitest run src/__tests__/init.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement init command**

`packages/cli/src/commands/init.ts` — creates `.fwens/` directory, `config.json`, SQLite database (with full schema), and MCP config snippets for all five CLIs (claude.json, gemini.json, codex.toml, opencode.json, aider.json). Each snippet sets the correct `FWENS_AGENT_TYPE` env var. Server path resolved relative to the fwens installation.

- [ ] **Step 4: Implement CLI entry point**

`packages/cli/src/index.ts` — uses `commander` to wire the `init` command:
```
fwens init [dir]  — Initialize fwens in project directory (defaults to cwd)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/Desktop/AI/fwens/packages/cli && npx vitest run src/__tests__/init.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```
feat: add fwens CLI with init command and MCP config snippet generation
```

---

### Task 9: CLI Companion — Status and Query Commands

**Files:**
- Create: `packages/cli/src/commands/open-db.ts`
- Create: `packages/cli/src/commands/status.ts`
- Create: `packages/cli/src/commands/tasks.ts`
- Create: `packages/cli/src/commands/reviews.ts`
- Create: `packages/cli/src/commands/messages.ts`
- Create: `packages/cli/src/commands/sessions.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Implement open-db helper**

`packages/cli/src/commands/open-db.ts` — opens `.fwens/fwens.db` in readonly mode, exits with error if not found.

- [ ] **Step 2: Implement status command**

`packages/cli/src/commands/status.ts` — queries task counts by status, pending review count, and active sessions. Prints formatted summary.

- [ ] **Step 3: Implement tasks command**

`packages/cli/src/commands/tasks.ts` — lists tasks with optional `--filter` flag. Joins sessions table to show assignee info.

- [ ] **Step 4: Implement reviews command**

`packages/cli/src/commands/reviews.ts` — lists reviews with optional `--pending` flag. Shows task description, verdict, and reviewer.

- [ ] **Step 5: Implement messages command**

`packages/cli/src/commands/messages.ts` — reads messages with optional `--channel` flag. Shows author, channel, timestamp, and content.

- [ ] **Step 6: Implement sessions command**

`packages/cli/src/commands/sessions.ts` — lists all sessions with status, agent type, label, and last seen time.

- [ ] **Step 7: Wire all commands into CLI entry point**

Update `packages/cli/src/index.ts` to register: `status`, `tasks`, `reviews`, `messages`, `sessions`.

- [ ] **Step 8: Build and verify**

Run: `cd ~/Desktop/AI/fwens && npm run build`
Expected: Successful compilation.

- [ ] **Step 9: Commit**

```
feat: add CLI status, tasks, reviews, messages, and sessions commands
```

---

### Task 10: Agent Instruction Templates

**Files:**
- Create: `templates/claude.md`
- Create: `templates/gemini.md`
- Create: `templates/codex.md`
- Create: `templates/opencode.md`
- Create: `templates/aider.md`

Each template contains identical content (agents are symmetric — no role assignment). The template covers:

1. **On Session Start** — call `whoami`, check `list_tasks` for assignments, check `list_reviews` for pending reviews
2. **Available Tools** — grouped by category (tasks, reviews, messages, context, sessions)
3. **Workflow patterns** — delegation (list_sessions then create_task with assigned_to), review (list_reviews then get_context then submit_review), completion (complete_task then request_review)

- [ ] **Step 1: Create all five templates**

Write identical content to `templates/claude.md`, `templates/gemini.md`, `templates/codex.md`, `templates/opencode.md`, `templates/aider.md`.

- [ ] **Step 2: Commit**

```
feat: add agent instruction templates for all five CLIs
```

---

### Task 11: Security Hardening Tests

**Files:**
- Create: `packages/server/src/__tests__/security.test.ts`

- [ ] **Step 1: Write security tests**

Test cases covering:

**SQL injection prevention:**
- Task description containing `'; DROP TABLE tasks; --` stored as literal text, table survives
- Message content with Bobby Tables payload stored safely
- UUID validation blocks SQL injection in ID parameters (`1; DROP TABLE`, `' OR '1'='1`, `1 UNION SELECT`)

**Path traversal prevention:**
- `../../etc/passwd` blocked
- Absolute path `/etc/shadow` outside project blocked
- Encoded traversal `..%2F..%2F` blocked
- Legitimate nested paths within project allowed

**Input length enforcement:**
- Strings exceeding 10K/50K limits rejected
- Strings at exactly the limit accepted

- [ ] **Step 2: Run security tests**

Run: `cd ~/Desktop/AI/fwens/packages/server && npx vitest run src/__tests__/security.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```
test: add security hardening tests for SQL injection, path traversal, and input limits
```

---

### Task 12: End-to-End Integration Test

**Files:**
- Create: `packages/server/src/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration test**

Full workflow test exercising:

1. Two agents connect (claude + gemini sessions)
2. Claude creates a task assigned to Gemini
3. Claude posts a message on the task channel
4. Gemini lists tasks, sees assignment
5. Gemini claims the task (session becomes busy)
6. Gemini completes the task with summary and artifacts
7. Gemini requests a review
8. Claude submits a review with verdict `needs_changes` and findings
9. Gemini responds to the review
10. `getTaskContext` returns the full picture (task + reviews + messages)

Second test: session disconnect and task reassignment — session disconnects before claiming, task remains open, second session claims it.

- [ ] **Step 2: Run integration test**

Run: `cd ~/Desktop/AI/fwens/packages/server && npx vitest run src/__tests__/integration.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Run complete test suite**

Run: `cd ~/Desktop/AI/fwens && npm run test`
Expected: All tests across all packages PASS.

- [ ] **Step 4: Final build**

Run: `cd ~/Desktop/AI/fwens && npm run build`
Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```
test: add end-to-end integration test for full delegation and review workflow
```

---

## Follow-up Plans (not in scope)

1. **Python FastMCP server** — Parallel implementation of same spec using FastMCP
2. **`fwens launch` command** — Convenience launcher that opens a CLI with the right env vars
3. **Session timeout/cleanup** — Background sweep marking stale sessions as disconnected
4. **MCP Inspector testing** — Manual verification with `npx @modelcontextprotocol/inspector`
