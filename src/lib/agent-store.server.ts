/**
 * 节点令牌存储（仅服务端）。
 *
 * 设备注册与令牌校验统一使用本地 SQLite（与用例库同一个文件，默认 .data/cases.db），
 * 不再依赖平台数据库的服务角色密钥。运行环境没有 SQLite 时回退到平台数据库。
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Stmt = { all: (...a: unknown[]) => any[]; get: (...a: unknown[]) => any; run: (...a: unknown[]) => any };
type Db = { exec: (sql: string) => void; prepare: (sql: string) => Stmt };

export interface AgentTokenStore {
  readonly driver: string;
  getToken(agentId: string): Promise<string>;
  setToken(agentId: string, token: string): Promise<void>;
  findByToken(token: string): Promise<string>;
}


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
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_tokens (
      agent_id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      created_at TEXT
    );
  `);
  return db;
}

function sqliteStore(db: Db): AgentTokenStore {
  return {
    driver: "sqlite",
    async getToken(agentId) {
      const row = db.prepare(`SELECT token FROM agent_tokens WHERE agent_id = ?`).get(agentId) as
        | { token?: string }
        | undefined;
      return row?.token ?? "";
    },
    async setToken(agentId, token) {
      db.prepare(
        `INSERT INTO agent_tokens (agent_id, token, created_at) VALUES (?, ?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET token = excluded.token`,
      ).run(agentId, token, new Date().toISOString());
    },
    async findByToken(token) {
      const row = db.prepare(`SELECT agent_id FROM agent_tokens WHERE token = ?`).get(token) as
        | { agent_id?: string }
        | undefined;
      return row?.agent_id ?? "";
    },
  };
}


function supabaseStore(): AgentTokenStore {
  const client = async () => {
    const { admin } = await import("./agent-db.server");
    return admin();
  };
  return {
    driver: "supabase",
    async getToken(agentId) {
      const db = await client();
      const { data } = await db.from("agent_tokens").select("token").eq("agent_id", agentId).maybeSingle();
      return ((data as { token?: string } | null)?.token as string | undefined) ?? "";
    },
    async setToken(agentId, token) {
      const db = await client();
      const { data } = await db.from("agent_tokens").select("token").eq("agent_id", agentId).maybeSingle();
      const { error } = data
        ? await db.from("agent_tokens").update({ token }).eq("agent_id", agentId)
        : await db.from("agent_tokens").insert({ agent_id: agentId, token });
      if (error) throw new Error(error.message);
    },
  };
}

let cached: AgentTokenStore | undefined;

export async function agentTokenStore(): Promise<AgentTokenStore> {
  if (cached) return cached;
  try {
    cached = sqliteStore(await openDb());
  } catch (err) {
    console.warn("[agent-store] 本地 SQLite 不可用，回退到平台数据库：", (err as Error).message);
    cached = supabaseStore();
  }
  return cached;
}

/** 读取节点令牌；本地没有时尝试从平台数据库迁移一次（兼容早期注册的设备） */
export async function readAgentToken(agentId: string): Promise<string> {
  const store = await agentTokenStore();
  const local = await store.getToken(agentId);
  if (local || store.driver !== "sqlite") return local;
  try {
    const legacy = await supabaseStore().getToken(agentId);
    if (legacy) {
      await store.setToken(agentId, legacy);
      return legacy;
    }
  } catch {
    /* 平台数据库不可用时忽略，按未注册处理 */
  }
  return "";
}

export async function writeAgentToken(agentId: string, token: string): Promise<void> {
  const store = await agentTokenStore();
  await store.setToken(agentId, token);
}
