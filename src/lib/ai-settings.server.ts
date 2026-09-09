/**
 * AI 模型接入配置（仅服务端）。
 *
 * mode：
 * - lovable    内置 Lovable AI（无需任何密钥，默认）
 * - openai     OpenAI 兼容接口（自填 Base URL + API Key + 模型）
 * - anthropic  Anthropic 兼容接口
 * - custom     自定义 OpenAI 兼容网关（与 openai 相同协议，仅便于区分标注）
 */
import type { LanguageModel } from "ai";

export type AiMode = "lovable" | "openai" | "anthropic" | "custom";

export interface AiSettings {
  mode: AiMode;
  baseUrl: string;
  apiKey: string;
  models: string[];
  defaultModel: string;
  /** 元素抓取结果缓存有效期（分钟），0 表示不缓存 */
  inspectCacheMinutes: number;
  /** 抓取时是否保存页面截图 */
  inspectScreenshot: boolean;
  updatedAt: string;
}

const DEFAULTS: AiSettings = {
  mode: "lovable",
  baseUrl: "",
  apiKey: "",
  models: [],
  defaultModel: "",
  inspectCacheMinutes: 10,
  inspectScreenshot: true,
  updatedAt: "",
};

/** 数据库里保存的一套模型配置 */
export interface AiProvider {
  id: string;
  name: string;
  mode: AiMode;
  baseUrl: string;
  apiKey: string;
  models: string[];
  defaultModel: string;
  isActive: boolean;
  note: string;
  updatedAt: string;
}

async function db() {
  const { localClient } = await import("@/lib/local-db.server");
  return localClient();
}

function toProvider(row: Record<string, any>): AiProvider {
  return {
    id: String(row["id"]),
    name: row["name"] || "未命名配置",
    mode: (row["mode"] as AiMode) || "openai",
    baseUrl: row["base_url"] ?? "",
    apiKey: row["api_key"] ?? "",
    models: Array.isArray(row["models"]) ? (row["models"] as string[]) : [],
    defaultModel: row["default_model"] ?? "",
    isActive: Boolean(row["is_active"]),
    note: row["note"] ?? "",
    updatedAt: row["updated_at"] ?? "",
  };
}

/** 读取全部模型配置；首次运行时把旧的单套配置迁移成一条记录 */
export async function listAiProviders(): Promise<AiProvider[]> {
  const client = await db();
  const { data } = await client.from("ai_providers").select("*").order("created_at", { ascending: true });
  let rows = (data as Record<string, any>[] | null) ?? [];
  if (!rows.length) {
    const { data: legacy } = await client.from("ai_settings").select("*").eq("id", 1).maybeSingle();
    const old = legacy as Record<string, any> | null;
    const models = Array.isArray(old?.["models"]) ? (old!["models"] as string[]) : [];
    if (old && (old["base_url"] || old["api_key"] || models.length)) {
      await client.from("ai_providers").insert({
        name: "已有配置",
        mode: old["mode"] || "openai",
        base_url: old["base_url"] ?? "",
        api_key: old["api_key"] ?? "",
        models,
        default_model: old["default_model"] ?? "",
        is_active: true,
        note: "从旧版单套配置自动迁移",
      });
      const again = await client.from("ai_providers").select("*").order("created_at", { ascending: true });
      rows = (again.data as Record<string, any>[] | null) ?? [];
    }
  }
  return rows.map(toProvider);
}

export async function saveAiProvider(
  input: { id?: string | undefined; name: string } & Partial<Omit<AiProvider, "id" | "name">>,
): Promise<AiProvider[]> {

  const client = await db();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) row["name"] = input.name;
  if (input.mode !== undefined) row["mode"] = input.mode;
  if (input.baseUrl !== undefined) row["base_url"] = input.baseUrl.replace(/\/$/, "");
  if (input.models !== undefined) row["models"] = input.models;
  if (input.defaultModel !== undefined) row["default_model"] = input.defaultModel;
  if (input.note !== undefined) row["note"] = input.note;
  // 空密钥表示保持原有密钥不变
  if (input.apiKey) row["api_key"] = input.apiKey;

  if (input.id) {
    await client.from("ai_providers").update(row).eq("id", input.id);
  } else {
    const existing = await listAiProviders();
    await client.from("ai_providers").insert({ ...row, api_key: input.apiKey ?? "", is_active: !existing.length });
  }
  return listAiProviders();
}

export async function deleteAiProvider(id: string): Promise<AiProvider[]> {
  const client = await db();
  await client.from("ai_providers").delete().eq("id", id);
  const left = await listAiProviders();
  if (left.length && !left.some((p) => p.isActive)) return activateAiProvider(left[0]!.id);
  return left;
}

/** 切换当前使用的模型配置；id 为空表示改用内置 Lovable AI */
export async function activateAiProvider(id: string): Promise<AiProvider[]> {
  const client = await db();
  const all = await listAiProviders();
  for (const p of all) {
    const want = p.id === id;
    if (p.isActive !== want) await client.from("ai_providers").update({ is_active: want }).eq("id", p.id);
  }
  return listAiProviders();
}

