/**
 * 客户端 AI 助手用的用例生成提示词与回复解析（仅服务端）。
 *
 * 客户端把对话发到平台代理接口，平台用配置好的模型生成一段 JSON，
 * 这里负责拼提示词、解析 JSON 并按关键字白名单过滤非法步骤。
 */
import { KEYWORDS, generatePlaywrightCode, type CaseStep } from "@/lib/keywords";

const KEYWORD_IDS = KEYWORDS.filter((k) => k.id !== "unsupported").map((k) => String(k.id));

export const KEYWORD_REFERENCE = KEYWORDS.map(
  (k) =>
    `${k.id}（${k.label}｜${k.category}${k.needsTarget ? `｜target=${k.targetLabel}` : ""}${
      k.needsValue ? `｜value=${k.valueLabel}` : ""
    }${k.opensBlock ? "｜开启代码块" : ""}${k.closesBlock ? "｜结束代码块" : ""}）`,
).join("\n");

export const CASE_SYSTEM_PROMPT = `你是 PlayFlow 客户端里的 AI 助手，帮助测试人员在本机录制与编排 Playwright 用例，全程使用简体中文。

你的任务：
1. 根据用户的中文描述生成或修改一条用例的关键字步骤。
2. 用户给出页面元素清单时，从清单里挑选最稳定的定位方式（优先 role/text/data-testid，避免长 CSS 路径与随机 class），并说明理由。
3. 用户要求修改时，在上一版步骤基础上迭代，不要凭空重写。

约束：
- 只能使用下面列出的关键字 id。
- 条件（ifVisible / ifNotVisible / ifText，可配 elseBranch）必须以 endIf 闭合；循环（repeat / whileVisible）必须以 endLoop 闭合。
- 需要参数化的取值写成 \${参数名}；循环里可用 \${LOOP_INDEX}、\${当前循环}、\${循环次数}。
- 结尾建议加一条断言，让结果可判定。

回复格式（必须严格遵守）：先用两三句中文说明思路，然后另起一行输出一个 JSON 代码块：
\`\`\`json
{"name":"用例名称","module":"模块","startUrl":"起始地址","note":"说明或风险提示","steps":[{"keyword":"关键字id","target":"定位器或空","value":"取值或空"}]}
\`\`\`
只在需要生成或修改步骤时输出 JSON；只是解释问题时不要输出 JSON。

可用关键字：
${KEYWORD_REFERENCE}`;

export interface CaseDraftResult {
  name: string;
  module: string;
  startUrl: string;
  note: string;
  steps: CaseStep[];
  script: string;
  /** 被白名单拒绝的关键字，提示用户 */
  rejected: string[];
}

/** 从模型回复里取出 JSON 草稿；没有 JSON 时返回 null（说明只是普通回答） */
export function parseCaseReply(text: string): CaseDraftResult | null {
  const raw = extractJson(text);
  if (!raw) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed?.steps) ? parsed.steps : [];
  if (!list.length) return null;

  const rejected: string[] = [];
  const steps: CaseStep[] = [];
  list.forEach((s: any, i: number) => {
    const keyword = String(s?.keyword ?? "").trim();
    if (!KEYWORD_IDS.includes(keyword)) {
      if (keyword) rejected.push(keyword);
      return;
    }
    steps.push({
      id: `ai-${Date.now()}-${i}`,
      keyword: keyword as CaseStep["keyword"],
      target: String(s?.target ?? ""),
      value: String(s?.value ?? ""),
    });
  });
  if (!steps.length) return null;

  const name = String(parsed?.name ?? "").trim() || "AI 生成用例";
  return {
    name,
    module: String(parsed?.module ?? "").trim() || "AI 生成",
    startUrl: String(parsed?.startUrl ?? "").trim(),
    note: String(parsed?.note ?? "").trim(),
    steps,
    script: generatePlaywrightCode(name, steps),
    rejected,
  };
}

/** 去掉模型回复里的说明文字，只留 JSON 主体 */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1]?.trim();
  if (body?.startsWith("{")) return body;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

/** 把模型回复里的 JSON 代码块去掉，只留给用户看的说明文字 */
export function stripJsonBlock(text: string): string {
  return text
    .replace(/```(?:json)?[\s\S]*?```/gi, "")
    .trim();
}
