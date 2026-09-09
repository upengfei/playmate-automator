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

export const saveAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        mode: z.enum(["lovable", "openai", "anthropic", "custom"]),
        baseUrl: z.string().max(300).default(""),
        /** 留空表示保持原有密钥不变 */
        apiKey: z.string().max(300).default(""),
        models: z.array(z.string().min(1).max(80)).max(40).default([]),
        defaultModel: z.string().max(80).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { writeAiSettings } = await import("@/lib/ai-settings.server");
    const patch: Record<string, unknown> = {
      mode: data.mode,
      baseUrl: data.baseUrl,
      models: data.models,
      defaultModel: data.defaultModel,
    };
    if (data.apiKey) patch["apiKey"] = data.apiKey;
    const saved = await writeAiSettings(patch);
    return { ...saved, apiKey: "", apiKeyMask: mask(saved.apiKey), hasApiKey: Boolean(saved.apiKey) };
  });

/** 用当前（或表单里临时填写的）配置真实发一次请求，验证连接可用 */
export const testAiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        mode: z.enum(["lovable", "openai", "anthropic", "custom"]),
        baseUrl: z.string().max(300).default(""),
        apiKey: z.string().max(300).default(""),
        model: z.string().max(80).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { readAiSettings, resolveModel } = await import("@/lib/ai-settings.server");
    const { streamText } = await import("ai");
    const stored = await readAiSettings();
    const settings = {
      ...stored,
      mode: data.mode,
      baseUrl: data.baseUrl || stored.baseUrl,
      apiKey: data.apiKey || stored.apiKey,
      defaultModel: data.model || stored.defaultModel,
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
