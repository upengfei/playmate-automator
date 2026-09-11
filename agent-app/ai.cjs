/* 客户端 AI 助手：对话生成/修改关键字步骤，并从本机抓取的元素清单里推荐定位方式。
 *
 * 接模型的优先级：
 * 1. 本机模型（内核与维护 → AI 助手设置里填了 Base URL / API Key / 模型名）
 * 2. 平台代理（已配置节点令牌时，用令牌转发给平台配置的模型）
 *
 * 生成结果只写本地草稿，仍由用户点「上传到平台」才入库。
 */
// 延迟加载：platform.cjs 依赖 Electron 运行时，测试替身里不能在模块加载时求值
const platform = () => require("./platform.cjs");
const keywords = require("./keywords.cjs");

/** 本机 AI 设置默认值（存在 config.json 里，不上传平台） */
function defaults() {
  return {
    aiMode: "auto", // auto=有本机模型就用本机，否则用平台代理；local=只用本机；platform=只用平台
    aiBaseUrl: "",
    aiApiKey: "",
    aiModel: "",
    aiModels: [],
    inspectScreenshot: true,
    inspectCacheMinutes: 10,
    inspectRetries: 3,
    inspectHeadless: true, // 抓取元素默认无头；可在设置里改成有头，或单次覆盖
  };
}

function settings() {
  const c = platform().getConfig();
  const d = defaults();
  const out = {};
  for (const k of Object.keys(d)) out[k] = c[k] === undefined ? d[k] : c[k];
  return out;
}

function save(patch = {}) {
  const allow = Object.keys(defaults());
  const clean = {};
  for (const k of allow) if (patch[k] !== undefined) clean[k] = patch[k];
  if (clean.aiBaseUrl) clean.aiBaseUrl = String(clean.aiBaseUrl).replace(/\/$/, "");
  if (clean.inspectCacheMinutes !== undefined)
    clean.inspectCacheMinutes = Math.max(0, Math.min(1440, Number(clean.inspectCacheMinutes) || 0));
  if (clean.inspectRetries !== undefined)
    clean.inspectRetries = Math.max(1, Math.min(5, Number(clean.inspectRetries) || 1));
  platform().saveConfig(clean);
  return settings();
}

/** 当前实际会走哪条链路 */
function route() {
  const s = settings();
  const localReady = Boolean(s.aiBaseUrl && s.aiModel);
  const platformReady = Boolean(platform().getConfig().token);
  if (s.aiMode === "local") return { kind: "local", ready: localReady };
  if (s.aiMode === "platform") return { kind: "platform", ready: platformReady };
  if (localReady) return { kind: "local", ready: true };
  return { kind: "platform", ready: platformReady };
}

/* ----------------------------- 提示词与解析 ----------------------------- */

function keywordReference() {
  return keywords
    .keywordMeta()
    .map(
      (k) =>
        `${k.id}（${k.label}｜${k.category}${k.needsTarget ? `｜target=${k.targetLabel || "定位器"}` : ""}${
          k.needsValue ? `｜value=${k.valueLabel || "取值"}` : ""
        }${k.opensBlock ? "｜开启代码块" : ""}${k.closesBlock ? "｜结束代码块" : ""}）`,
    )
    .join("\n");
}

function systemPrompt() {
  return `你是 PlayFlow 客户端里的 AI 助手，帮助测试人员在本机录制与编排 Playwright 用例，全程使用简体中文。

你的任务：
1. 根据用户的中文描述生成或修改一条用例的关键字步骤。
2. 用户提供页面元素清单时，从清单里挑选最稳定的定位方式（优先 role/text/data-testid，避免长 CSS 路径与随机 class），并说明理由。
3. 用户要求修改时，在上一版步骤基础上迭代，不要凭空重写。

约束：
- 只能使用下面列出的关键字 id。
- 条件（ifVisible / ifNotVisible / ifText，可配 elseBranch）必须以 endIf 闭合；循环（repeat / whileVisible）必须以 endLoop 闭合。
- 需要参数化的取值写成 \${参数名}；循环里可用 \${LOOP_INDEX}、\${当前循环}、\${循环次数}。
- 用例结尾建议加一条断言，让结果可判定。

回复格式（必须严格遵守）：先用两三句中文说明思路，然后另起一行输出一个 JSON 代码块：
\`\`\`json
{"name":"用例名称","startUrl":"起始地址","note":"说明或风险提示","steps":[{"keyword":"关键字id","target":"定位器或空","value":"取值或空"}]}
\`\`\`
只在需要生成或修改步骤时输出 JSON；只是解释问题时不要输出 JSON。

可用关键字：
${keywordReference()}`;
}

function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text || "");
  const body = fenced && fenced[1] ? fenced[1].trim() : "";
  if (body.startsWith("{")) return body;
  const start = String(text || "").indexOf("{");
  const end = String(text || "").lastIndexOf("}");
  return start >= 0 && end > start ? String(text).slice(start, end + 1) : "";
}

function stripJson(text) {
  return String(text || "")
    .replace(/```(?:json)?[\s\S]*?```/gi, "")
    .trim();
}

/** 解析模型回复里的 JSON，并按关键字白名单过滤 */
function parseDraft(text) {
  const raw = extractJson(text);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return sanitizeDraft(parsed);
}

