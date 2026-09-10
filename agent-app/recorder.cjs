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
async function start(url, onLog = () => {}) {
  if (child) throw new Error("已有录制会话在进行中");
  await browsers.ensure("chromium", onLog);
  outFile = path.join(os.tmpdir(), `playflow-record-${Date.now()}.js`);
  const args = [browsers.CLI, "codegen", "--target=javascript", "-o", outFile];
  if (url) args.push(url);
  child = spawn(process.execPath, args, { env: browsers.env() });
  child.stderr.on("data", (b) => onLog(String(b).trim()));
  child.on("close", () => {
    child = null;
  });
  onLog("已打开真实录制浏览器窗口，你的每一步操作都会被记录");
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

/** 把 codegen 生成的脚本解析为平台的关键字步骤 */
function parse(script) {
  const steps = [];
  let seq = 0;
  const id = () => `rec-${++seq}`;
  const lines = String(script).split("\n").map((l) => l.trim());
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

const FRAME_SCOPE = "page(?:\\.frameLocator\\((?:'[^']*'|\"[^\"]*\"|`[^`]*`)\\))*";
const ACTION_RE = new RegExp(
  `^await (${FRAME_SCOPE})\\.(.+)\\.(click|dblclick|fill|press|selectOption|hover|check|uncheck|setInputFiles|focus|scrollIntoViewIfNeeded|dragTo)\\((.*)\\);?$`,
);
const EXPECT_RE = new RegExp(
  `^await expect\\((${FRAME_SCOPE})\\.(.+)\\)\\.(toContainText|toBeVisible|toBeChecked|toBeEnabled|toHaveValue)\\((.*)\\);?$`,
);

function frameSelectors(scope) {
  const selectors = [];
  const re = /\.frameLocator\((['"`])((?:\\.|(?!\1)[\s\S])*)\1\)/g;
  let m;
  while ((m = re.exec(scope))) selectors.push(m[2]);
  return selectors;
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
  const [, scope, expression, action, rawValue] = m;
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
  const target = toSelector(expression);
  if (action === "dragTo") {
    const destination = parseScopedLocator(rawValue);
    if (!destination || !sameFrames(frameSelectors(scope), destination.frames)) {
      return { frames: frameSelectors(scope), keyword: "unsupported", target: "", value: line };
    }
    return { frames: frameSelectors(scope), keyword, target, value: destination.target };
  }
  const value = action === "setInputFiles"
        ? inputFileValue(rawValue)
        : literalValue(rawValue) || (action === "press" ? "Enter" : "");
  return { frames: frameSelectors(scope), keyword, target, value };
}

function parseScopedLocator(raw) {
  const match = String(raw || "").trim().match(new RegExp(`^(${FRAME_SCOPE})\\.(.+)$`));
  if (!match) return null;
  return { frames: frameSelectors(match[1]), target: toSelector(match[2]) };
}

function sameFrames(a, b) {
  return a.length === b.length && a.every((selector, index) => selector === b[index]);
}

function parseExpectation(line) {
  const m = line.match(EXPECT_RE);
  if (!m) return null;
  const [, scope, expression, assertion, rawValue] = m;
  const keyword = {
    toContainText: "expectText",
    toBeVisible: "expectVisible",
    toBeChecked: "expectChecked",
    toBeEnabled: "expectEnabled",
    toHaveValue: "expectValue",
  }[assertion];
  return {
    frames: frameSelectors(scope),
    keyword,
    target: toSelector(expression),
    value: literalValue(rawValue),
  };
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
