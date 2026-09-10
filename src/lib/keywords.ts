export type KeywordId =
  | "goto"
  | "click"
  | "fill"
  | "press"
  | "select"
  | "hover"
  | "waitFor"
  | "wait"
  | "expectText"
  | "expectUrl"
  | "expectVisible"
  | "screenshot"
  | "ifVisible"
  | "ifNotVisible"
  | "ifText"
  | "elseBranch"
  | "endIf"
  | "repeat"
  | "whileVisible"
  | "endLoop";

export type KeywordCategory = "导航" | "交互" | "等待" | "断言" | "逻辑" | "其他";

export interface KeywordDef {
  id: KeywordId;
  label: string;
  category: KeywordCategory;
  needsTarget: boolean;
  needsValue: boolean;
  targetLabel: string;
  valueLabel: string;
  color: string;
  /** 结构积木：打开一个代码块（条件/循环开始） */
  opensBlock?: boolean;
  /** 结构积木：关闭一个代码块（结束） */
  closesBlock?: boolean;
  /** 定位器选填：留空时也能执行 */
  optionalTarget?: boolean;
  /** 取值提供下拉候选（仍可自定义输入） */
  valueOptions?: string[];
  template: (target: string, value: string) => string;

}

/**
 * 循环变量：可以像普通参数一样写在步骤里（${LOOP_INDEX} / {{当前循环}}），
 * 但取值来自运行时的循环上下文，而不是参数绑定。
 */
export const LOOP_VARS: Record<string, string> = {
  LOOP_INDEX: "i",
  LOOP_ITERATION: "(i + 1)",
  LOOP_COUNT: "__loopCount",
  当前循环: "(i + 1)",
  循环序号: "i",
  循环次数: "__loopCount",
};

export const LOOP_VAR_NAMES = Object.keys(LOOP_VARS);

const ANY_PLACEHOLDER =
  /\$\{\s*([A-Za-z0-9_\-.\u4e00-\u9fa5]+)\s*\}|\{\{\s*([A-Za-z0-9_\-.\u4e00-\u9fa5]+)\s*\}\}/g;

