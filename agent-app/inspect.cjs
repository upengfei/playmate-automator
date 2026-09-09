/**
 * AI 页面元素定位：用本机 Playwright 打开页面，抓取可交互元素、候选定位器与页面截图。
 * 只读取页面结构，不做任何点击或输入。
 */
const browsers = require("./browsers.cjs");

const MAX_ELEMENTS = 120;
/** 截图 base64 上限（约 600KB），超出则降低质量重截 */
const MAX_SHOT_CHARS = 600 * 1024;

async function inspectPage(job, log = () => {}) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsers.BROWSERS_DIR;
  log("准备 chromium 浏览器内核…");
  await browsers.ensure("chromium", log);
  const { chromium } = require("playwright-core");
  const browser = await chromium.launch({ headless: true });
  const viewport = { width: 1440, height: 900 };
  try {
    const page = await browser.newPage({ viewport });
    log(`打开页面 ${job.url}`);
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(800);

    const elements = await page.evaluate((max) => {
      const esc = (v) => String(v).replace(/"/g, '\\"');
      const unique = (sel) => {
        try {
          return document.querySelectorAll(sel).length === 1;
        } catch {
          return false;
        }
      };
      const pick = (el) => {
        const attr = {};
        const names = [
          "id",
          "name",
          "type",
          "placeholder",
          "aria-label",
          "data-testid",
          "href",
          "title",
          "alt",
          "class",
          "value",
        ];
        for (const name of names) {
          const v = el.getAttribute(name);
          if (v) attr[name] = v.slice(0, 120);
        }
        const text = (el.innerText || el.value || "").trim().replace(/\s+/g, " ").slice(0, 120);
        const role = el.getAttribute("role") || "";
        const box = (() => {
          const r = el.getBoundingClientRect();
          return {
            x: Math.round(r.x),
            y: Math.round(r.y),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        })();

        // 候选定位方式，按稳定性从高到低
        const candidates = [];
        if (attr["data-testid"])
          candidates.push({ kind: "testid", value: `[data-testid="${esc(attr["data-testid"])}"]` });
        if (attr["id"] && !/^[0-9]/.test(attr["id"]))
          candidates.push({ kind: "id", value: `#${attr["id"]}` });
        if (attr["aria-label"])
          candidates.push({ kind: "aria-label", value: `[aria-label="${esc(attr["aria-label"])}"]` });
        if (attr["name"]) candidates.push({ kind: "name", value: `[name="${esc(attr["name"])}"]` });
        if (attr["placeholder"])
          candidates.push({ kind: "placeholder", value: `[placeholder="${esc(attr["placeholder"])}"]` });
        if (text) candidates.push({ kind: "text", value: `text=${text.slice(0, 40)}` });
        candidates.push({ kind: "tag", value: el.tagName.toLowerCase() });
        for (const c of candidates) c.unique = unique(c.value.startsWith("text=") ? "" : c.value);

        const best = candidates.find((c) => c.unique) || candidates[0];
        return {
          tag: el.tagName.toLowerCase(),
          role,
          text,
          locator: best.value,
          recommended: best.kind,
          unique: Boolean(best.unique),
          disabled: Boolean(el.disabled),
          box,
          candidates,
          attributes: attr,
        };
      };
      const nodes = Array.from(
        document.querySelectorAll(
          "a,button,input,select,textarea,[role=button],[role=link],[role=tab],h1,h2,h3,[data-testid]",
        ),
      ).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return nodes.slice(0, max).map(pick);
    }, MAX_ELEMENTS);

    log(`抓取到 ${elements.length} 个可交互元素`);

    let screenshot = "";
    if (job.screenshot !== false) {
      for (const quality of [60, 40, 25]) {
        const buf = await page.screenshot({ type: "jpeg", quality, fullPage: false });
        screenshot = buf.toString("base64");
        if (screenshot.length <= MAX_SHOT_CHARS) break;
      }
      if (screenshot.length > MAX_SHOT_CHARS) {
        log("页面截图仍然过大，本次不回传截图");
        screenshot = "";
      } else {
        log(`已截取页面截图（${Math.round(screenshot.length / 1024)} KB）`);
      }
    }

    return { elements, screenshot, viewport };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { inspectPage };
