/**
 * 用例参数化（仅服务端）。
 *
 * 用例可以在步骤、起始地址与脚本里写占位符 ${参数名} 或 {{参数名}}，
 * 平台下发任务时按「用例默认值 < 环境绑定 < 设备绑定」的优先级替换成实际取值，
 * 这样同一个模板用例可以在不同环境或不同设备上直接复用，无需重复录制。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOOP_VAR_NAMES } from "./keywords";

/** 循环变量不参与参数绑定替换，由客户端执行时按循环上下文取值 */
function isLoopVar(name: string): boolean {
  return LOOP_VAR_NAMES.includes(name);
}

export type CaseParam = { name: string; value: string; note?: string };
export type ParamBinding = {
  id: string;
  scope: "环境" | "设备";
  scopeKey: string;
  name: string;
  value: string;
  note: string;
};

export type StepLike = { id?: string; keyword: string; target?: string; value?: string };

/** 读取所有环境 / 设备参数绑定 */
export async function readParamBindings(client: SupabaseClient): Promise<ParamBinding[]> {
  const { data } = await client
    .from("param_bindings")
    .select("*")
    .order("scope", { ascending: true })
    .order("scope_key", { ascending: true })
    .order("name", { ascending: true })
    .limit(500);
  return ((data ?? []) as Record<string, any>[]).map((r) => ({
    id: r["id"] as string,
    scope: (r["scope"] as ParamBinding["scope"]) ?? "环境",
    scopeKey: (r["scope_key"] as string) ?? "",
    name: (r["name"] as string) ?? "",
    value: (r["value"] as string) ?? "",
    note: (r["note"] as string) ?? "",
  }));
}

export function normalizeParams(input: unknown): CaseParam[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((p) => p as Record<string, unknown>)
    .filter((p) => p && typeof p["name"] === "string" && (p["name"] as string).trim())
    .map((p) => ({
      name: (p["name"] as string).trim(),
      value: typeof p["value"] === "string" ? p["value"] : "",
      note: typeof p["note"] === "string" ? p["note"] : "",
    }));
}

/** 合并参数取值：用例默认值 < 环境绑定 < 设备绑定 */
export function resolveParamMap(
  caseParams: unknown,
  bindings: ParamBinding[],
  env: string,
  agentId: string,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of normalizeParams(caseParams)) map[p.name] = p.value;
  for (const b of bindings) if (b.scope === "环境" && b.scopeKey === env) map[b.name] = b.value;
  for (const b of bindings) if (b.scope === "设备" && b.scopeKey === agentId) map[b.name] = b.value;
  return map;
}

const PLACEHOLDER = /\$\{\s*([A-Za-z0-9_\-.\u4e00-\u9fa5]+)\s*\}|\{\{\s*([A-Za-z0-9_\-.\u4e00-\u9fa5]+)\s*\}\}/g;

/** 把一段文本里的占位符替换成实际取值；找不到取值时保留原样，便于排查 */
export function applyParams(text: string, map: Record<string, string>): string {
  if (!text) return text ?? "";
  return text.replace(PLACEHOLDER, (raw, a: string | undefined, b: string | undefined) => {
    const key = (a ?? b ?? "").trim();
    if (isLoopVar(key)) return raw;
    return key in map ? map[key]! : raw;
  });
}

export function applyParamsToSteps(steps: unknown, map: Record<string, string>): StepLike[] {
  if (!Array.isArray(steps)) return [];
  return (steps as StepLike[]).map((s) => ({
    ...s,
    target: applyParams(s.target ?? "", map),
    value: applyParams(s.value ?? "", map),
  }));
}

/** 文本里用到但没有取值的参数名，用于提醒用户补齐绑定 */
export function missingParams(texts: string[], map: Record<string, string>): string[] {
  const missing = new Set<string>();
  for (const t of texts) {
    for (const m of (t ?? "").matchAll(PLACEHOLDER)) {
      const key = (m[1] ?? m[2] ?? "").trim();
      if (key && !isLoopVar(key) && !(key in map)) missing.add(key);
    }
  }
  return [...missing];
}
