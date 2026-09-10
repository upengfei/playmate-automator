/**
 * 本地 SQLite 平台数据库（仅服务端）。
 *
 * 节点台账、任务队列、执行记录、日志、参数绑定、升级记录、发布清单全部保存在本地
 * SQLite 文件（默认 .data/cases.db，可用 CASE_DB_FILE 指定），因此 Agent 仪表盘、
 * 任务队列、进度看板在没有云端密钥、甚至完全离线时也能正常读写。
 *
 * 这里实现了平台代码用到的那一小部分「表 + 过滤 + 排序 + 写入」查询构建器，
 * 接口形状与原来的云端客户端保持一致，调用方无需改写。
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

type Stmt = { all: (...a: unknown[]) => any[]; get: (...a: unknown[]) => any; run: (...a: unknown[]) => any };
type Db = { exec: (sql: string) => void; prepare: (sql: string) => Stmt };

type Result<T = any> = { data: T; error: { message: string } | null };

interface TableDef {
  columns: string[];
  json: string[];
  bool: string[];
  /** 缺省值：插入时未提供且值为 undefined 时使用 */
  defaults: Record<string, () => unknown>;
}

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function def(
  columns: string[],
  opts: { json?: string[]; bool?: string[]; defaults?: Record<string, () => unknown> } = {},
): TableDef {
  return { columns, json: opts.json ?? [], bool: opts.bool ?? [], defaults: opts.defaults ?? {} };
}

const SCHEMA: Record<string, TableDef> = {
  agents: def(
    [
      "id",
      "name",
      "host",
      "ip",
      "os",
      "version",
      "capabilities",
      "status",
      "cpu",
      "memory",
      "concurrency",
      "total_runs",
      "last_heartbeat",
      "created_at",
    ],
    {
      json: ["capabilities"],
      defaults: { created_at: now, last_heartbeat: now, total_runs: () => 0, concurrency: () => 1 },
    },
  ),
  tasks: def(
    [
      "id",
      "name",
      "env",
      "browser",
      "agent_id",
      "concurrency",
      "retry",
      "status",
      "stage",
      "trigger",
      "created_at",
      "finished_at",
    ],
    { defaults: { id: uuid, created_at: now } },
  ),
  case_runs: def(
    [
      "id",
      "task_id",
      "case_id",
      "case_name",
      "case_version",
      "agent_id",
      "status",
      "step_index",
      "step_total",
      "duration_ms",
      "error",
      "steps",
      "attempt",
      "depends_on_case_id",
      "started_at",
      "finished_at",
    ],
    { json: ["steps"], defaults: { id: uuid, started_at: now, attempt: () => 1 } },
  ),
  task_logs: def(["id", "task_id", "level", "message", "at"], {
    defaults: { id: uuid, at: now, level: () => "info" },
  }),
  run_logs: def(["id", "run_id", "level", "message", "at"], {
    defaults: { id: uuid, at: now, level: () => "info" },
  }),
  param_bindings: def(["id", "scope", "scope_key", "name", "value", "note", "updated_at"], {
    defaults: { id: uuid, updated_at: now },
  }),
  platform_settings: def(
    [
      "id",
      "platform_name",
      "min_agent_version",
      "heartbeat_timeout_sec",
      "default_retry",
      "default_concurrency",
      "keep_report_days",
      "notify_email",
      "notify_on_failure",
      "auto_dispatch",
      "video_on_failure",
      "trace_mode",
      "auto_upgrade",
      "update_channel",
      "updated_at",
    ],
    {
      bool: ["notify_on_failure", "auto_dispatch", "video_on_failure", "auto_upgrade"],
      defaults: { updated_at: now },
    },
  ),
  agent_upgrades: def(
    [
      "id",
      "agent_id",
      "agent_name",
      "from_version",
      "to_version",
      "channel",
      "trigger",
      "stage",
      "progress",
      "status",
      "logs",
      "report",
      "started_at",
      "finished_at",
    ],
    { json: ["logs", "report"], defaults: { id: uuid, started_at: now, progress: () => 0 } },
  ),
  agent_releases: def(
    [
      "id",
      "version",
      "channel",
      "published_at",
      "min_supported",
      "notes",
      "artifacts",
      "is_current",
      "created_at",
    ],
    { json: ["notes", "artifacts"], bool: ["is_current"], defaults: { id: uuid, created_at: now } },
  ),
  agent_tokens: def(["agent_id", "token", "created_at"], { defaults: { created_at: now } }),
  /** AI 页面元素定位：平台下发抓取指令，客户端用本机 Playwright 回传元素清单与页面截图 */
  agent_inspects: def(
    [
      "id",
      "agent_id",
      "url",
      "url_key",
      "description",
      "status",
      "elements",
      "screenshot",
      "viewport",
      "error",
      "attempt",
      "fail_kind",
      "fail_detail",
      "created_at",
      "finished_at",
    ],
    { json: ["elements", "viewport"], defaults: { id: uuid, created_at: now, status: () => "排队中" } },
  ),
  /** 上传的模型清单文件：完整保存原文，可随时按原文重新解析 */
  ai_model_files: def(
    ["id", "provider_id", "filename", "format", "content", "size", "model_count", "created_at"],
    { defaults: { id: uuid, created_at: now } },
  ),
  /** AI 模型接入配置：内置 Lovable AI / OpenAI 兼容 / Anthropic 兼容 / 自定义 */
  ai_settings: def(
    [
      "id",
      "mode",
      "base_url",
      "api_key",
      "models",
      "default_model",
      "inspect_cache_minutes",
      "inspect_screenshot",
      "updated_at",
    ],
    { json: ["models"], bool: ["inspect_screenshot"], defaults: { updated_at: now } },
  ),
  /** 多套 AI 模型配置：可保存任意条，勾选其中一条作为当前使用 */
  ai_providers: def(
    [
      "id",
      "name",
      "mode",
      "base_url",
      "api_key",
      "models",
      "default_model",
      "is_active",
      "note",
      "created_at",
      "updated_at",
    ],
    {
      json: ["models"],
      bool: ["is_active"],
      defaults: { id: uuid, created_at: now, updated_at: now, is_active: () => false },
    },
  ),
};




