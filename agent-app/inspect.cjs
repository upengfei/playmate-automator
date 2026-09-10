/**
 * AI 页面元素定位：用本机 Playwright 打开页面，抓取可交互元素、候选定位器与页面截图。
 * 只读取页面结构，不做任何点击或输入。
 * 失败时按原因分类决定是否重试；只有浏览器真的崩溃才重建浏览器。
 */
const browsers = require("./browsers.cjs");

const MAX_ELEMENTS = 120;
/** 截图 base64 上限（约 600KB），超出则降低质量重截 */
const MAX_SHOT_CHARS = 600 * 1024;
/** 默认重试策略：平台没有下发时使用 */
const DEFAULT_RETRY = { maxAttempts: 3, delaysMs: [2000, 5000, 10000] };

/** 失败原因分类 → 中文说明与下一步建议 */
const FAIL_TEXT = {
  blocked: "页面被拦截或需要登录，抓取到的不是目标页面。建议在客户端窗口里先完成登录，再重新抓取。",
  captcha: "页面出现验证码或人机验证，需要人工在客户端窗口里完成验证后再抓取。",
  crash: "浏览器崩溃或页面被关闭，已重建浏览器仍未成功。建议确认本机内存充足后重试。",
  timeout: "页面加载超时或网络不通，多次重试仍未打开页面。建议检查网络与页面地址。",
  structure: "页面结构异常，元素抓取脚本执行失败。可能是页面还在渲染或使用了特殊框架。",
  launch: "无法启动本机浏览器内核，请在客户端里重新下载浏览器内核后重试。",
  unknown: "抓取失败，原因未知，可稍后重试一次。",
};

/** 常驻的浏览器与页面：同一页面已打开时直接复用，不再重复启动 */
let shared = { browser: null, page: null };

/** 归一化地址：忽略 hash 差异，判断是不是同一个页面 */
function sameUrl(a, b) {
  const norm = (v) => String(v || "").split("#")[0].replace(/\/$/, "").toLowerCase();
  return norm(a) === norm(b) && norm(a) !== "";
}

