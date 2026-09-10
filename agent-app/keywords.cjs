/* 客户端关键字清单（与平台 src/lib/keywords.ts 保持一致）
 *
 * 工作台是渲染进程页面，不能直接 require，因此通过 IPC 取「可序列化的元数据」，
 * 脚本生成留在主进程完成，保证客户端本地编排出来的脚本与平台生成的一致。
 */

const LOOP_VARS = {
  LOOP_INDEX: "i",
  LOOP_ITERATION: "(i + 1)",
  LOOP_COUNT: "__loopCount",
  当前循环: "(i + 1)",
  循环序号: "i",
  循环次数: "__loopCount",
};

const ANY_PLACEHOLDER =
  /\$\{\s*([A-Za-z0-9_\-.\u4e00-\u9fa5]+)\s*\}|\{\{\s*([A-Za-z0-9_\-.\u4e00-\u9fa5]+)\s*\}\}/g;

function escBacktick(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/** 把步骤文本转成 JS 字符串字面量：循环变量插值成真实表达式 */
function lit(text) {
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

/** 常用按键（Playwright 键名），可下拉选择，也允许自定义组合键 */
const PRESS_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "Space",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Control+A",
  "Control+C",
  "Control+V",
  "Meta+A",
  "Shift+Tab",
];

const KEYWORDS = [
  {
    id: "goto",
    label: "打开页面",
    category: "导航",
    needsTarget: false,
    needsValue: true,
    targetLabel: "",
    valueLabel: "地址",
    template: (_t, v) => `await page.goto(${lit(v)});\nframePath.length = 0;`,
  },
  {
    id: "click",
    label: "点击元素",
    category: "交互",
    needsTarget: true,
    needsValue: false,
    targetLabel: "定位器",
    valueLabel: "",
    template: (t) => `await activeLocator(${lit(t)}).click();`,
  },
  {
    id: "fill",
    label: "输入文本",
    category: "交互",
    needsTarget: true,
    needsValue: true,
    targetLabel: "定位器",
    valueLabel: "文本",
    template: (t, v) => `await activeLocator(${lit(t)}).fill(${lit(v)});`,
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
    template: (t, v) =>
      String(t).trim()
        ? `await activeLocator(${lit(t)}).press(${lit(v || "Enter")});`
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
    template: (t, v) => `await activeLocator(${lit(t)}).selectOption(${lit(v)});`,
  },
  {
    id: "hover",
    label: "悬停",
    category: "交互",
    needsTarget: true,
    needsValue: false,
    targetLabel: "定位器",
    valueLabel: "",
    template: (t) => `await activeLocator(${lit(t)}).hover();`,
  },
  {
    id: "waitFor",
    label: "等待元素出现",
    category: "等待",
    needsTarget: true,
    needsValue: false,
    targetLabel: "定位器",
    valueLabel: "",
    template: (t) => `await activeLocator(${lit(t)}).waitFor({ state: 'visible' });`,
  },
  {
    id: "wait",
    label: "等待时长",
    category: "等待",
    needsTarget: false,
    needsValue: true,
    targetLabel: "",
    valueLabel: "毫秒",
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
    template: (t, v) => `await expect(activeLocator(${lit(t)})).toContainText(${lit(v)});`,
  },
  {
    id: "expectUrl",
    label: "断言地址",
    category: "断言",
    needsTarget: false,
    needsValue: true,
    targetLabel: "",
    valueLabel: "期望地址",
    template: (_t, v) => `await expect(page).toHaveURL(/${String(v).replace(/\//g, "\\/")}/);`,
  },
  {
    id: "expectVisible",
    label: "断言可见",
    category: "断言",
    needsTarget: true,
    needsValue: false,
    targetLabel: "定位器",
    valueLabel: "",
    template: (t) => `await expect(activeLocator(${lit(t)})).toBeVisible();`,
  },
  {
    id: "screenshot",
    label: "截图",
    category: "其他",
    needsTarget: false,
    needsValue: true,
    targetLabel: "",
    valueLabel: "文件名",
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
    opensBlock: true,
    template: (t) => `if (await activeLocator(${lit(t)}).isVisible()) {`,
  },
  {
    id: "ifNotVisible",
    label: "如果元素不可见",
    category: "逻辑",
    needsTarget: true,
    needsValue: false,
    targetLabel: "定位器",
    valueLabel: "",
    opensBlock: true,
    template: (t) => `if (!(await activeLocator(${lit(t)}).isVisible())) {`,
  },
  {
    id: "ifText",
    label: "如果文本包含",
    category: "逻辑",
    needsTarget: true,
    needsValue: true,
    targetLabel: "定位器",
    valueLabel: "包含文本",
    opensBlock: true,
    template: (t, v) =>
      `if (((await activeLocator(${lit(t)}).textContent()) ?? '').includes(${lit(v)})) {`,
  },
  {
    id: "elseBranch",
    label: "否则",
    category: "逻辑",
    needsTarget: false,
    needsValue: false,
    targetLabel: "",
    valueLabel: "",
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
    opensBlock: true,
    template: (t, v) =>
      `for (let i = 0, __loopCount = ${Number(v) > 0 ? Number(v) : 10}; i < __loopCount && (await activeLocator(${lit(t)}).isVisible()); i++) {`,
  },
  {
    id: "endLoop",
    label: "循环结束",
    category: "逻辑",
    needsTarget: false,
    needsValue: false,
    targetLabel: "",
    valueLabel: "",
    closesBlock: true,
    template: () => `}`,
  },
];

const EXTENDED_KEYWORDS = [
  { id: "switchFrame", label: "进入 Frame", category: "导航", needsTarget: true, needsValue: false, targetLabel: "iframe 定位器", valueLabel: "", template: (t) => `await activeLocator(${lit(t)}).waitFor({ state: 'attached' });\nframePath.push(${lit(t)});` },
  { id: "parentFrame", label: "返回上层 Frame", category: "导航", needsTarget: false, needsValue: false, targetLabel: "", valueLabel: "", template: () => `if (!framePath.length) throw new Error('当前已在主文档');\nframePath.pop();` },
  { id: "mainFrame", label: "返回主文档", category: "导航", needsTarget: false, needsValue: false, targetLabel: "", valueLabel: "", template: () => "framePath.length = 0;" },
  { id: "dblclick", label: "双击元素", category: "交互", needsTarget: true, needsValue: false, targetLabel: "定位器", valueLabel: "", template: (t) => `await activeLocator(${lit(t)}).dblclick();` },
  { id: "check", label: "勾选", category: "交互", needsTarget: true, needsValue: false, targetLabel: "定位器", valueLabel: "", template: (t) => `await activeLocator(${lit(t)}).check();` },
  { id: "uncheck", label: "取消勾选", category: "交互", needsTarget: true, needsValue: false, targetLabel: "定位器", valueLabel: "", template: (t) => `await activeLocator(${lit(t)}).uncheck();` },
  { id: "setInputFiles", label: "上传文件", category: "交互", needsTarget: true, needsValue: true, targetLabel: "文件输入框定位器", valueLabel: "文件路径（多文件每行一个）", template: (t, v) => `await activeLocator(${lit(t)}).setInputFiles(${lit(v)}.split('\\n').filter(Boolean));` },
  { id: "dragTo", label: "拖拽到元素", category: "交互", needsTarget: true, needsValue: true, targetLabel: "源元素定位器", valueLabel: "目标元素定位器", template: (t, v) => `await activeLocator(${lit(t)}).dragTo(activeLocator(${lit(v)}));` },
  { id: "focus", label: "聚焦元素", category: "交互", needsTarget: true, needsValue: false, targetLabel: "定位器", valueLabel: "", template: (t) => `await activeLocator(${lit(t)}).focus();` },
  { id: "scrollIntoView", label: "滚动到元素", category: "交互", needsTarget: true, needsValue: false, targetLabel: "定位器", valueLabel: "", template: (t) => `await activeLocator(${lit(t)}).scrollIntoViewIfNeeded();` },
  { id: "waitForUrl", label: "等待地址", category: "等待", needsTarget: false, needsValue: true, targetLabel: "", valueLabel: "地址或模式", template: (_t, v) => `await page.waitForURL(${lit(v)});` },
  { id: "expectChecked", label: "断言已勾选", category: "断言", needsTarget: true, needsValue: false, targetLabel: "定位器", valueLabel: "", template: (t) => `await expect(activeLocator(${lit(t)})).toBeChecked();` },
  { id: "expectEnabled", label: "断言可用", category: "断言", needsTarget: true, needsValue: false, targetLabel: "定位器", valueLabel: "", template: (t) => `await expect(activeLocator(${lit(t)})).toBeEnabled();` },
  { id: "expectValue", label: "断言输入值", category: "断言", needsTarget: true, needsValue: true, targetLabel: "定位器", valueLabel: "期望值", template: (t, v) => `await expect(activeLocator(${lit(t)})).toHaveValue(${lit(v)});` },
  { id: "unsupported", label: "待转换步骤", category: "其他", needsTarget: false, needsValue: true, targetLabel: "", valueLabel: "原始 Playwright 语句", template: (_t, v) => `throw new Error(${lit(`待转换步骤不能执行：${v}`)});` },
];

KEYWORDS.push(...EXTENDED_KEYWORDS);

function getKeyword(id) {
  return KEYWORDS.find((k) => k.id === id) || KEYWORDS[0];
}

/** 可通过 IPC 传给工作台的元数据（去掉不可序列化的模板函数） */
function keywordMeta() {
  return KEYWORDS.map(({ template, ...rest }) => ({ ...rest }));
}

function describeStep(step) {
  const kw = getKeyword(step.keyword);
  const parts = [kw.label];
  if (kw.needsTarget && step.target) parts.push(step.target);
  if (kw.needsValue && step.value) parts.push(`「${step.value}」`);
  return parts.join(" · ");
}

/** 条件 / 循环积木的缩进层级 */
function stepDepths(steps) {
  let depth = 0;
  return (steps || []).map((s) => {
    const kw = getKeyword(s.keyword);
    if (kw.closesBlock || kw.id === "elseBranch") depth = Math.max(0, depth - 1);
    const own = depth;
    if (kw.opensBlock || kw.id === "elseBranch") depth += 1;
    return own;
  });
}

function generateScript(caseName, steps) {
  const list = steps || [];
  const depths = stepDepths(list);
  const body = list
    .map((s, i) => {
      const pad = "  ".repeat((depths[i] ?? 0) + 1);
      return `${pad}// ${describeStep(s)}\n${pad}${getKeyword(s.keyword).template(s.target || "", s.value || "")}`;
    })
    .join("\n");
  return `import { test, expect } from '@playwright/test';

test('${String(caseName || "本机用例").replace(/'/g, "\\'")}', async ({ page }) => {
  const framePath = [];
  const activeLocator = (selector) => {
    let scope = page;
    for (const frameSelector of framePath) scope = scope.frameLocator(frameSelector);
    return scope.locator(selector);
  };
${body || "  // 暂无步骤"}
});
`;
}

module.exports = { KEYWORDS, PRESS_KEYS, keywordMeta, getKeyword, describeStep, stepDepths, generateScript };