const DDL = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, name TEXT, host TEXT, ip TEXT, os TEXT, version TEXT,
  capabilities TEXT DEFAULT '[]', status TEXT DEFAULT '离线', cpu INTEGER DEFAULT 0,
  memory INTEGER DEFAULT 0, concurrency INTEGER DEFAULT 1, total_runs INTEGER DEFAULT 0,
  last_heartbeat TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, name TEXT, env TEXT, browser TEXT, agent_id TEXT,
  concurrency INTEGER DEFAULT 1, retry INTEGER DEFAULT 0, status TEXT, stage TEXT,
  "trigger" TEXT, created_at TEXT, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS case_runs (
  id TEXT PRIMARY KEY, task_id TEXT, case_id TEXT, case_name TEXT, case_version INTEGER,
  agent_id TEXT, status TEXT, step_index INTEGER DEFAULT 0, step_total INTEGER DEFAULT 0,
  duration_ms INTEGER, error TEXT, steps TEXT DEFAULT '[]', attempt INTEGER DEFAULT 1,
  depends_on_case_id TEXT, started_at TEXT, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_task ON case_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON case_runs(agent_id, status);
CREATE TABLE IF NOT EXISTS task_logs (
  id TEXT PRIMARY KEY, task_id TEXT, level TEXT, message TEXT, at TEXT
);
CREATE TABLE IF NOT EXISTS run_logs (
  id TEXT PRIMARY KEY, run_id TEXT, level TEXT, message TEXT, at TEXT
);
CREATE TABLE IF NOT EXISTS param_bindings (
  id TEXT PRIMARY KEY, scope TEXT, scope_key TEXT, name TEXT, value TEXT, note TEXT, updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_key ON param_bindings(scope, scope_key, name);
CREATE TABLE IF NOT EXISTS platform_settings (
  id INTEGER PRIMARY KEY, platform_name TEXT, min_agent_version TEXT,
  heartbeat_timeout_sec INTEGER, default_retry INTEGER, default_concurrency INTEGER,
  keep_report_days INTEGER, notify_email TEXT, notify_on_failure INTEGER,
  auto_dispatch INTEGER, video_on_failure INTEGER, trace_mode TEXT,
  auto_upgrade INTEGER, update_channel TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_upgrades (
  id TEXT PRIMARY KEY, agent_id TEXT, agent_name TEXT, from_version TEXT, to_version TEXT,
  channel TEXT, "trigger" TEXT, stage TEXT, progress INTEGER DEFAULT 0, status TEXT,
  logs TEXT DEFAULT '[]', report TEXT, started_at TEXT, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_releases (
  id TEXT PRIMARY KEY, version TEXT, channel TEXT, published_at TEXT, min_supported TEXT,
  notes TEXT DEFAULT '[]', artifacts TEXT DEFAULT '[]', is_current INTEGER DEFAULT 0, created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_releases_version ON agent_releases(version);
CREATE TABLE IF NOT EXISTS agent_tokens (
  agent_id TEXT PRIMARY KEY, token TEXT NOT NULL, created_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_inspects (
  id TEXT PRIMARY KEY, agent_id TEXT, url TEXT, url_key TEXT, description TEXT, status TEXT,
  elements TEXT DEFAULT '[]', screenshot TEXT, viewport TEXT, error TEXT, created_at TEXT, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inspects_agent ON agent_inspects(agent_id, status);
CREATE TABLE IF NOT EXISTS ai_settings (
  id INTEGER PRIMARY KEY, mode TEXT DEFAULT 'lovable', base_url TEXT, api_key TEXT,
  models TEXT DEFAULT '[]', default_model TEXT,
  inspect_cache_minutes INTEGER DEFAULT 10, inspect_screenshot INTEGER DEFAULT 1, updated_at TEXT
);
INSERT INTO ai_settings (id, mode, base_url, api_key, models, default_model, updated_at)
SELECT 1, 'lovable', '', '', '[]', '', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM ai_settings WHERE id = 1);
CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY, name TEXT, mode TEXT DEFAULT 'openai', base_url TEXT, api_key TEXT,
  models TEXT DEFAULT '[]', default_model TEXT, is_active INTEGER DEFAULT 0, note TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_providers_active ON ai_providers(is_active);
CREATE TABLE IF NOT EXISTS ai_model_files (
  id TEXT PRIMARY KEY, provider_id TEXT, filename TEXT, format TEXT, content TEXT,
  size INTEGER DEFAULT 0, model_count INTEGER DEFAULT 0, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_model_files_provider ON ai_model_files(provider_id);
`;


/** 老库补列：每条单独执行，已存在时忽略错误 */
const MIGRATIONS = [
  `ALTER TABLE agent_inspects ADD COLUMN url_key TEXT`,
  `ALTER TABLE agent_inspects ADD COLUMN screenshot TEXT`,
  `ALTER TABLE agent_inspects ADD COLUMN viewport TEXT`,
  `ALTER TABLE ai_settings ADD COLUMN inspect_cache_minutes INTEGER DEFAULT 10`,
  `ALTER TABLE ai_settings ADD COLUMN inspect_screenshot INTEGER DEFAULT 1`,
  `CREATE INDEX IF NOT EXISTS idx_inspects_url ON agent_inspects(url_key, status, finished_at)`,
  `ALTER TABLE agent_inspects ADD COLUMN attempt INTEGER DEFAULT 0`,
  `ALTER TABLE agent_inspects ADD COLUMN fail_kind TEXT`,
  `ALTER TABLE agent_inspects ADD COLUMN fail_detail TEXT`,
];




const SETTINGS_SEED = `
INSERT INTO platform_settings (id, platform_name, min_agent_version, heartbeat_timeout_sec,
  default_retry, default_concurrency, keep_report_days, notify_email, notify_on_failure,
  auto_dispatch, video_on_failure, trace_mode, auto_upgrade, update_channel, updated_at)
SELECT 1, 'PlayFlow 自动化测试平台', '1.8.0', 60, 1, 2, 30, '', 1, 1, 1, '仅失败', 1, '稳定版', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM platform_settings WHERE id = 1);
`;

let dbPromise: Promise<Db> | undefined;

async function openDb(): Promise<Db> {
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
  const file = resolve(process.env["CASE_DB_FILE"] ?? ".data/cases.db");
  mkdirSync(dirname(file), { recursive: true });
  const db = new Ctor(file);
  db.exec(DDL);
  db.exec(SETTINGS_SEED);
  for (const sql of MIGRATIONS) {
    try {
      db.exec(sql);
    } catch {
      /* 列或索引已存在 */
    }
  }

  return db;
}

function database(): Promise<Db> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

const q = (col: string) => `"${col}"`;

function encode(table: TableDef, col: string, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (table.json.includes(col)) return JSON.stringify(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") return JSON.stringify(value);
  return value as string | number;
}

function decodeRow(table: TableDef, row: Record<string, any> | undefined): Record<string, any> | null {
  if (!row) return null;
  const out: Record<string, any> = { ...row };
  for (const col of table.json) {
    if (typeof out[col] === "string") {
      try {
        out[col] = JSON.parse(out[col]);
      } catch {
        out[col] = null;
      }
    }
  }
  for (const col of table.bool) if (out[col] !== null && out[col] !== undefined) out[col] = Boolean(Number(out[col]));
  return out;
}

type Filter = { col: string; op: "eq" | "neq" | "in" | "gte" | "lte"; value: unknown };

class Query<T = any> implements PromiseLike<Result<T>> {
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private limitN?: number;
  private singleMode?: "one" | "maybe";
  private returning = false;

  constructor(
    private readonly table: string,
    private readonly def: TableDef,
    private readonly op: "select" | "insert" | "update" | "upsert" | "delete",
    private readonly payload?: any,
    private readonly conflict?: string[],
  ) {}

  select(_cols?: string): this {
    this.returning = true;
    return this;
  }
  eq(col: string, value: unknown): this {
    this.filters.push({ col, op: "eq", value });
    return this;
  }
  neq(col: string, value: unknown): this {
    this.filters.push({ col, op: "neq", value });
    return this;
  }
  in(col: string, values: unknown[]): this {
    this.filters.push({ col, op: "in", value: values });
    return this;
  }
  gte(col: string, value: unknown): this {
    this.filters.push({ col, op: "gte", value });
    return this;
  }
  lte(col: string, value: unknown): this {
    this.filters.push({ col, op: "lte", value });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  maybeSingle(): this {
    this.singleMode = "maybe";
    return this;
  }
  single(): this {
    this.singleMode = "one";
    return this;
  }

  private where(): { sql: string; args: unknown[] } {
    if (!this.filters.length) return { sql: "", args: [] };
    const parts: string[] = [];
    const args: unknown[] = [];
    for (const f of this.filters) {
      if (f.op === "in") {
        const list = (f.value as unknown[]) ?? [];
        if (!list.length) {
          parts.push("0 = 1");
          continue;
        }
        parts.push(`${q(f.col)} IN (${list.map(() => "?").join(",")})`);
        args.push(...list.map((v) => encode(this.def, f.col, v)));
        continue;
      }
      const opSql = { eq: "=", neq: "!=", gte: ">=", lte: "<=" }[f.op];
      parts.push(`${q(f.col)} ${opSql} ?`);
      args.push(encode(this.def, f.col, f.value));
    }
    return { sql: ` WHERE ${parts.join(" AND ")}`, args };
  }

  private tail(): string {
    const order = this.orders.length
      ? ` ORDER BY ${this.orders.map((o) => `${q(o.col)} ${o.asc ? "ASC" : "DESC"}`).join(", ")}`
      : "";
    const limit = this.limitN !== undefined ? ` LIMIT ${Math.max(0, Math.floor(this.limitN))}` : "";
    return order + limit;
  }

  private shape(rows: Record<string, any>[]): any {
    const mapped = rows.map((r) => decodeRow(this.def, r));
    if (!this.singleMode) return mapped;
    return mapped[0] ?? null;
  }

  private fillDefaults(row: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = { ...row };
    for (const [col, gen] of Object.entries(this.def.defaults)) {
      if (out[col] === undefined || out[col] === null) out[col] = gen();
    }
    return out;
  }

  private async exec(db: Db): Promise<Result<T>> {
    const { sql: whereSql, args: whereArgs } = this.where();

    if (this.op === "select") {
      const rows = db.prepare(`SELECT * FROM ${q(this.table)}${whereSql}${this.tail()}`).all(...whereArgs);
      if (this.singleMode === "one" && !rows.length) return { data: null as T, error: { message: "没有找到记录" } };
      return { data: this.shape(rows) as T, error: null };
    }

    if (this.op === "delete") {
      db.prepare(`DELETE FROM ${q(this.table)}${whereSql}`).run(...whereArgs);
      return { data: null as T, error: null };
    }

    if (this.op === "update") {
      const entries = Object.entries(this.payload as Record<string, unknown>).filter(
        ([k, v]) => v !== undefined && this.def.columns.includes(k),
      );
      if (entries.length) {
        const sets = entries.map(([k]) => `${q(k)} = ?`).join(", ");
        const args = entries.map(([k, v]) => encode(this.def, k, v));
        db.prepare(`UPDATE ${q(this.table)} SET ${sets}${whereSql}`).run(...args, ...whereArgs);
      }
      if (!this.returning) return { data: null as T, error: null };
      const rows = db.prepare(`SELECT * FROM ${q(this.table)}${whereSql}${this.tail()}`).all(...whereArgs);
      return { data: this.shape(rows) as T, error: null };
    }

    // insert / upsert
    const input = Array.isArray(this.payload) ? this.payload : [this.payload];
    const written: Record<string, any>[] = [];
    for (const raw of input as Record<string, any>[]) {
      const row = this.fillDefaults(raw);
      const cols = this.def.columns.filter((c) => row[c] !== undefined);
      const args = cols.map((c) => encode(this.def, c, row[c]));
      let sql = `INSERT INTO ${q(this.table)} (${cols.map(q).join(",")}) VALUES (${cols
        .map(() => "?")
        .join(",")})`;
      if (this.op === "upsert") {
        const keys = this.conflict?.length ? this.conflict : ["id"];
        const updates = cols.filter((c) => !keys.includes(c));
        sql += ` ON CONFLICT(${keys.map(q).join(",")}) DO ${
          updates.length ? `UPDATE SET ${updates.map((c) => `${q(c)} = excluded.${q(c)}`).join(", ")}` : "NOTHING"
        }`;
      }
      db.prepare(sql).run(...args);
      written.push(row);
    }
    if (!this.returning) return { data: null as T, error: null };
    const key = this.def.columns.includes("id") ? "id" : this.def.columns[0]!;
    const ids = written.map((r) => r[key]).filter((v) => v !== undefined && v !== null);
    const rows = ids.length
      ? db
          .prepare(`SELECT * FROM ${q(this.table)} WHERE ${q(key)} IN (${ids.map(() => "?").join(",")})`)
          .all(...ids.map((v) => encode(this.def, key, v)))
      : [];
    return { data: this.shape(rows) as T, error: null };
  }

  private async run(): Promise<Result<T>> {
    try {
      return await this.exec(await database());
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      console.warn(`[local-db] ${this.op} ${this.table} 失败：${message}`);
      return { data: (this.singleMode ? null : []) as T, error: { message } };
    }
  }

  then<A = Result<T>, B = never>(
    onfulfilled?: ((value: Result<T>) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }
}

function table(name: string) {
  const d = SCHEMA[name];
  if (!d) throw new Error(`本地数据库没有定义表 ${name}`);
  return {
    select: (cols?: string) => new Query(name, d, "select").select(cols),
    insert: (rows: unknown) => new Query(name, d, "insert", rows),
    upsert: (rows: unknown, opts?: { onConflict?: string }) =>
      new Query(
        name,
        d,
        "upsert",
        rows,
        opts?.onConflict ? opts.onConflict.split(",").map((s) => s.trim()) : undefined,
      ),
    update: (patch: unknown) => new Query(name, d, "update", patch),
    delete: () => new Query(name, d, "delete"),
  };
}

/** 本地 SQLite 平台数据客户端（接口形状与云端客户端兼容） */
export function localClient(): SupabaseClient {
  return { from: (name: string) => table(name) } as unknown as SupabaseClient;
}
