/* 真实 Playwright 执行内核：逐步执行用例步骤（支持条件 / 循环积木），输出真实结果与产物 */
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const browsers = require("./browsers.cjs");

const ARTIFACT_DIR = path.join(app.getPath("userData"), "artifacts");

function pw() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsers.BROWSERS_DIR;
  return require("playwright-core");
}

function locator(page, target) {
  const t = String(target || "").trim();
  if (!t) throw new Error("缺少元素定位器");
  return page.locator(t);
}

/* ---------- 循环变量 ---------- */

const PLACEHOLDER =
  /\$\{\s*([A-Za-z0-9_\-.\u4e00-\u9fa5]+)\s*\}|\{\{\s*([A-Za-z0-9_\-.\u4e00-\u9fa5]+)\s*\}\}/g;

/** 把步骤文本里的循环变量替换成当前循环上下文的取值 */
function applyLoop(text, loop) {
  const raw = String(text ?? "");
  if (!raw || !loop) return raw;
  const map = {
    LOOP_INDEX: String(loop.index),
    循环序号: String(loop.index),
    LOOP_ITERATION: String(loop.index + 1),
    当前循环: String(loop.index + 1),
    LOOP_COUNT: String(loop.count),
    循环次数: String(loop.count),
  };
  return raw.replace(PLACEHOLDER, (m, a, b) => {
    const key = String(a ?? b ?? "").trim();
    return key in map ? map[key] : m;
  });
}

/* ---------- 积木解析：把扁平步骤解析成条件 / 循环嵌套结构 ---------- */

const IF_OPEN = new Set(["ifVisible", "ifNotVisible", "ifText"]);
const LOOP_OPEN = new Set(["repeat", "whileVisible"]);
const CLOSERS = new Set(["endIf", "endLoop"]);

function parseNodes(steps, from = 0, expectedEnd = null, allowElse = false) {
  const nodes = [];
  let i = from;
  while (i < steps.length) {
    const s = steps[i] || {};
    const kw = s.keyword;
    if (CLOSERS.has(kw)) {
      if (kw !== expectedEnd) throw new Error(`步骤 ${i + 1}：${kw} 没有匹配的开始积木`);
      return { nodes, next: i + 1 };
    }
    if (kw === "elseBranch") {
      if (!allowElse) throw new Error(`步骤 ${i + 1}：否则分支没有匹配的条件积木`);
      return { nodes, next: i, atElse: true };
    }
    if (IF_OPEN.has(kw) || LOOP_OPEN.has(kw)) {
      const end = IF_OPEN.has(kw) ? "endIf" : "endLoop";
      const first = parseNodes(steps, i + 1, end, IF_OPEN.has(kw));
      const body = first.nodes;
      let elseBody = [];
      let next = first.next;
      if (first.atElse) {
        const second = parseNodes(steps, first.next + 1, end);
        elseBody = second.nodes;
        next = second.next;
      }
      nodes.push({
        type: LOOP_OPEN.has(kw) ? "loop" : "if",
        index: i,
        step: s,
        body,
        elseBody,
      });
      i = next;
      continue;
    }
    nodes.push({ type: "step", index: i, step: s });
    i++;
  }
  if (expectedEnd) throw new Error(`步骤 ${from}：缺少 ${expectedEnd} 结束积木`);
  return { nodes, next: i };
}

/**
 * 执行一条用例。
 * @param {{id?:string,name:string,steps:Array,browser?:string,headed?:boolean,timeoutMs?:number}} testCase
 * @param {(e:object)=>void} emit
 */
