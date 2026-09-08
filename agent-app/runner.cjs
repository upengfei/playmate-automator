/* 真实 Playwright 执行内核：逐步执行用例步骤，输出真实结果与产物 */
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
  if (t.startsWith("text=") || t.startsWith("role=") || t.startsWith("//") || t.startsWith("(")) {
    return page.locator(t);
  }
  return page.locator(t);
}

/**
 * 执行一条用例。
 * @param {{id?:string,name:string,steps:Array,browser?:string,headed?:boolean,timeoutMs?:number}} testCase
 * @param {(e:{type:string,index?:number,step?:object,level?:string,text?:string,status?:string,durationMs?:number,error?:string,shot?:string})=>void} emit
 */
async function runCase(testCase, emit = () => {}) {
  const browserName = testCase.browser === "firefox" || testCase.browser === "webkit" ? testCase.browser : "chromium";
  emit({ type: "log", level: "info", text: `准备 ${browserName} 浏览器内核…` });
  await browsers.ensure(browserName, (t) => emit({ type: "log", level: "info", text: t }));

  const { chromium, firefox, webkit } = pw();
  const engine = { chromium, firefox, webkit }[browserName];
  const startedAt = Date.now();
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  let browser;
  const stepResults = [];
  try {
    browser = await engine.launch({ headless: testCase.headed ? false : true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(testCase.timeoutMs || 15000);
    emit({ type: "log", level: "success", text: `已启动真实 ${browserName} 实例` });

    const steps = testCase.steps || [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const t0 = Date.now();
      emit({ type: "step-start", index: i, step: s });
      try {
        await execStep(page, s);
        const durationMs = Date.now() - t0;
        stepResults.push({ index: i, keyword: s.keyword, status: "passed", durationMs });
        emit({ type: "step-end", index: i, status: "passed", durationMs });
      } catch (err) {
        const durationMs = Date.now() - t0;
        const shot = path.join(ARTIFACT_DIR, `fail-${Date.now()}.png`);
        await page.screenshot({ path: shot }).catch(() => {});
        stepResults.push({
          index: i,
          keyword: s.keyword,
          status: "failed",
          durationMs,
          error: String(err.message || err),
        });
        emit({
          type: "step-end",
          index: i,
          status: "failed",
          durationMs,
          error: String(err.message || err),
          shot,
        });
        throw err;
      }
    }

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
      error: String(err.message || err),
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
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
      await locator(page, target).press(value || "Enter");
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
      const p = path.join(ARTIFACT_DIR, `shot-${Date.now()}.png`);
      await page.screenshot({ path: p });
      return;
    }
    default:
      throw new Error(`暂不支持的关键字：${s.keyword}`);
  }
}

module.exports = { runCase, ARTIFACT_DIR };
