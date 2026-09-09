/**
 * 参数解析（浏览器端，与服务端 case-params.server.ts 规则保持一致）：
 * 取值优先级为 用例默认值 < 环境绑定 < 设备绑定。
 */
import { LOOP_VAR_NAMES } from "./keywords";
import type { CaseParam, ParamBinding } from "./store";

export const PLACEHOLDER =
  /\$\{\s*([A-Za-z0-9_\-.\u4e00-\u9fa5]+)\s*\}|\{\{\s*([A-Za-z0-9_\-.\u4e00-\u9fa5]+)\s*\}\}/g;

export type ParamSource = "设备绑定" | "环境绑定" | "用例默认值" | "循环变量" | "未定义";

export function isLoopVar(name: string): boolean {
  return LOOP_VAR_NAMES.includes(name);
}

export interface ResolvedParam {
  name: string;
  value: string;
  source: ParamSource;
  /** 各来源的取值，便于在界面上展示覆盖关系 */
  caseValue?: string | undefined;
  envValue?: string | undefined;
  agentValue?: string | undefined;
  note?: string | undefined;
}

/** 合并出每个参数的最终取值与来源 */
export function resolveParams(
  params: CaseParam[],
  bindings: ParamBinding[],
  env: string,
  agentId: string,
  extraNames: string[] = [],
): ResolvedParam[] {
  const names = new Set<string>([
    ...params.map((p) => p.name).filter(Boolean),
    ...extraNames.filter(Boolean),
  ]);
  return [...names].map((name) => {
    if (isLoopVar(name)) {
      return {
        name,
        value: "运行时循环上下文",
        source: "循环变量" as ParamSource,
        note: "由所在循环积木提供：LOOP_INDEX 从 0 开始，LOOP_ITERATION / 当前循环 从 1 开始，LOOP_COUNT / 循环次数 为总次数",
      };
    }
    const caseParam = params.find((p) => p.name === name);
    const envBind = bindings.find((b) => b.scope === "环境" && b.scopeKey === env && b.name === name);
    const agentBind = bindings.find(
      (b) => b.scope === "设备" && b.scopeKey === agentId && b.name === name,
    );
    const source: ParamSource = agentBind
      ? "设备绑定"
      : envBind
        ? "环境绑定"
        : caseParam
          ? "用例默认值"
          : "未定义";
    const value = agentBind?.value ?? envBind?.value ?? caseParam?.value ?? "";
    return {
      name,
      value,
      source,
      caseValue: caseParam?.value,
      envValue: envBind?.value,
      agentValue: agentBind?.value,
      note: agentBind?.note || envBind?.note || caseParam?.note,
    };
  });
}

export function paramMap(resolved: ResolvedParam[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of resolved)
    if (r.source !== "未定义" && r.source !== "循环变量") map[r.name] = r.value;
  return map;
}

/** 把文本里的 ${参数名} / {{参数名}} 替换成实际取值，未定义时保留原样 */
export function applyParams(text: string, map: Record<string, string>): string {
  if (!text) return text ?? "";
  return text.replace(PLACEHOLDER, (raw, a?: string, b?: string) => {
    const key = (a ?? b ?? "").trim();
    if (isLoopVar(key)) return raw; // 循环变量在执行时由循环上下文替换
    return key in map ? (map[key] as string) : raw;
  });
}
