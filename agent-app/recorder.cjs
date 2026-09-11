/* 真实录制：启动 Playwright 官方 codegen，抓取用户在真实浏览器里的操作并解析为步骤积木 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const browsers = require("./browsers.cjs");

let child = null;
let outFile = null;

function isRecording() {
  return Boolean(child);
}

/** 启动真实浏览器录制窗口 */
async function start(url, onLog = () => {}, browserId = "chromium") {
  if (child) throw new Error("已有录制会话在进行中");
  const target = browsers.resolve(browserId);
  if (target.download) await browsers.ensure(target.engine, onLog);
  else onLog(`使用系统安装的 ${target.label} 录制`);
  outFile = path.join(os.tmpdir(), `playflow-record-${Date.now()}.js`);
  const args = [browsers.CLI, "codegen", "--target=javascript", `--browser=${target.engine}`, "-o", outFile];
  if (target.channel) args.push(`--channel=${target.channel}`);
  if (url) args.push(url);
  child = spawn(process.execPath, args, { env: browsers.env() });
  child.stderr.on("data", (b) => onLog(String(b).trim()));
  child.on("close", () => {
    child = null;
  });
  onLog(`已用 ${target.label} 打开真实录制浏览器窗口，你的每一步操作都会被记录`);
  return { outFile };
}

/** 结束录制并解析脚本 */
async function stop() {
  if (child) {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 800));
    child = null;
  }
  const script = outFile && fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  return { script, steps: parse(script) };
}

/** 逐行扫描时记录字符串/模板状态，用来判断语句是否已经结束 */
function scanQuote(line, quote) {
  let current = quote;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (current) {
      if (ch === "\\") i++;
      else if (ch === current) current = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") current = ch;
  }
  return current;
}

/** 把脚本切成完整语句：跨多行的断言（例如快照断言的模板字符串）不再被拆碎 */
function statements(script) {
  const out = [];
  let buffer = null;
  let quote = "";
  for (const rawLine of String(script).split("\n")) {
    const piece = buffer === null ? rawLine.trim() : rawLine;
    buffer = buffer === null ? piece : `${buffer}\n${piece}`;
    quote = scanQuote(piece, quote);
    if (quote) continue;
    const text = buffer.trim();
    if (text.startsWith("await ") && !text.endsWith(";")) continue;
    out.push(buffer);
    buffer = null;
  }
  if (buffer !== null) out.push(buffer);
  return out;
}