/** 等页面进入可交互状态（DOM 就绪 + 网络基本空闲） */
async function waitReady(page, log) {
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    log("页面仍有后台请求，按当前内容继续抓取");
  });
  await page.waitForFunction(() => document.readyState !== "loading", null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

/** 按错误信息判断失败原因分类 */
function classifyError(err) {
  const msg = String((err && err.message) || err || "").toLowerCase();
  if (err && err.failKind) return err.failKind;
  if (/target (page|closed)|browser has been closed|crashed|disconnected|session closed/.test(msg)) return "crash";
  if (/timeout|net::err_(name_not_resolved|connection|internet|address)/.test(msg)) return "timeout";
  if (/executable doesn't exist|browsertype\.launch|failed to launch/.test(msg)) return "launch";
  if (/evaluate|evaluation failed|illegal invocation/.test(msg)) return "structure";
  return "unknown";
}

/** 检查页面是不是被拦截或出现验证码 */
async function detectBlock(page, status) {
  if (status === 403 || status === 401) return "blocked";
  try {
    const found = await page.evaluate(() => {
      const html = document.documentElement.innerHTML.toLowerCase();
      const text = (document.body?.innerText || "").toLowerCase();
      const captcha =
        /recaptcha|hcaptcha|g-recaptcha|cf-challenge|turnstile|geetest|captcha/.test(html) ||
        /验证码|人机验证|请完成验证|滑动验证/.test(text);
      const blocked =
        /访问被拒绝|access denied|forbidden|请先登录|need to sign in|登录后继续/.test(text) ||
        /^\s*(unusual traffic|are you a robot)/.test(text);
      const loginUrl = /\/(login|signin|sign-in|sso|auth)(\/|\?|$)/.test(location.pathname + location.search);
      const loginForm = Boolean(document.querySelector('input[type="password"]'));
      return { captcha, blocked: blocked || (loginUrl && loginForm) };
    });
    if (found.captcha) return "captcha";
    if (found.blocked) return "blocked";
  } catch {
    /* 页面不可读时交给外层错误分类 */
  }
  return "";
}

/** 拿到一个可用的浏览器实例（forceNew 时重建） */
async function ensureBrowser(log, forceNew = false) {
  let browser = shared.browser;
  if (browser && !browser.isConnected()) browser = null;
  if (forceNew && shared.browser) {
    await closeInspectBrowser();
    browser = null;
  }
  if (!browser) {
    log("准备 chromium 浏览器内核…");
    await browsers.ensure("chromium", log);
    const { chromium } = require("playwright-core");
    browser = await chromium.launch({ headless: true });
    shared = { browser, page: null };
  }
  return browser;
}

/** 单次抓取尝试 */
async function attemptInspect(job, log, forceNewBrowser) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsers.BROWSERS_DIR;
  const viewport = { width: 1440, height: 900 };
  const browser = await ensureBrowser(log, forceNewBrowser);

  let page = shared.page;
  if (page && page.isClosed()) page = null;
  if (!page) {
    page = await browser.newPage({ viewport });
    shared.page = page;
  }

  let status = 0;
  if (sameUrl(page.url(), job.url)) {
    log(`页面已打开，直接复用：${job.url}`);
  } else {
    log(`页面未打开，正在打开并等待加载：${job.url}`);
    const res = await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    status = res ? res.status() : 0;
  }
  await waitReady(page, log);

  const block = await detectBlock(page, status);
  if (block) {
    const err = new Error(FAIL_TEXT[block]);
    err.failKind = block;
    throw err;
  }

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
}

/**
 * 抓取页面元素：失败时按原因分类自动重试，重试次数用尽后抛出带原因的错误。
 * 只有浏览器崩溃才会重建浏览器，其他情况保留已打开的页面继续复用。
 */
async function inspectPage(job, log = () => {}) {
  const policy = job.retry && job.retry.maxAttempts ? job.retry : DEFAULT_RETRY;
  const maxAttempts = Math.max(1, Math.min(5, policy.maxAttempts));
  const delays = Array.isArray(policy.delaysMs) && policy.delaysMs.length ? policy.delaysMs : DEFAULT_RETRY.delaysMs;

  let lastKind = "unknown";
  let lastDetail = "";
  let forceNewBrowser = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await attemptInspect(job, log, forceNewBrowser);
      return { ...result, attempt };
    } catch (err) {
      lastKind = classifyError(err);
      lastDetail = String((err && err.message) || err || "");
      log(`第 ${attempt} 次抓取失败（${lastKind}）：${lastDetail}`);

      // 被拦截、验证码、缺内核：重试没有意义，直接回报
      if (lastKind === "blocked" || lastKind === "captcha" || lastKind === "launch") break;
      // 页面结构异常只多试一次
      if (lastKind === "structure" && attempt >= 2) break;
      // 只有崩溃才重建浏览器，其他情况保留已打开的页面
      forceNewBrowser = lastKind === "crash";
      if (forceNewBrowser) log("浏览器已崩溃，正在重建浏览器后重试");

      if (attempt >= maxAttempts) break;
      const wait = delays[Math.min(attempt - 1, delays.length - 1)];
      log(`${Math.round(wait / 1000)} 秒后进行第 ${attempt + 1} 次重试`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  const error = new Error(FAIL_TEXT[lastKind] || FAIL_TEXT.unknown);
  error.failKind = lastKind;
  error.failDetail = lastDetail;
  error.attempt = maxAttempts;
  throw error;
}

/** 关闭常驻抓取浏览器（客户端退出或浏览器崩溃时调用） */
async function closeInspectBrowser() {
  const b = shared.browser;
  shared = { browser: null, page: null };
  if (b) await b.close().catch(() => {});
}

module.exports = { inspectPage, closeInspectBrowser, FAIL_TEXT };
