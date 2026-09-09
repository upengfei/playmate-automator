/* 浏览器内核管理
 *
 * 安装包内不携带浏览器内核（避免安装包体积超过平台文件限制）。
 * 首次运行时从平台侧镜像下载一次到用户目录，并写入本地标记，之后不再重复下载。
 */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { app } = require("electron");

const platform = require("./platform.cjs");

const BROWSERS_DIR = path.join(app.getPath("userData"), "browsers");
const MARKER_FILE = path.join(BROWSERS_DIR, "installed.json");
const CLI = path.join(__dirname, "node_modules", "playwright-core", "cli.js");

let mirror = null;

/** 从平台侧读取内核下载镜像配置（失败时回落到官方源） */
async function loadMirror() {
  if (mirror) return mirror;
  try {
    mirror = await platform.api("browsers");
  } catch {
    mirror = { downloadHost: "", cacheKey: "default" };
  }
  return mirror;
}

function env(cfg = mirror) {
  const extra = {};
  if (cfg && cfg.downloadHost) {
    extra.PLAYWRIGHT_DOWNLOAD_HOST = cfg.downloadHost;
  }
  return {
    ...process.env,
    ...extra,
    PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR,
    ELECTRON_RUN_AS_NODE: "1",
  };
}

function readMarker() {
  try {
    return JSON.parse(fs.readFileSync(MARKER_FILE, "utf8"));
  } catch {
    return { done: [], cacheKey: "" };
  }
}

function writeMarker(marker) {
  fs.mkdirSync(BROWSERS_DIR, { recursive: true });
  fs.writeFileSync(MARKER_FILE, JSON.stringify(marker, null, 2));
}

function hasFiles(browser) {
  if (!fs.existsSync(BROWSERS_DIR)) return false;
  return fs.readdirSync(BROWSERS_DIR).some((d) => d.startsWith(browser));
}

/** 该内核是否已经下载过（标记 + 文件双重确认） */
function isInstalled(browser = "chromium", cacheKey = "") {
  const marker = readMarker();
  const sameKey = !cacheKey || !marker.cacheKey || marker.cacheKey === cacheKey;
  return sameKey && marker.done?.includes(browser) && hasFiles(browser);
}

/** 用 playwright 官方安装器从平台镜像下载内核，onLog 输出进度 */
function download(browser, cfg, onLog) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(BROWSERS_DIR, { recursive: true });
    onLog(
      `开始从平台下载 ${browser} 浏览器内核（仅首次，${cfg.downloadHost ? "平台镜像" : "官方源"}）→ ${BROWSERS_DIR}`,
    );
    const child = spawn(process.execPath, [CLI, "install", browser], { env: env(cfg) });
    const pipe = (buf) => String(buf).split("\n").filter(Boolean).forEach(onLog);
    child.stdout.on("data", pipe);
    child.stderr.on("data", pipe);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(true) : reject(new Error(`浏览器内核安装失败，退出码 ${code}`)),
    );
  });
}

/** 确保内核可用：已下载过则直接返回，未下载则从平台镜像下载一次 */
async function ensure(browser = "chromium", onLog = () => {}) {
  const cfg = await loadMirror();
  if (isInstalled(browser, cfg.cacheKey)) {
    onLog(`浏览器内核 ${browser} 已在本地缓存，跳过下载`);
    return true;
  }
  await download(browser, cfg, onLog);
  const marker = readMarker();
  const done = new Set(marker.cacheKey === cfg.cacheKey ? marker.done || [] : []);
  done.add(browser);
  writeMarker({ cacheKey: cfg.cacheKey || "", done: [...done], updatedAt: new Date().toISOString() });
  onLog(`浏览器内核 ${browser} 下载完成，后续执行不再重复下载`);
  return true;
}

module.exports = { BROWSERS_DIR, CLI, env, ensure, isInstalled, loadMirror, download };
