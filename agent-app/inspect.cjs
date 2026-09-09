/**
 * AI 页面元素定位：用本机 Playwright 打开页面，抓取可交互元素及候选定位器。
 * 只读取页面结构，不做任何点击或输入。
 */
const { resolveBrowser } = require("./runner.cjs");

const MAX_ELEMENTS = 120;

async function inspectPage(job, log = () => {}) {
  const { chromium } = require("playwright-core");
  const executablePath = typeof resolveBrowser === "function" ? await resolveBrowser(log) : undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage();
    log(`打开页面 ${job.url}`);
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(800);

    const elements = await page.evaluate((max) => {
      const pick = (el) => {
        const attr = {};
        for (const name of ["id", "name", "type", "placeholder", "aria-label", "data-testid", "href"]) {
          const v = el.getAttribute(name);
          if (v) attr[name] = v.slice(0, 120);
        }
        const text = (el.innerText || el.value || "").trim().replace(/\s+/g, " ").slice(0, 120);
        const role = el.getAttribute("role") || "";
        let locator = "";
        if (attr["data-testid"]) locator = `[data-testid="${attr["data-testid"]}"]`;
        else if (attr["id"]) locator = `#${attr["id"]}`;
        else if (attr["aria-label"]) locator = `[aria-label="${attr["aria-label"]}"]`;
        else if (attr["name"]) locator = `[name="${attr["name"]}"]`;
        else if (attr["placeholder"]) locator = `[placeholder="${attr["placeholder"]}"]`;
        else if (text) locator = `text=${text.slice(0, 40)}`;
        else locator = el.tagName.toLowerCase();
        return {
          tag: el.tagName.toLowerCase(),
          role,
          text,
          locator,
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
    return { elements };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { inspectPage };
