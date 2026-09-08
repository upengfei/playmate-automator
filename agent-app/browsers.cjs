/* 浏览器内核管理：首次运行时把 Chromium 下载到用户目录 */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { app } = require("electron");

const BROWSERS_DIR = path.join(app.getPath("userData"), "browsers");
const CLI = path.join(__dirname, "node_modules", "playwright-core", "cli.js");

function env() {
  return { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR, ELECTRON_RUN_AS_NODE: "1" };
}

function isInstalled(browser = "chromium") {
  if (!fs.existsSync(BROWSERS_DIR)) return false;
  return fs.readdirSync(BROWSERS_DIR).some((d) => d.startsWith(browser));
}

/** 用 playwright 官方安装器下载真实浏览器内核，onLog 输出进度 */
function install(browser = "chromium", onLog = () => {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(BROWSERS_DIR, { recursive: true });
    onLog(`开始下载 ${browser} 浏览器内核到 ${BROWSERS_DIR}`);
    const child = spawn(process.execPath, [CLI, "install", browser], { env: env() });
    const pipe = (buf) => String(buf).split("\n").filter(Boolean).forEach(onLog);
    child.stdout.on("data", pipe);
    child.stderr.on("data", pipe);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(true) : reject(new Error(`浏览器内核安装失败，退出码 ${code}`)),
    );
  });
}

async function ensure(browser = "chromium", onLog = () => {}) {
  if (isInstalled(browser)) return true;
  return install(browser, onLog);
}

module.exports = { BROWSERS_DIR, CLI, env, ensure, isInstalled, install };
