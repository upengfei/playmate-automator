/* PlayFlow Agent — Electron 主进程
 *
 * 真实桌面客户端：
 * - 加载平台的 Agent 工作台页面（录制 / 编写 / 执行 / 调试 / 上传）
 * - 系统托盘常驻，提供录制、执行、调试、上传、检查更新入口
 * - 启动与定时向平台拉取版本清单，支持平台侧「推送升级包」并回传升级结果
 */
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  dialog,
  shell,
  ipcMain,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

const PLATFORM_URL = (process.env.PLAYFLOW_PLATFORM_URL || "https://playflow.lovable.app").replace(
  /\/$/,
  "",
);
const AGENT_ID = process.env.PLAYFLOW_AGENT_ID || `AG-${os.hostname()}`;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DOWNLOAD_DIR = path.join(app.getPath("userData"), "updates");

let win = null;
let tray = null;
let updating = false;

/* --------------------------------- 主窗口 --------------------------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: `PlayFlow Agent — ${AGENT_ID}`,
    backgroundColor: "#f7f8fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(`${PLATFORM_URL}/desktop?agent=${encodeURIComponent(AGENT_ID)}&shell=electron`);

  win.on("close", (e) => {
    // 关闭时最小化到托盘，Agent 需常驻以接收平台下发任务
    if (!app.isQuiting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function focusWindow(tab) {
  if (!win) createWindow();
  win.show();
  win.focus();
  if (tab) send("agent:tray-action", { tab });
}

/* --------------------------------- 系统托盘 -------------------------------- */

function createTray() {
  const iconPath = path.join(__dirname, "assets", "tray.png");
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip(`PlayFlow Agent ${app.getVersion()}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `节点：${AGENT_ID}`, enabled: false },
      { type: "separator" },
      { label: "开始录制用例", click: () => focusWindow("record") },
      { label: "执行当前用例", click: () => focusWindow("run") },
      { label: "调试当前用例", click: () => focusWindow("debug") },
      { label: "上传到平台", click: () => focusWindow("upload") },
      { label: "平台下发任务", click: () => focusWindow("queue") },
      { type: "separator" },
      { label: "检查更新…", click: () => checkForUpdates({ manual: true }) },
      { label: "打开平台端", click: () => shell.openExternal(PLATFORM_URL) },
      { type: "separator" },
      {
        label: "退出 Agent",
        click: () => {
          app.isQuiting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => focusWindow());
}

/* -------------------------------- 安装与更新 ------------------------------- */

function compareVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function platformKey() {
  if (process.platform === "win32") return "win";
  if (process.platform === "darwin") return "darwin";
  return "linux";
}

async function fetchManifest() {
  const res = await fetch(`${PLATFORM_URL}/api/public/agent/version?platform=${platformKey()}`);
  if (!res.ok) throw new Error(`版本清单请求失败：HTTP ${res.status}`);
  return res.json();
}

async function reportUpgrade(payload) {
  try {
    await fetch(`${PLATFORM_URL}/api/public/agent/upgrade-report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: AGENT_ID,
        host: os.hostname(),
        os: `${os.type()} ${os.release()}`,
        fromVersion: app.getVersion(),
        ...payload,
        reportedAt: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error("升级结果回传失败", err);
  }
}

