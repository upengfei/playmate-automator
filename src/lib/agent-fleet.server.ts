/**
 * 桌面 Agent 发布清单（真实数据）：发布记录存放在数据库 agent_releases 表，
 * 由 CI 发布安装包后写入。仅当数据库尚无任何发布记录时，才回退到内置的初始版本，
 * 保证平台在空库时也能正常显示与校验版本。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface ReleaseArtifact {
  platform: "win" | "darwin" | "linux";
  file: string;
  sizeMB: number;
  sha256: string;
  url: string;
}

export interface Release {
  version: string;
  channel: string;
  publishedAt: string;
  minSupported: string;
  notes: string[];
  artifacts: ReleaseArtifact[];
}

/**
 * 安装包下载地址前缀。配置 AGENT_DOWNLOAD_BASE（例如 CI 发布到 GitHub Release 后的
 * https://github.com/<owner>/<repo>/releases/latest/download/）时，版本接口与下载页
 * 直接返回公开地址；否则回退到站点内 /downloads/ 路径。
 */
export const DEFAULT_DOWNLOAD_BASE =
  "https://github.com/upengfei/playmate-automator/releases/latest/download";

export function artifactUrl(file: string): string {
  const base = process.env["AGENT_DOWNLOAD_BASE"] || DEFAULT_DOWNLOAD_BASE;
  return `${base.replace(/\/+$/, "")}/${file}`;
}

/** 空库回退：项目首个正式版本 */
const FALLBACK_RELEASE: Release = {
  version: "1.8.2",
  channel: "稳定版",
  publishedAt: "2026-09-05",
  minSupported: "1.6.0",
  notes: [
    "内置 Playwright 执行内核，录制器支持 Shadow DOM 选择器",
    "任务下发通道支持断线后自动补传执行日志",
    "支持平台推送升级与升级结果回传",
  ],
  artifacts: [
    {
      platform: "win",
      file: "PlayFlowAgent-1.8.2-win-x64.zip",
      sizeMB: 135,
      sha256: "3aae7899c54411b6b6a61b10efbed815e333128645abcfdadfe8cef28ab608c0",
      url: artifactUrl("PlayFlowAgent-1.8.2-win-x64.zip"),
    },
    {
      platform: "darwin",
      file: "PlayFlowAgent-1.8.2-darwin-arm64.zip",
      sizeMB: 325,
      sha256: "9aa9933e4d8422787ff5563e1fd5e2aec92422b56e96bf80449d69fdd3bd95e8",
      url: artifactUrl("PlayFlowAgent-1.8.2-darwin-arm64.zip"),
    },
    {
      platform: "linux",
      file: "PlayFlowAgent-1.8.2-linux-x64.tar.gz",
      sizeMB: 110,
      sha256: "947d136eb25fa7c2a0ae110e421092980f97e465c3c07e4ee79782a3c3bde0ab",
      url: artifactUrl("PlayFlowAgent-1.8.2-linux-x64.tar.gz"),
    },
  ],
};

function client(): SupabaseClient {
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function mapRow(row: Record<string, unknown>): Release {
  const artifacts = (Array.isArray(row["artifacts"]) ? row["artifacts"] : []) as Record<
    string,
    unknown
  >[];
  return {
    version: String(row["version"]),
    channel: String(row["channel"] ?? "稳定版"),
    publishedAt: String(row["published_at"] ?? ""),
    minSupported: String(row["min_supported"] ?? "0.0.0"),
    notes: (Array.isArray(row["notes"]) ? row["notes"] : []).map(String),
    artifacts: artifacts.map((a) => {
      const file = String(a["file"]);
      return {
        platform: (a["platform"] as ReleaseArtifact["platform"]) ?? "linux",
        file,
        sizeMB: Number(a["sizeMB"] ?? 0),
        sha256: String(a["sha256"] ?? ""),
        url: a["url"] ? String(a["url"]) : artifactUrl(file),
      };
    }),
  };
}

/** 读取当前对外发布的版本清单（数据库为空时回退内置版本） */
export async function readRelease(db?: SupabaseClient): Promise<Release> {
  try {
    const c = db ?? client();
    const { data } = await c
      .from("agent_releases")
      .select("*")
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return mapRow(data as Record<string, unknown>);
  } catch {
    /* 数据库暂时不可用时回退内置版本 */
  }
  return FALLBACK_RELEASE;
}

/** 登记一次真实发布（供 CI 发布安装包后调用），并把它设为当前版本 */
export async function publishRelease(input: {
  version: string;
  channel?: string | undefined;
  publishedAt?: string | undefined;
  minSupported?: string | undefined;
  notes?: string[] | undefined;
  artifacts: { platform: ReleaseArtifact["platform"]; file: string; sizeMB: number; sha256: string; url?: string | undefined }[];
}): Promise<{ ok: boolean; message?: string }> {

  const c = client();
  await c.from("agent_releases").update({ is_current: false }).eq("is_current", true);
  const { error } = await c.from("agent_releases").upsert(
    {
      version: input.version,
      channel: input.channel ?? "稳定版",
      published_at: input.publishedAt ?? new Date().toISOString().slice(0, 10),
      min_supported: input.minSupported ?? "0.0.0",
      notes: input.notes ?? [],
      artifacts: input.artifacts,
      is_current: true,
    },
    { onConflict: "version" },
  );
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export interface UpgradeReport {
  agentId: string;
  ok: boolean;
  message: string;
  installedVersion: string;
  fromVersion?: string;
  durationMs?: number;
  reportedAt: string;
}

export function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
