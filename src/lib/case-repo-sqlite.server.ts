/** 本地 SQLite 用例库（仅服务端，使用 Node 内置 node:sqlite） */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CasePatch, CaseRepo, CaseRow, CaseVersionRow } from "./case-repo.server";
import { withCaseDefaults } from "./case-repo.server";

type Stmt = { all: (...a: unknown[]) => any[]; get: (...a: unknown[]) => any; run: (...a: unknown[]) => any };
type Db = { exec: (sql: string) => void; prepare: (sql: string) => Stmt };

const CASE_COLS = [
  "id",
  "name",
  "module",
  "priority",
  "tags",
  "author",
  "status",
  "source",
  "start_url",
  "steps",
  "script",
  "version",
  "agent_id",
  "params",
  "is_template",
  "updated_at",
  "created_at",
] as const;

function json(v: unknown): string {
  return JSON.stringify(v ?? null);
}
function parse<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback;
  try {
    return (JSON.parse(v) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function toCase(r: Record<string, any> | undefined): CaseRow | null {
  if (!r) return null;
  return {
    ...(r as any),
    tags: parse<string[]>(r["tags"], []),
    steps: parse<unknown[]>(r["steps"], []),
    params: parse<unknown[]>(r["params"], []),
    is_template: Boolean(Number(r["is_template"] ?? 0)),
    version: Number(r["version"] ?? 1),
  } as CaseRow;
}

function toVersion(r: Record<string, any> | undefined): CaseVersionRow | null {
  if (!r) return null;
  return {
    ...(r as any),
    steps: parse<unknown[]>(r["steps"], []),
    params: parse<unknown[]>(r["params"], []),
    version: Number(r["version"] ?? 1),
  } as CaseVersionRow;
}

async function openDb(): Promise<Db> {
  // Node 22+ 使用内置 node:sqlite；Bun 运行时回退到 bun:sqlite
  let Ctor: (new (path: string) => Db) | undefined;
  for (const specifier of ["node:sqlite", "bun:sqlite"]) {
    try {
      const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, any>;
      Ctor = (mod["DatabaseSync"] ?? mod["Database"]) as new (path: string) => Db;
      if (Ctor) break;
    } catch {
      /* 尝试下一个实现 */
    }
  }
  if (!Ctor) throw new Error("当前运行环境没有可用的 SQLite 实现");
  const DatabaseSync = Ctor;
  const file = resolve(process.env["CASE_DB_FILE"] ?? ".data/cases.db");
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_cases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      module TEXT DEFAULT '未分类',
      priority TEXT DEFAULT 'P1',
      tags TEXT DEFAULT '[]',
      author TEXT DEFAULT '平台',
      status TEXT DEFAULT '草稿',
      source TEXT DEFAULT '平台编写',
      start_url TEXT DEFAULT '',
      steps TEXT DEFAULT '[]',
      script TEXT DEFAULT '',
      version INTEGER DEFAULT 1,
      agent_id TEXT,
      params TEXT DEFAULT '[]',
      is_template INTEGER DEFAULT 0,
      updated_at TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS case_versions (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT,
      module TEXT,
      priority TEXT,
      start_url TEXT,
      steps TEXT DEFAULT '[]',
      script TEXT DEFAULT '',
      params TEXT DEFAULT '[]',
      note TEXT DEFAULT '',
      author TEXT DEFAULT '',
      source TEXT DEFAULT '',
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_case_versions_case ON case_versions(case_id, version);
  `);
  // 老库补列（新增字段时不丢历史数据）
  for (const sql of [
    `ALTER TABLE test_cases ADD COLUMN params TEXT DEFAULT '[]'`,
    `ALTER TABLE test_cases ADD COLUMN is_template INTEGER DEFAULT 0`,
    `ALTER TABLE case_versions ADD COLUMN params TEXT DEFAULT '[]'`,
  ]) {
    try {
      db.exec(sql);
    } catch {
      /* 列已存在 */
    }
  }
  return db;
}

export async function sqliteCaseRepo(): Promise<CaseRepo> {
  const db = await openDb();

  return {
    driver: "sqlite",
    async listCases(limit = 300) {
      const rows = db
        .prepare(`SELECT * FROM test_cases ORDER BY updated_at DESC LIMIT ?`)
        .all(limit) as Record<string, any>[];
      return rows.map((r) => toCase(r)!) as CaseRow[];
    },
    async getCase(id) {
      return toCase(db.prepare(`SELECT * FROM test_cases WHERE id = ?`).get(id));
    },
    async findCaseByNameAndAgent(name, agentId) {
      return toCase(
        db.prepare(`SELECT * FROM test_cases WHERE name = ? AND agent_id = ?`).get(name, agentId),
      );
    },
    async insertCase(row) {
      const full = withCaseDefaults(row);
      const record: Record<string, unknown> = {
        id: row.id ?? crypto.randomUUID(),
        ...full,
        tags: json(full.tags),
        steps: json(full.steps),
        params: json(full.params),
        is_template: full.is_template ? 1 : 0,
      };
      db.prepare(
        `INSERT INTO test_cases (${CASE_COLS.join(",")}) VALUES (${CASE_COLS.map(() => "?").join(",")})`,
      ).run(...CASE_COLS.map((c) => record[c] ?? null));
      return { ...full, id: record["id"] as string } as CaseRow;
    },
    async updateCase(id: string, patch: CasePatch) {
      const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && k !== "id");
      if (!entries.length) return;
      const sets = entries.map(([k]) => `${k} = ?`).join(", ");
      const values = entries.map(([k, v]) => {
        if (k === "tags" || k === "steps" || k === "params") return json(v);
        if (typeof v === "boolean") return v ? 1 : 0;
        return v as unknown as string | number | null;
      });
      db.prepare(`UPDATE test_cases SET ${sets} WHERE id = ?`).run(...values, id);
    },
    async deleteCase(id) {
      db.prepare(`DELETE FROM case_versions WHERE case_id = ?`).run(id);
      db.prepare(`DELETE FROM test_cases WHERE id = ?`).run(id);
    },
    async listVersions(caseId, limit = 50) {
      const rows = db
        .prepare(`SELECT * FROM case_versions WHERE case_id = ? ORDER BY version DESC LIMIT ?`)
        .all(caseId, limit) as Record<string, any>[];
      return rows.map((r) => toVersion(r)!) as CaseVersionRow[];
    },
    async getVersion(caseId, version) {
      return toVersion(
        db.prepare(`SELECT * FROM case_versions WHERE case_id = ? AND version = ?`).get(caseId, version),
      );
    },
    async insertVersion(row) {
      db.prepare(
        `INSERT INTO case_versions (id, case_id, version, name, module, priority, start_url, steps, script, params, note, author, source, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        crypto.randomUUID(),
        row.case_id,
        row.version,
        row.name ?? "",
        row.module ?? "",
        row.priority ?? "P1",
        row.start_url ?? "",
        json(row.steps ?? []),
        row.script ?? "",
        json(row.params ?? []),
        row.note ?? "",
        row.author ?? "",
        row.source ?? "",
        new Date().toISOString(),
      );
    },
  };
}