/** 无论草稿来自本机模型还是平台代理，都执行同一套关键字白名单与结构清洗。 */
function sanitizeDraft(parsed) {
  const list = Array.isArray(parsed && parsed.steps) ? parsed.steps : [];
  if (!list.length) return null;
  const known = keywords
    .keywordMeta()
    .map((k) => k.id)
    .filter((id) => id !== "unsupported");
  const rejected = [];
  const steps = [];
  list.forEach((s) => {
    const keyword = String((s && s.keyword) || "").trim();
    if (!known.includes(keyword)) {
      if (keyword) rejected.push(keyword);
      return;
    }
    steps.push({ keyword, target: String((s && s.target) || ""), value: String((s && s.value) || "") });
  });
  if (!steps.length) return null;
  return {
    name: String((parsed && parsed.name) || "").trim() || "AI 生成用例",
    startUrl: String((parsed && parsed.startUrl) || "").trim(),
    note: String((parsed && parsed.note) || "").trim(),
    steps,
    rejected,
  };
}

/* -------------------------------- 模型调用 -------------------------------- */

/** 直连本机 OpenAI 兼容接口 */
async function callLocal(messages, timeoutMs = 180_000) {
  const s = settings();
  const url = `${s.aiBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(s.aiApiKey ? { authorization: `Bearer ${s.aiApiKey}` } : {}),
      },
      body: JSON.stringify({
        model: s.aiModel,
        messages: [{ role: "system", content: systemPrompt() }, ...messages],
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(explain(res.status, text));
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("本机模型返回的不是合法 JSON，请确认接口是 OpenAI 兼容格式");
    }
    const content =
      (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    if (!content.trim()) throw new Error("本机模型返回了空内容，请检查模型名称是否正确");
    return { text: content, label: `本机模型 ${s.aiModel}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 转发给平台代理（用节点令牌鉴权） */
async function callPlatform(messages) {
  const c = platform().getConfig();
  if (!c.token) throw new Error("未配置节点令牌，无法使用平台模型；可在 AI 助手设置里填写本机模型");
  const data = await platform().aiChat({ messages });
  return { text: data.reply || "", label: data.label ? `平台模型 ${data.label}` : "平台模型", draft: data.draft };
}

function explain(status, body) {
  const raw = String(body || "").slice(0, 300);
  if (status === 401 || status === 403) return "模型接口拒绝了 API Key，请检查密钥";
  if (status === 404) return "模型接口地址不存在，请检查 Base URL（通常以 /v1 结尾）";
  if (status === 429) return "模型接口达到调用频率上限，请稍后重试";
  return `模型接口返回 ${status}：${raw}`;
}

/**
 * 一轮对话：messages 为 [{role:'user'|'assistant', content}]。
 * 返回 { reply, draft, label }；draft 为 null 表示这轮只是解释，没有生成步骤。
 */
async function chat(messages = []) {
  const clean = messages
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .slice(-24)
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.slice(0, 20_000) }));
  if (!clean.length) throw new Error("请先输入你想让 AI 做什么");

  const target = route();
  if (!target.ready) {
    throw new Error(
      target.kind === "local"
        ? "本机模型未配置完整，请在「内核与维护 → AI 助手设置」填写 Base URL 与模型名"
        : "未连接平台且未配置本机模型，请在「内核与维护 → AI 助手设置」填写本机模型",
    );
  }

  const result = target.kind === "local" ? await callLocal(clean) : await callPlatform(clean);
  const draft = result.draft !== undefined && result.draft !== null ? sanitizeDraft(result.draft) : parseDraft(result.text);
  return {
    reply: stripJson(result.text) || result.text || "（模型没有返回文字说明）",
    draft: draft || null,
    label: result.label,
  };
}

/** 连接测试：真发一次请求 */
async function test() {
  const target = route();
  if (!target.ready) return { ok: false, message: "当前链路不可用：本机模型未填完整，且没有平台节点令牌" };
  try {
    const r = await chat([{ role: "user", content: "只回复“连接正常”四个字，不要输出 JSON。" }]);
    return { ok: true, message: `${r.label} 连接正常：${r.reply.slice(0, 60)}` };
  } catch (err) {
    return { ok: false, message: (err && err.message) || String(err) };
  }
}

/** 本机抓取页面元素，参数取本机 AI 设置；options.headless 可覆盖本次 */
async function inspect(url, log = () => {}, options = {}) {
  const s = settings();
  const headless = options && options.headless !== undefined ? options.headless !== false : s.inspectHeadless !== false;
  const { inspectPage } = require("./inspect.cjs");
  const result = await inspectPage(
    { url, screenshot: s.inspectScreenshot, headless, retry: { maxAttempts: s.inspectRetries } },
    log,
  );
  return {
    url,
    headless,
    attempt: result.attempt,
    elements: (result.elements || []).slice(0, 60),
    screenshot: s.inspectScreenshot ? result.screenshot || "" : "",
  };
}

/** 把元素清单压成给模型看的文本 */
function describeElements(elements = []) {
  return elements
    .slice(0, 60)
    .map((e, i) => {
      const parts = [
        `#${i + 1}`,
        e.role ? `role=${e.role}` : "",
        e.attributes && e.attributes.name ? `name=${e.attributes.name}` : "",
        e.text ? `text=${String(e.text).slice(0, 40)}` : "",
        e.attributes && e.attributes["data-testid"] ? `data-testid=${e.attributes["data-testid"]}` : "",
        e.locator ? `推荐定位=${e.locator}` : "",
        Array.isArray(e.candidates) && e.candidates.length
          ? `候选定位=${e.candidates
              .slice(0, 3)
              .map((candidate) => `${candidate.kind}:${candidate.value}${candidate.unique ? "（唯一）" : ""}`)
              .join(" | ")}`
          : "",
      ].filter(Boolean);
      return parts.join("，");
    })
    .join("\n");
}

module.exports = { settings, save, route, chat, test, inspect, describeElements, parseDraft, sanitizeDraft, systemPrompt };
