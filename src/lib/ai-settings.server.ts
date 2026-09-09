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

export async function readAiSettings(): Promise<AiSettings> {
  try {
    const { localClient } = await import("@/lib/local-db.server");
    const { data } = await localClient().from("ai_settings").select("*").eq("id", 1).maybeSingle();
    const row = data as Record<string, any> | null;
    if (!row) return DEFAULTS;
    const minutes = Number(row["inspect_cache_minutes"]);
    return {
      mode: (row["mode"] as AiMode) || "lovable",
      baseUrl: row["base_url"] ?? "",
      apiKey: row["api_key"] ?? "",
      models: Array.isArray(row["models"]) ? (row["models"] as string[]) : [],
      defaultModel: row["default_model"] ?? "",
      inspectCacheMinutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : 10,
      inspectScreenshot: row["inspect_screenshot"] === undefined || row["inspect_screenshot"] === null
        ? true
        : Boolean(row["inspect_screenshot"]),
      updatedAt: row["updated_at"] ?? "",
    };
  } catch {
    return DEFAULTS;
  }
}

export async function writeAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  const { localClient } = await import("@/lib/local-db.server");
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.mode !== undefined) row["mode"] = patch.mode;
  if (patch.baseUrl !== undefined) row["base_url"] = patch.baseUrl.replace(/\/$/, "");
  if (patch.apiKey !== undefined) row["api_key"] = patch.apiKey;
  if (patch.models !== undefined) row["models"] = patch.models;
  if (patch.defaultModel !== undefined) row["default_model"] = patch.defaultModel;
  if (patch.inspectCacheMinutes !== undefined)
    row["inspect_cache_minutes"] = Math.max(0, Math.min(1440, Math.round(patch.inspectCacheMinutes)));
  if (patch.inspectScreenshot !== undefined) row["inspect_screenshot"] = patch.inspectScreenshot;
  await localClient().from("ai_settings").upsert({ id: 1, ...row }, { onConflict: "id" });
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