async function runCase(testCase, emit = () => {}) {
  const startedAt = Date.now();
  let browser;
  let page;
  let failedShot = "";
  const stepResults = [];
  try {
    const browserName = String(testCase.browser || "chromium").toLowerCase();
    if (!["chromium", "firefox", "webkit"].includes(browserName)) {
      throw new Error(`不支持的浏览器：${testCase.browser}`);
    }
    const { nodes } = parseNodes(testCase.steps || []);
    if (!nodes.length) throw new Error("用例没有可执行步骤");
    emit({ type: "log", level: "info", text: `准备 ${browserName} 浏览器内核…` });
    await browsers.ensure(browserName, (t) => emit({ type: "log", level: "info", text: t }));
    const engine = pw()[browserName];
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const headless = testCase.headed ? false : true;
    browser = await engine.launch({ headless });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    page.setDefaultTimeout(testCase.timeoutMs || 15000);
    emit({
      type: "log",
      level: "success",
      text: `已启动真实 ${browserName} 实例（${headless ? "无头模式" : "有头模式"}）`,
    });

    // An explicit leading navigation takes precedence over the default URL.
    if (testCase.startUrl && nodes[0]?.step.keyword !== "goto") {
      await page.goto(testCase.startUrl, { waitUntil: "domcontentloaded" });
    }
    await execNodes(nodes, { page, emit, stepResults, loop: null });

    const shot = path.join(ARTIFACT_DIR, `pass-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    await context.close();
    return {
      status: "passed",
      durationMs: Date.now() - startedAt,
      steps: stepResults,
      screenshot: shot,
    };
  } catch (err) {
    return {
      status: "failed",
      durationMs: Date.now() - startedAt,
      steps: stepResults,
      error: String((err && err.message) || err),
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function execNodes(nodes, ctx) {
  for (const node of nodes) {
    if (node.type === "step") {
      await runOne(node, ctx, () => execStep(ctx.page, resolveStep(node.step, ctx.loop)));
      continue;
    }
    if (node.type === "if") {
      let taken = false;
      await runOne(node, ctx, async () => {
        taken = await evalCondition(ctx.page, resolveStep(node.step, ctx.loop));
        ctx.emit({
          type: "log",
          level: "info",
          text: `条件「${node.step.keyword}」判定为 ${taken ? "成立" : "不成立"}`,
        });
      });
      await execNodes(taken ? node.body : node.elseBody || [], ctx);
      continue;
    }
    // 循环积木
    const s = resolveStep(node.step, ctx.loop);
    const max = Number(s.value) > 0 ? Number(s.value) : node.step.keyword === "repeat" ? 3 : 10;
    await runOne(node, ctx, async () => {
      ctx.emit({ type: "log", level: "info", text: `进入循环，最多 ${max} 次` });
    });
    for (let i = 0; i < max; i++) {
      if (node.step.keyword === "whileVisible") {
        const visible = await locator(ctx.page, s.target)
          .first()
          .isVisible()
          .catch(() => false);
        if (!visible) {
          ctx.emit({ type: "log", level: "info", text: `元素不再可见，循环在第 ${i + 1} 次前结束` });
          break;
        }
      }
      ctx.emit({ type: "log", level: "info", text: `循环第 ${i + 1}/${max} 次` });
      await execNodes(node.body, { ...ctx, loop: { index: i, count: max } });
    }
  }
}

function resolveStep(step, loop) {
  return {
    ...step,
    target: applyLoop(step.target || "", loop),
    value: applyLoop(step.value || "", loop),
  };
}

/** 统一的单步执行包装：负责发出步骤事件、记录耗时与失败截图 */
async function runOne(node, ctx, fn) {
  const t0 = Date.now();
  ctx.emit({ type: "step-start", index: node.index, step: node.step });
  try {
    await fn();
    const durationMs = Date.now() - t0;
    ctx.stepResults.push({
      index: node.index,
      keyword: node.step.keyword,
      status: "passed",
      durationMs,
    });
    ctx.emit({ type: "step-end", index: node.index, status: "passed", durationMs });
  } catch (err) {
    const durationMs = Date.now() - t0;
    const shot = path.join(ARTIFACT_DIR, `fail-${Date.now()}.png`);
    await ctx.page.screenshot({ path: shot }).catch(() => {});
    const error = String((err && err.message) || err);
    ctx.stepResults.push({
      index: node.index,
      keyword: node.step.keyword,
      status: "failed",
      durationMs,
      error,
    });
    ctx.emit({ type: "step-end", index: node.index, status: "failed", durationMs, error, shot });
    throw err;
  }
}

async function evalCondition(page, s) {
  const target = s.target || "";
  const value = s.value || "";
  switch (s.keyword) {
    case "ifVisible":
      return await locator(page, target)
        .first()
        .isVisible()
        .catch(() => false);
    case "ifNotVisible":
      return !(await locator(page, target)
        .first()
        .isVisible()
        .catch(() => false));
    case "ifText": {
      const text = await locator(page, target)
        .first()
        .textContent()
        .catch(() => "");
      return String(text || "").includes(value);
    }
    default:
      throw new Error(`暂不支持的条件关键字：${s.keyword}`);
  }
}

async function execStep(page, s) {
  const target = s.target || "";
  const value = s.value || "";
  switch (s.keyword) {
    case "goto":
      await page.goto(value || target, { waitUntil: "domcontentloaded" });
      return;
    case "click":
      await locator(page, target).click();
      return;
    case "fill":
      await locator(page, target).fill(value);
      return;
    case "press":
      if (target.trim()) await locator(page, target).press(value || "Enter");
      else await page.keyboard.press(value || "Enter");
      return;
    case "select":
      await locator(page, target).selectOption(value);
      return;
    case "hover":
      await locator(page, target).hover();
      return;
    case "waitFor":
      await locator(page, target).waitFor({ state: "visible" });
      return;
    case "wait":
      await page.waitForTimeout(Number(value || 1000));
      return;
    case "expectText": {
      const text = (await locator(page, target).first().innerText()).trim();
      if (!text.includes(value)) throw new Error(`断言失败：期望包含「${value}」，实际「${text}」`);
      return;
    }
    case "expectUrl": {
      const url = page.url();
      if (!url.includes(value)) throw new Error(`断言失败：期望地址包含「${value}」，实际「${url}」`);
      return;
    }
    case "expectVisible":
      if (!(await locator(page, target).first().isVisible())) {
        throw new Error(`断言失败：元素 ${target} 不可见`);
      }
      return;
    case "screenshot": {
      const p = path.join(ARTIFACT_DIR, value ? `${Date.now()}-${path.basename(value)}` : `shot-${Date.now()}.png`);
      await page.screenshot({ path: p });
      return;
    }
    default:
      throw new Error(`暂不支持的关键字：${s.keyword}`);
  }
}

module.exports = { runCase, ARTIFACT_DIR, applyLoop, parseNodes };
