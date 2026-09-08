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

  for (const line of lines) {
    let m;
    if ((m = line.match(/^await page\.goto\(['"`](.+?)['"`]\)/))) {
      steps.push({ id: id(), keyword: "goto", target: "", value: m[1] });
      continue;
    }
    const locMatch = line.match(/^await page\.(.*?)\.(click|fill|press|selectOption|hover|check)\((.*)\)/);
    if (locMatch) {
      const target = toSelector(locMatch[1]);
      const action = locMatch[2];
      const argRaw = locMatch[3] || "";
      const arg = (argRaw.match(/['"`](.*)['"`]/) || [])[1] || "";
      if (action === "click" || action === "check") {
        steps.push({ id: id(), keyword: "click", target, value: "" });
      } else if (action === "fill") {
        steps.push({ id: id(), keyword: "fill", target, value: arg });
      } else if (action === "press") {
        steps.push({ id: id(), keyword: "press", target, value: arg || "Enter" });
      } else if (action === "selectOption") {
        steps.push({ id: id(), keyword: "select", target, value: arg });
      } else if (action === "hover") {
        steps.push({ id: id(), keyword: "hover", target, value: "" });
      }
      continue;
    }
    if ((m = line.match(/^await expect\(page\.(.*?)\)\.toContainText\(['"`](.*?)['"`]\)/))) {
      steps.push({ id: id(), keyword: "expectText", target: toSelector(m[1]), value: m[2] });
      continue;
    }
    if ((m = line.match(/^await expect\(page\.(.*?)\)\.toBeVisible\(\)/))) {
      steps.push({ id: id(), keyword: "expectVisible", target: toSelector(m[1]), value: "" });
    }
  }
  return steps;
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