/** 把 codegen 生成的脚本解析为平台的关键字步骤 */
function parse(script) {
  const steps = [];
  let seq = 0;
  const id = () => `rec-${++seq}`;
  const lines = statements(script).map((l) => (l.includes("\n") ? l.trim() : l.trim()));
  let activeFrames = [];

  const add = (keyword, target = "", value = "") => steps.push({ id: id(), keyword, target, value });
  const syncFrames = (nextFrames) => {
    let shared = 0;
    while (shared < activeFrames.length && activeFrames[shared] === nextFrames[shared]) shared++;
    while (activeFrames.length > shared) {
      add("parentFrame");
      activeFrames.pop();
    }
    for (const selector of nextFrames.slice(shared)) add("switchFrame", selector);
    activeFrames = [...nextFrames];
  };

  for (const line of lines) {
    let m;
    if ((m = line.match(/^await page\.goto\(['"`](.+?)['"`]\)/))) {
      syncFrames([]);
      add("goto", "", m[1]);
      continue;
    }
    if ((m = line.match(/^await page\.waitForURL\((.*)\);?$/))) {
      syncFrames([]);
      add("waitForUrl", "", literalValue(m[1]));
      continue;
    }
    const action = parseAction(line);
    if (action) {
      syncFrames(action.frames);
      add(action.keyword, action.target, action.value);
      continue;
    }
    const expectation = parseExpectation(line);
    if (expectation) {
      syncFrames(expectation.frames);
      add(expectation.keyword, expectation.target, expectation.value);
      continue;
    }
    if (line && !line.startsWith("//") && (/\bpage\.|\bexpect\(/.test(line))) {
      add("unsupported", "", line);
    }
  }
  return steps;
}

const ACTION_NAMES =
  "click|dblclick|fill|press|selectOption|hover|check|uncheck|setInputFiles|focus|scrollIntoViewIfNeeded|dragTo";
const ACTION_RE = new RegExp(`^await (.+)\\.(${ACTION_NAMES})\\(([\\s\\S]*)\\);?$`);
const ASSERT_NAMES = [
  "toContainText",
  "toHaveText",
  "toBeVisible",
  "toBeHidden",
  "toBeChecked",
  "toBeEnabled",
  "toBeDisabled",
  "toHaveValue",
  "toHaveCount",
  "toHaveAttribute",
  "toMatchAriaSnapshot",
  "toHaveURL",
  "toHaveTitle",
].join("|");
const EXPECT_RE = new RegExp(`^await expect\\(([\\s\\S]+)\\)\\.(not\\.)?(${ASSERT_NAMES})\\(([\\s\\S]*)\\);?$`);

/** 按顶层的点切分链式调用，忽略字符串与括号内部的点 */
function splitChain(expr) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      current += ch;
      if (ch === "\\") {
        current += expr[++i] ?? "";
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (ch === "." && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function callArg(segment) {
  const m = segment.match(/^[A-Za-z]+\(([\s\S]*)\)$/);
  return m ? m[1] : null;
}

/**
 * 把一条定位链拆成 Frame 路径与元素定位。
 * 同时支持 page.frameLocator('#f') 与 page.locator('#f').contentFrame() 两种写法。
 */
function splitScope(rawExpr) {
  const expr = String(rawExpr || "").trim();
  const parts = splitChain(expr);
  if (parts.shift() !== "page") return null;
  const frames = [];
  let pending = [];
  for (const segment of parts) {
    if (/^frameLocator\(/.test(segment)) {
      if (pending.length) return null;
      const selector = literalValue(callArg(segment));
      if (!selector) return null;
      frames.push(selector);
      continue;
    }
    if (segment === "contentFrame()") {
      if (!pending.length) return null;
      frames.push(toSelector(pending.join(".")));
      pending = [];
      continue;
    }
    if (!/^[A-Za-z]+\([\s\S]*\)$/.test(segment)) return null;
    pending.push(segment);
  }
  return { frames, target: pending.length ? toSelector(pending.join(".")) : "" };
}

function literalValue(raw) {
  const m = String(raw || "").trim().match(/^(['"`])([\s\S]*)\1$/);
  return m ? m[2] : "";
}

function inputFileValue(raw) {
  const single = literalValue(raw);
  if (single) return single;
  const files = [];
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  let m;
  while ((m = re.exec(String(raw || "")))) files.push(m[2]);
  return files.join("\n");
}

function parseAction(line) {
  const m = line.match(ACTION_RE);
  if (!m) return null;
  const [, expression, action, rawValue] = m;
  const keyword = {
    click: "click",
    dblclick: "dblclick",
    fill: "fill",
    press: "press",
    selectOption: "select",
    hover: "hover",
    check: "check",
    uncheck: "uncheck",
    setInputFiles: "setInputFiles",
    focus: "focus",
    scrollIntoViewIfNeeded: "scrollIntoView",
    dragTo: "dragTo",
  }[action];
  if (action === "press" && expression.trim() === "page.keyboard") {
    return { frames: [], keyword, target: "", value: literalValue(rawValue) || "Enter" };
  }
  const scope = splitScope(expression);
  if (!scope || !scope.target) return null;
  if (action === "dragTo") {
    const destination = parseScopedLocator(rawValue);
    if (!destination || !destination.target || !sameFrames(scope.frames, destination.frames)) {
      return { frames: scope.frames, keyword: "unsupported", target: "", value: line };
    }
    return { frames: scope.frames, keyword, target: scope.target, value: destination.target };
  }
  const value = action === "setInputFiles"
        ? inputFileValue(rawValue)
        : literalValue(rawValue) || (action === "press" ? "Enter" : "");
  return { frames: scope.frames, keyword, target: scope.target, value };
}

function parseScopedLocator(raw) {
  return splitScope(raw);
}

function sameFrames(a, b) {
  return a.length === b.length && a.every((selector, index) => selector === b[index]);
}

/** 按顶层逗号切分调用参数（字符串与括号内部的逗号不切） */
function splitArgs(raw) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = "";
  const text = String(raw || "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === "\\") current += text[++i] ?? "";
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const POSITIVE_ASSERTIONS = {
  toContainText: "expectText",
  toHaveText: "expectExactText",
  toBeVisible: "expectVisible",
  toBeHidden: "expectHidden",
  toBeChecked: "expectChecked",
  toBeEnabled: "expectEnabled",
  toBeDisabled: "expectDisabled",
  toHaveValue: "expectValue",
  toHaveCount: "expectCount",
  toHaveAttribute: "expectAttribute",
  toMatchAriaSnapshot: "expectAriaSnapshot",
};

/** expect(...).not.xxx 的等价正向关键字 */
const NEGATED_ASSERTIONS = {
  toBeVisible: "expectHidden",
  toBeHidden: "expectVisible",
  toBeChecked: "expectUnchecked",
  toBeEnabled: "expectDisabled",
  toBeDisabled: "expectEnabled",
};

function parseExpectation(line) {
  const m = line.match(EXPECT_RE);
  if (!m) return null;
  const [, expression, negated, assertion, rawValue] = m;
  const scope = splitScope(expression);
  if (!scope) return null;

  // expect(page).toHaveURL / toHaveTitle：页面级断言，没有元素定位
  if (!scope.target) {
    if (assertion === "toHaveURL" && !negated) {
      return { frames: [], keyword: "expectUrl", target: "", value: urlPattern(rawValue) };
    }
    return null;
  }
  if (assertion === "toHaveURL" || assertion === "toHaveTitle") return null;

  const keyword = negated ? NEGATED_ASSERTIONS[assertion] : POSITIVE_ASSERTIONS[assertion];
  if (!keyword) return null;

  let value = "";
  if (assertion === "toHaveAttribute") {
    const args = splitArgs(rawValue);
    value = `${literalValue(args[0])}=${literalValue(args[1])}`;
  } else if (assertion === "toHaveCount") {
    value = String(rawValue || "").trim();
  } else if (assertion === "toMatchAriaSnapshot") {
    value = literalValue(rawValue).replace(/^\n+/, "").replace(/\s+$/, "");
  } else {
    value = literalValue(rawValue);
  }

  return { frames: scope.frames, keyword, target: scope.target, value };
}

/** 断言地址既可能是字符串也可能是正则字面量 */
function urlPattern(raw) {
  const text = String(raw || "").trim();
  const literal = literalValue(text);
  if (literal) return literal;
  const regex = text.match(/^\/([\s\S]*)\/[a-z]*$/);
  return regex ? regex[1].replace(/\\\//g, "/") : text;
}


/** page.getByRole('button', { name: '登录' }) → role/文本定位器；page.locator('#id') → 原样 */
function toSelector(expr) {
  let m;
  if ((m = expr.match(/^locator\(['"`](.+?)['"`]\)/))) return m[1];
  if ((m = expr.match(/^getByRole\(['"`](.+?)['"`],\s*\{\s*name:\s*['"`](.+?)['"`]/))) {
    return `role=${m[1]}[name="${m[2]}"]`;
  }
  if ((m = expr.match(/^getByRole\(['"`](.+?)['"`]\)/))) return `role=${m[1]}`;
  if ((m = expr.match(/^getByLabel\(['"`](.+?)['"`]\)/))) return `label=${m[1]}`;
  if ((m = expr.match(/^getByPlaceholder\(['"`](.+?)['"`]\)/))) return `placeholder=${m[1]}`;
  if ((m = expr.match(/^getByText\(['"`](.+?)['"`]\)/))) return `text=${m[1]}`;
  if ((m = expr.match(/^getByTestId\(['"`](.+?)['"`]\)/))) return `[data-testid="${m[1]}"]`;
  return expr;
}

module.exports = { start, stop, isRecording, parse };
