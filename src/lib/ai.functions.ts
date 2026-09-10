import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const mask = (key: string) => (key ? `${key.slice(0, 4)}••••${key.slice(-4)}` : "");

/** 读取 AI 接入配置（API Key 仅返回掩码） */
export const fetchAiSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { readAiSettings } = await import("@/lib/ai-settings.server");
    const s = await readAiSettings();
    return { ...s, apiKey: "", apiKeyMask: mask(s.apiKey), hasApiKey: Boolean(s.apiKey) };
  });

/** 只保存元素抓取相关设置（模型配置改由 ai_providers 表维护） */
export const saveAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        inspectCacheMinutes: z.number().min(0).max(1440).default(10),
        inspectScreenshot: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { writeAiSettings } = await import("@/lib/ai-settings.server");
    const saved = await writeAiSettings(data);
    return { ...saved, apiKey: "", apiKeyMask: mask(saved.apiKey), hasApiKey: Boolean(saved.apiKey) };
  });

const publicProvider = (p: {
  id: string;
  name: string;
  mode: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  defaultModel: string;
  isActive: boolean;
  note: string;
  updatedAt: string;
}) => ({ ...p, apiKey: "", apiKeyMask: mask(p.apiKey), hasApiKey: Boolean(p.apiKey) });

/** 读取数据库里保存的全部模型配置（密钥只返回掩码） */
export const fetchAiProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { listAiProviders } = await import("@/lib/ai-settings.server");
    return (await listAiProviders()).map(publicProvider);
  });

const providerInput = z.object({
  id: z.string().max(64).optional(),
  name: z.string().min(1).max(80),
  mode: z.enum(["lovable", "openai", "anthropic", "custom"]),
  baseUrl: z.string().max(300).default(""),
  /** 留空表示保持原有密钥不变 */
  apiKey: z.string().max(300).default(""),
  models: z.array(z.string().min(1).max(120)).max(200).default([]),
  defaultModel: z.string().max(120).default(""),
  note: z.string().max(200).default(""),
});

export const saveAiProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => providerInput.parse(input))
  .handler(async ({ data }) => {
    const { saveAiProvider: save } = await import("@/lib/ai-settings.server");
    return (await save(data)).map(publicProvider);
  });

export const removeAiProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }) => {
    const { deleteAiProvider } = await import("@/lib/ai-settings.server");
    return (await deleteAiProvider(data.id)).map(publicProvider);
  });

/** 切换当前使用的模型配置；id 传空字符串表示改用内置 Lovable AI */
export const switchAiProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().max(64).default("") }).parse(input))
  .handler(async ({ data }) => {
    const { activateAiProvider } = await import("@/lib/ai-settings.server");
    return (await activateAiProvider(data.id)).map(publicProvider);
  });

/** 上传本地模型清单文件导入：原文完整入库，解析结果写进模型配置 */
export const importAiModelFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        filename: z.string().max(200).default("models.json"),
        content: z.string().min(1).max(2_000_000),
        targetProviderId: z.string().max(64).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { importAiProviders, parseModelFile, saveAiModelFile, listAiModelFiles } = await import(
      "@/lib/ai-settings.server"
    );
    let entries;
    try {
      entries = parseModelFile(data.filename, data.content);
    } catch (e) {
      throw new Error(`文件解析失败：${(e as Error).message}`);
    }
    if (!entries.length) throw new Error("文件里没有解析到任何模型");
    const res = await importAiProviders(entries, data.targetProviderId || undefined);
    const modelCount = new Set(entries.flatMap((e) => e.models ?? [])).size;
    await saveAiModelFile({
      filename: data.filename,
      content: data.content,
      providerId: data.targetProviderId || undefined,
      modelCount,
    });
    return {
      providers: res.providers.map(publicProvider),
      addedProviders: res.addedProviders,
      addedModels: res.addedModels,
      files: await listAiModelFiles(),
    };
  });

/** 数据库里已保存的清单文件列表（不返回原文，避免传输过大） */
export const fetchAiModelFiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { listAiModelFiles } = await import("@/lib/ai-settings.server");
    return listAiModelFiles();
  });

/** 按原文重新解析一份清单文件，把模型写回配置 */
export const reparseAiModelFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ id: z.string().min(1).max(64), targetProviderId: z.string().max(64).default("") })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { reparseAiModelFile: reparse } = await import("@/lib/ai-settings.server");
    const res = await reparse(data.id, data.targetProviderId || undefined);
    return {
      providers: res.providers.map(publicProvider),
      addedProviders: res.addedProviders,
      addedModels: res.addedModels,
      files: res.files,
    };
  });

export const removeAiModelFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }) => {
    const { deleteAiModelFile } = await import("@/lib/ai-settings.server");
    return deleteAiModelFile(data.id);
  });


/** 用当前（或表单里临时填写的）配置真实发一次请求，验证连接可用 */
export const testAiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        providerId: z.string().max(64).default(""),
        mode: z.enum(["lovable", "openai", "anthropic", "custom"]),
        baseUrl: z.string().max(300).default(""),
        apiKey: z.string().max(300).default(""),
        model: z.string().max(120).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { readAiSettings, resolveModel, listAiProviders } = await import("@/lib/ai-settings.server");
    const { streamText } = await import("ai");
    const stored = await readAiSettings();
    const saved = data.providerId ? (await listAiProviders()).find((p) => p.id === data.providerId) : undefined;
    const settings = {
      ...stored,
      mode: data.mode,
      baseUrl: data.baseUrl || saved?.baseUrl || stored.baseUrl,
      apiKey: data.apiKey || saved?.apiKey || stored.apiKey,
      defaultModel: data.model || saved?.defaultModel || stored.defaultModel,
    };

    const started = Date.now();
    try {
      const resolved = await resolveModel(settings, undefined, data.model);
      const result = streamText({
        model: resolved.model,
        prompt: "只回复两个字：可用",
        ...(resolved.providerOptions ? { providerOptions: resolved.providerOptions } : {}),
      });
      const text = (await result.text).trim();
      return {
        ok: true as const,
        label: resolved.label,
        modelId: resolved.modelId,
        ms: Date.now() - started,
        reply: text.slice(0, 120),
      };
    } catch (error) {
      return {
        ok: false as const,
        ms: Date.now() - started,
        message: (error as Error).message || "连接失败",
      };
    }
  });
