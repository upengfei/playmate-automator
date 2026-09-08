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
  | "screenshot";

export type KeywordCategory = "导航" | "交互" | "等待" | "断言" | "其他";

export interface KeywordDef {
  id: KeywordId;
  label: string;
  category: KeywordCategory;
  needsTarget: boolean;
  needsValue: boolean;
  targetLabel: string;
  valueLabel: string;
  color: string;
  template: (target: string, value: string) => string;
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
    template: (_t, v) => `await page.goto('${v}');`,
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
    template: (t) => `await page.locator('${t}').click();`,
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
    template: (t, v) => `await page.locator('${t}').fill('${v}');`,
  },
  {
    id: "press",
    label: "按键",
    category: "交互",
    needsTarget: true,
    needsValue: true,
    targetLabel: "定位器",
    valueLabel: "按键",
    color: "chart-1",
    template: (t, v) => `await page.locator('${t}').press('${v}');`,
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
    template: (t, v) => `await page.locator('${t}').selectOption('${v}');`,
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
    template: (t) => `await page.locator('${t}').hover();`,
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
    template: (t) => `await page.locator('${t}').waitFor({ state: 'visible' });`,
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
    template: (t, v) => `await expect(page.locator('${t}')).toContainText('${v}');`,
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
    template: (t) => `await expect(page.locator('${t}')).toBeVisible();`,
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
    template: (_t, v) => `await page.screenshot({ path: '${v || "shot.png"}' });`,
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

export function generatePlaywrightCode(caseName: string, steps: CaseStep[]): string {
  const body = steps
    .map((s) => `  // ${describeStep(s)}\n  ${getKeyword(s.keyword).template(s.target, s.value)}`)
    .join("\n");
  return `import { test, expect } from '@playwright/test';

test('${caseName}', async ({ page }) => {
${body || "  // 暂无步骤"}
});
`;
}