/** 批量导入模型清单文件：既支持整套配置，也支持只有模型名称的清单 */
export async function importAiProviders(
  entries: { name?: string; mode?: string; baseUrl?: string; apiKey?: string; models?: string[]; defaultModel?: string }[],
  targetProviderId?: string,
): Promise<{ providers: AiProvider[]; addedProviders: number; addedModels: number }> {
  const client = await db();
  let addedProviders = 0;
  let addedModels = 0;
  const plainModels: string[] = [];

  for (const e of entries) {
    const models = (e.models ?? []).map((m) => String(m).trim()).filter(Boolean);
    if (e.baseUrl || e.mode || e.apiKey) {
      const mode = (["lovable", "openai", "anthropic", "custom"] as const).includes(e.mode as AiMode)
        ? (e.mode as AiMode)
        : "openai";
      await client.from("ai_providers").insert({
        name: e.name || e.baseUrl || "导入的配置",
        mode,
        base_url: (e.baseUrl ?? "").replace(/\/$/, ""),
        api_key: e.apiKey ?? "",
        models,
        default_model: e.defaultModel || models[0] || "",
        is_active: false,
        note: "由本地文件导入",
      });
      addedProviders += 1;
      continue;
    }
    plainModels.push(...models);
    if (e.name) plainModels.push(String(e.name).trim());
  }

  if (plainModels.length) {
    const all = await listAiProviders();
    const target = all.find((p) => p.id === targetProviderId) ?? all.find((p) => p.isActive) ?? all[0];
    if (target) {
      const merged = Array.from(new Set([...target.models, ...plainModels])).filter(Boolean);
      addedModels = merged.length - target.models.length;
      await client
        .from("ai_providers")
        .update({
          models: merged,
          default_model: target.defaultModel || merged[0] || "",
          updated_at: new Date().toISOString(),
        })
        .eq("id", target.id);
    } else {
      const models = Array.from(new Set(plainModels));
      await client.from("ai_providers").insert({
        name: "导入的模型清单",
        mode: "openai",
        base_url: "",
        api_key: "",
        models,
        default_model: models[0] ?? "",
        is_active: true,
        note: "由本地文件导入",
      });
      addedProviders += 1;
      addedModels = models.length;
    }
  }

  return { providers: await listAiProviders(), addedProviders, addedModels };
}

/** 当前生效配置：模型接入取自数据库里被勾选的那一套，抓取参数仍存在 ai_settings */
export async function readAiSettings(): Promise<AiSettings> {
  try {
    const client = await db();
    const { data } = await client.from("ai_settings").select("*").eq("id", 1).maybeSingle();
    const row = (data as Record<string, any> | null) ?? {};
    const minutes = Number(row["inspect_cache_minutes"]);
    const active = (await listAiProviders()).find((p) => p.isActive);
    return {
      mode: active?.mode ?? "lovable",
      baseUrl: active?.baseUrl ?? "",
      apiKey: active?.apiKey ?? "",
      models: active?.models ?? [],
      defaultModel: active?.defaultModel ?? "",
      inspectCacheMinutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : 10,
      inspectScreenshot:
        row["inspect_screenshot"] === undefined || row["inspect_screenshot"] === null
          ? true
          : Boolean(row["inspect_screenshot"]),
      updatedAt: row["updated_at"] ?? active?.updatedAt ?? "",
    };
  } catch {
    return DEFAULTS;
  }
}

/** 只写入抓取相关设置（模型配置改由 ai_providers 维护） */
export async function writeAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  const client = await db();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.inspectCacheMinutes !== undefined)
    row["inspect_cache_minutes"] = Math.max(0, Math.min(1440, Math.round(patch.inspectCacheMinutes)));
  if (patch.inspectScreenshot !== undefined) row["inspect_screenshot"] = patch.inspectScreenshot;
  await client.from("ai_settings").upsert({ id: 1, ...row }, { onConflict: "id" });
  return readAiSettings();
}



export interface ResolvedModel {
  model: LanguageModel;
  modelId: string;
  label: string;
  /** Lovable AI（Responses API）需要额外的推理参数 */
  providerOptions?: any;
}

/** 按当前配置创建可用的模型实例；配置不完整时回退到内置 Lovable AI */
export async function resolveModel(
  settings: AiSettings,
  request?: Request,
  overrideModel?: string,
): Promise<ResolvedModel> {
  const wanted = (overrideModel || settings.defaultModel || settings.models[0] || "").trim();

  if (settings.mode !== "lovable" && settings.baseUrl && settings.apiKey && wanted) {
    if (settings.mode === "anthropic") {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const anthropic = createAnthropic({ baseURL: settings.baseUrl, apiKey: settings.apiKey });
      return { model: anthropic(wanted), modelId: wanted, label: `Anthropic 兼容 · ${wanted}` };
    }
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    const provider = createOpenAICompatible({
      name: settings.mode === "custom" ? "custom" : "openai-compatible",
      baseURL: settings.baseUrl,
      apiKey: settings.apiKey,
    });
    return {
      model: provider(wanted),
      modelId: wanted,
      label: `${settings.mode === "custom" ? "自定义" : "OpenAI 兼容"} · ${wanted}`,
    };
  }

  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("未配置任何可用的 AI 模型：请在系统配置 → AI 设置里填写模型接入信息");
  const { createLovableResponsesProvider, AI_MODEL, AI_PROVIDER_OPTIONS, getLovableAiGatewayRunId } =
    await import("@/lib/ai-gateway.server");
  const { provider } = createLovableResponsesProvider(
    key,
    request ? getLovableAiGatewayRunId(request) : undefined,
  );
  return {
    model: provider.responses(AI_MODEL),
    modelId: AI_MODEL,
    label: `内置 Lovable AI · ${AI_MODEL}`,
    providerOptions: AI_PROVIDER_OPTIONS as any,
  };
}
