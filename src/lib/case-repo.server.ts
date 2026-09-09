/**
 * 用例数据仓库（仅服务端）。
 *
 * 用例与用例版本不再直接依赖 Lovable Cloud（Supabase），而是通过下面的接口访问，
 * 由环境变量 CASE_DB_DRIVER 决定实际存储：
 *   - sqlite（默认）：本地 SQLite 文件，路径由 CASE_DB_FILE 指定，默认 .data/cases.db
 *   - mysql / postgres：预留，后续上线接入外部数据库
 *   - supabase：回退到平台自带数据库（无法使用本地文件的运行环境会自动走这里）
 */

export type CaseRow = {
  id: string;
  name: string;
  module: string;
  priority: string;
  tags: string[];
  author: string;
  status: string;
  source: string;
  start_url: string;
  steps: unknown[];
  script: string;
  version: number;
  agent_id: string | null;
  /** 参数化默认值：[{ name, value, note }]，步骤里用 ${name} 引用 */
  params: unknown[];
  /** 是否为模板用例（可一键派生新用例） */
  is_template: boolean;
  updated_at: string;
  created_at: string;
};

export type CaseVersionRow = {
  id: string;
  case_id: string;
  version: number;
  name: string;
  module: string;
  priority: string;
  start_url: string;
  steps: unknown[];
  script: string;
  params: unknown[];
  note: string;
  author: string;
  source: string;
  created_at: string;
};

export type CasePatch = Partial<Omit<CaseRow, "created_at">>;


export interface CaseRepo {
  readonly driver: string;
  listCases(limit?: number): Promise<CaseRow[]>;
  getCase(id: string): Promise<CaseRow | null>;
  findCaseByNameAndAgent(name: string, agentId: string): Promise<CaseRow | null>;
  insertCase(row: CasePatch & { name: string }): Promise<CaseRow>;
  updateCase(id: string, patch: CasePatch): Promise<void>;
  deleteCase(id: string): Promise<void>;
  listVersions(caseId: string, limit?: number): Promise<CaseVersionRow[]>;
  getVersion(caseId: string, version: number): Promise<CaseVersionRow | null>;
  insertVersion(row: Omit<CaseVersionRow, "id" | "created_at">): Promise<void>;
}

function nowIso() {
  return new Date().toISOString();
}

export function withCaseDefaults(row: CasePatch & { name: string }): Omit<CaseRow, "id"> {
  return {
    name: row.name,
    module: row.module ?? "未分类",
    priority: row.priority ?? "P1",
    tags: row.tags ?? [],
    author: row.author ?? "平台",
    status: row.status ?? "草稿",
    source: row.source ?? "平台编写",
    start_url: row.start_url ?? "",
    steps: row.steps ?? [],
    script: row.script ?? "",
    version: row.version ?? 1,
    agent_id: row.agent_id ?? null,
    params: row.params ?? [],
    is_template: row.is_template ?? false,
    updated_at: row.updated_at ?? nowIso(),
    created_at: nowIso(),
  };
}

/* ------------------------------ Supabase 驱动 ------------------------------ */

function supabaseRepo(): CaseRepo {
  const client = async () => {
    const { admin } = await import("./agent-db.server");
    return admin();
  };
  const norm = (r: Record<string, any> | null): CaseRow | null =>
    r
      ? ({
          ...r,
          tags: (r["tags"] as string[]) ?? [],
          steps: (r["steps"] as unknown[]) ?? [],
          params: (r["params"] as unknown[]) ?? [],
          is_template: Boolean(r["is_template"]),
        } as CaseRow)
      : null;


  return {
    driver: "supabase",
    async listCases(limit = 300) {
      const db = await client();
      const { data } = await db
        .from("test_cases")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(limit);
      return ((data ?? []) as Record<string, any>[]).map((r) => norm(r)!) as CaseRow[];
    },
    async getCase(id) {
      const db = await client();
      const { data } = await db.from("test_cases").select("*").eq("id", id).maybeSingle();
      return norm(data as Record<string, any> | null);
    },
    async findCaseByNameAndAgent(name, agentId) {
      const db = await client();
      const { data } = await db
        .from("test_cases")
        .select("*")
        .eq("name", name)
        .eq("agent_id", agentId)
        .maybeSingle();
      return norm(data as Record<string, any> | null);
    },
    async insertCase(row) {
      const db = await client();
      const { data, error } = await db
        .from("test_cases")
        .insert({ ...withCaseDefaults(row), ...(row.id ? { id: row.id } : {}) })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return norm(data as Record<string, any>)!;
    },
    async updateCase(id, patch) {
      const db = await client();
      const { error } = await db.from("test_cases").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    async deleteCase(id) {
      const db = await client();
      const { error } = await db.from("test_cases").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    async listVersions(caseId, limit = 50) {
      const db = await client();
      const { data } = await db
        .from("case_versions")
        .select("*")
        .eq("case_id", caseId)
        .order("version", { ascending: false })
        .limit(limit);
      return ((data ?? []) as Record<string, any>[]).map((r) => ({
        ...r,
        steps: (r["steps"] as unknown[]) ?? [],
      })) as CaseVersionRow[];
    },
    async getVersion(caseId, version) {
      const db = await client();
      const { data } = await db
        .from("case_versions")
        .select("*")
        .eq("case_id", caseId)
        .eq("version", version)
        .maybeSingle();
      if (!data) return null;
      return { ...(data as Record<string, any>), steps: (data as any).steps ?? [] } as CaseVersionRow;
    },
    async insertVersion(row) {
      const db = await client();
      const { error } = await db.from("case_versions").insert(row);
      if (error) throw new Error(error.message);
    },
  };
}

/* --------------------------------- 驱动选择 -------------------------------- */

let cached: CaseRepo | undefined;

export async function caseRepo(): Promise<CaseRepo> {
  if (cached) return cached;
  const driver = (process.env["CASE_DB_DRIVER"] ?? "sqlite").toLowerCase();

  if (driver === "supabase") {
    cached = supabaseRepo();
    return cached;
  }

  if (driver === "mysql" || driver === "postgres") {
    throw new Error(
      `用例库驱动 ${driver} 尚未接入，请配置 CASE_DB_DRIVER=sqlite 或 supabase，或补充该驱动实现`,
    );
  }

  let repo: CaseRepo;
  try {
    const { sqliteCaseRepo } = await import("./case-repo-sqlite.server");
    repo = await sqliteCaseRepo();
  } catch (err) {
    console.warn("[case-repo] 本地 SQLite 不可用，回退到平台数据库：", (err as Error).message);
    repo = supabaseRepo();
  }
  cached = repo;
  return repo;
}