function escBacktick(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/** 把步骤文本转成 JS 字符串字面量：循环变量插值成真实表达式，其他内容原样保留 */
export function lit(text: string): string {
  const raw = String(text ?? "");
  let out = "";
  let last = 0;
  for (const m of raw.matchAll(ANY_PLACEHOLDER)) {
    const key = (m[1] ?? m[2] ?? "").trim();
    const expr = LOOP_VARS[key];
    if (!expr) continue;
    out += escBacktick(raw.slice(last, m.index ?? 0)) + "${" + expr + "}";
    last = (m.index ?? 0) + m[0].length;
  }
  out += escBacktick(raw.slice(last));
  return "`" + out + "`";
}

export const KEYWORDS: KeywordDef[] = [
  {
    id: "goto",
    label: "打开页面",
    category: "导航",
    needsTarget: false,
    needsValue: true,
    targetLabel: "",
    valueLabel: "地址",
    color: "chart-1",
    template: (_t, v) => `await page.goto(${lit(v)});`,
  },
  {
    id: "click",
    label: "点击元素",
    category: "交互",
    needsTarget: true,
    needsValue: false,
    targetLabel: "定位器",
    valueLabel: "",
    color: "chart-1",
    template: (t) => `await page.locator(${lit(t)}).click();`,
  },
  {
    id: "fill",
    label: "输入文本",
    category: "交互",
    needsTarget: true,
    needsValue: true,
    targetLabel: "定位器",
    valueLabel: "文本",
    color: "chart-1",
    template: (t, v) => `await page.locator(${lit(t)}).fill(${lit(v)});`,
  },
  {
    id: "press",
    label: "按键",
    category: "交互",
    needsTarget: true,
    needsValue: true,
    optionalTarget: true,
    targetLabel: "定位器（选填，可用 ${变量}）",
    valueLabel: "按键",
    valueOptions: PRESS_KEYS,
    color: "chart-1",
    template: (t, v) =>
      t.trim()
        ? `await page.locator(${lit(t)}).press(${lit(v || "Enter")});`
        : `await page.keyboard.press(${lit(v || "Enter")});`,

  },
  {
    id: "select",
    label: "选择下拉项",
    category: "交互",
    needsTarget: true,
    needsValue: true,
    targetLabel: "定位器",
    valueLabel: "选项值",
    color: "chart-1",
    template: (t, v) => `await page.locator(${lit(t)}).selectOption(${lit(v)});`,
  },
  {
    id: "hover",
    label: "悬停",
    category: "交互",
    needsTarget: true,
    needsValue: false,
    targetLabel: "定位器",
    valueLabel: "",
    color: "chart-1",
    template: (t) => `await page.locator(${lit(t)}).hover();`,
  },
  {
    id: "waitFor",
    label: "等待元素出现",
    category: "等待",
    needsTarget: true,
    needsValue: false,
    targetLabel: "定位器",
    valueLabel: "",
    color: "chart-3",
    template: (t) => `await page.locator(${lit(t)}).waitFor({ state: 'visible' });`,
  },
  {
    id: "wait",
    label: "等待时长",
    category: "等待",
    needsTarget: false,
    needsValue: true,
    targetLabel: "",
    valueLabel: "毫秒",
    color: "chart-3",
    template: (_t, v) => `await page.waitForTimeout(${v || 1000});`,
  },
  {
    id: "expectText",
    label: "断言文本",
    category: "断言",
    needsTarget: true,
    needsValue: true,
    targetLabel: "定位器",
    valueLabel: "期望文本",
    color: "chart-2",
    template: (t, v) => `await expect(page.locator(${lit(t)})).toContainText(${lit(v)});`,
  },
  {
    id: "expectUrl",
    label: "断言地址",
    category: "断言",
    needsTarget: false,
    needsValue: true,
    targetLabel: "",
    valueLabel: "期望地址",
    color: "chart-2",
    template: (_t, v) => `await expect(page).toHaveURL(/${v.replace(/\//g, "\\/")}/);`,
  },
  {
    id: "expectVisible",
    label: "断言可见",
    category: "断言",
    needsTarget: true,
    needsValue: false,
    targetLabel: "定位器",
    valueLabel: "",
    color: "chart-2",
    template: (t) => `await expect(page.locator(${lit(t)})).toBeVisible();`,
  },
  {
    id: "screenshot",
    label: "截图",
    category: "其他",
    needsTarget: false,
    needsValue: true,
    targetLabel: "",
    valueLabel: "文件名",
    color: "chart-5",
    template: (_t, v) => `await page.screenshot({ path: ${lit(v || "shot.png")} });`,
  },
  {
    id: "ifVisible",
    label: "如果元素可见",
    category: "逻辑",
    needsTarget: true,
    needsValue: false,
    targetLabel: "定位器",
    valueLabel: "",
    color: "chart-4",
    opensBlock: true,
    template: (t) => `if (await page.locator(${lit(t)}).isVisible()) {`,
  },
  {
    id: "ifNotVisible",
    label: "如果元素不可见",
    category: "逻辑",
    needsTarget: true,
    needsValue: false,
    targetLabel: "定位器",
    valueLabel: "",
    color: "chart-4",
    opensBlock: true,
    template: (t) => `if (!(await page.locator(${lit(t)}).isVisible())) {`,
  },
  {
    id: "ifText",
    label: "如果文本包含",
    category: "逻辑",
    needsTarget: true,
    needsValue: true,
    targetLabel: "定位器",
    valueLabel: "包含文本",
    color: "chart-4",
    opensBlock: true,
    template: (t, v) =>
      `if (((await page.locator(${lit(t)}).textContent()) ?? '').includes(${lit(v)})) {`,
  },
  {
    id: "elseBranch",
    label: "否则",
    category: "逻辑",
    needsTarget: false,
    needsValue: false,
    targetLabel: "",
    valueLabel: "",
    color: "chart-4",
    template: () => `} else {`,
  },
  {
    id: "endIf",
    label: "条件结束",
    category: "逻辑",
    needsTarget: false,
    needsValue: false,
    targetLabel: "",
    valueLabel: "",
    color: "chart-4",
    closesBlock: true,
    template: () => `}`,
  },
  {
    id: "repeat",
    label: "循环次数",
    category: "逻辑",
    needsTarget: false,
    needsValue: true,
    targetLabel: "",
    valueLabel: "次数",
    color: "chart-4",
    opensBlock: true,
    template: (_t, v) =>
      `for (let i = 0, __loopCount = ${Number(v) > 0 ? Number(v) : 3}; i < __loopCount; i++) {`,
  },
  {
    id: "whileVisible",
    label: "当元素可见时循环",
    category: "逻辑",
    needsTarget: true,
    needsValue: true,
    targetLabel: "定位器",
    valueLabel: "最大次数",
    color: "chart-4",
    opensBlock: true,
    template: (t, v) =>
      `for (let i = 0, __loopCount = ${Number(v) > 0 ? Number(v) : 10}; i < __loopCount && (await page.locator(${lit(t)}).isVisible()); i++) {`,
  },
  {
    id: "endLoop",
    label: "循环结束",
    category: "逻辑",
    needsTarget: false,
    needsValue: false,
    targetLabel: "",
    valueLabel: "",
    color: "chart-4",
    closesBlock: true,
    template: () => `}`,
  },
];

export function getKeyword(id: KeywordId): KeywordDef {
  return KEYWORDS.find((k) => k.id === id) ?? KEYWORDS[0]!;
}

export interface CaseStep {
  id: string;
  keyword: KeywordId;
  target: string;
  value: string;
  remark?: string | undefined;
}

export function describeStep(step: CaseStep): string {
  const kw = getKeyword(step.keyword);
  const parts = [kw.label];
  if (kw.needsTarget && step.target) parts.push(step.target);
  if (kw.needsValue && step.value) parts.push(`「${step.value}」`);
  return parts.join(" · ");
}

/** 依据条件/循环积木计算每个步骤的缩进层级，供编辑器与代码生成共用 */
export function stepDepths(steps: CaseStep[]): number[] {
  let depth = 0;
  return steps.map((s) => {
    const kw = getKeyword(s.keyword);
    if (kw.closesBlock || kw.id === "elseBranch") depth = Math.max(0, depth - 1);
    const own = depth;
    if (kw.opensBlock || kw.id === "elseBranch") depth += 1;
    return own;
  });
}

export function generatePlaywrightCode(caseName: string, steps: CaseStep[]): string {
  const depths = stepDepths(steps);
  const body = steps
    .map((s, i) => {
      const pad = "  ".repeat((depths[i] ?? 0) + 1);
      return `${pad}// ${describeStep(s)}\n${pad}${getKeyword(s.keyword).template(s.target, s.value)}`;
    })
    .join("\n");
  return `import { test, expect } from '@playwright/test';

test('${caseName}', async ({ page }) => {
${body || "  // 暂无步骤"}
});
`;
}