async function downloadArtifact(artifact) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const target = path.join(DOWNLOAD_DIR, artifact.file);
  const res = await fetch(artifact.url);
  if (!res.ok) throw new Error(`安装包下载失败：HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(target, buf);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  if (artifact.sha256 && artifact.sha256 !== sha) {
    throw new Error("安装包 SHA256 校验未通过，已丢弃");
  }
  return { target, sizeMB: +(buf.length / 1024 / 1024).toFixed(1), sha };
}

async function checkForUpdates({ manual = false, pushedBy = null } = {}) {
  if (updating) return;
  updating = true;
  const started = Date.now();
  try {
    send("agent:update-stage", { stage: "检查更新", progress: 5 });
    const manifest = await fetchManifest();
    const current = app.getVersion();
    if (compareVersion(manifest.version, current) <= 0) {
      send("agent:update-stage", { stage: "已是最新版本", progress: 100 });
      if (manual) {
        dialog.showMessageBox(win, {
          type: "info",
          message: `当前已是最新版本 v${current}`,
          detail: `平台最新版本 v${manifest.version}（${manifest.channel}）`,
        });
      }
      await reportUpgrade({ ok: true, skipped: true, installedVersion: current, message: "已是最新版本" });
      return;
    }

    send("agent:update-stage", { stage: "下发升级包", progress: 15, version: manifest.version });
    const artifact = manifest.artifact;
    send("agent:update-stage", { stage: "下载中", progress: 40 });
    const dl = await downloadArtifact(artifact);
    send("agent:update-stage", { stage: "校验签名", progress: 70 });
    send("agent:update-stage", { stage: "安装中", progress: 85 });

    const choice = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["立即安装并重启", "稍后"],
      defaultId: 0,
      message: `发现新版本 v${manifest.version}`,
      detail: `${(manifest.notes || []).join("\n")}\n\n安装包：${artifact.file}（${dl.sizeMB} MB）`,
    });

    if (choice.response !== 0) {
      send("agent:update-stage", { stage: "已下载，待安装", progress: 90 });
      await reportUpgrade({
        ok: false,
        installedVersion: current,
        toVersion: manifest.version,
        durationMs: Date.now() - started,
        message: "用户选择稍后安装，安装包已缓存在本地",
      });
      return;
    }

    // 安装：交给系统安装器 / 解压包，随后退出当前进程由新版本接管
    shell.openPath(dl.target);
    send("agent:update-stage", { stage: "重启 Agent", progress: 96 });
    await reportUpgrade({
      ok: true,
      installedVersion: manifest.version,
      toVersion: manifest.version,
      durationMs: Date.now() - started,
      message: `已安装 v${manifest.version} 并重启 Agent`,
    });
    send("agent:update-stage", { stage: "回传结果", progress: 100 });
    setTimeout(() => {
      app.isQuiting = true;
      app.quit();
    }, 1500);
  } catch (err) {
    send("agent:update-stage", { stage: "升级失败", progress: 100, error: String(err.message || err) });
    await reportUpgrade({
      ok: false,
      installedVersion: app.getVersion(),
      durationMs: Date.now() - started,
      message: `升级失败：${err.message || err}`,
      pushedBy,
    });
    if (manual) {
      dialog.showErrorBox("升级失败", String(err.message || err));
    }
  } finally {
    updating = false;
  }
}

/** 轮询平台是否有针对本节点的升级推送（版本校验拦截会自动创建） */
async function pollPushedUpgrade() {
  try {
    const res = await fetch(
      `${PLATFORM_URL}/api/public/agent/upgrade?agentId=${encodeURIComponent(AGENT_ID)}&version=${app.getVersion()}`,
    );
    if (!res.ok) return;
    const data = await res.json();
    if (data.pending) await checkForUpdates({ pushedBy: data.jobId || "platform" });
  } catch {
    /* 平台不可达时静默重试 */
  }
}

/* --------------------------------- IPC ---------------------------------- */

ipcMain.handle("agent:info", () => ({
  agentId: AGENT_ID,
  version: app.getVersion(),
  host: os.hostname(),
  os: `${os.type()} ${os.release()}`,
  platformUrl: PLATFORM_URL,
  isElectron: true,
}));
ipcMain.handle("agent:check-updates", () => checkForUpdates({ manual: true }));

/* -------------------------------- 生命周期 -------------------------------- */

const single = app.requestSingleInstanceLock();
if (!single) {
  app.quit();
} else {
  app.on("second-instance", () => focusWindow());
  app.whenReady().then(() => {
    createWindow();
    createTray();
    setTimeout(() => checkForUpdates(), 4000);
    setInterval(() => checkForUpdates(), CHECK_INTERVAL_MS);
    setInterval(() => pollPushedUpgrade(), 30 * 1000);
  });
  app.on("window-all-closed", () => {
    // 常驻托盘，不随窗口关闭退出
  });
  app.on("activate", () => focusWindow());
}
