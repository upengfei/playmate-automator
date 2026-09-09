/* PlayFlow Agent — Electron 主进程（真实客户端）
 *
 * 能力：
 * - 启动即向平台注册真实节点并持续心跳
 * - 拉取平台用例、上传本机录制用例
 * - 用真实 Playwright 浏览器实例执行用例并回传步骤结果与日志
 * - 真实录制浏览器操作并解析为可执行步骤
 * - 领取平台下发的执行任务
 * - 版本清单检查与自动升级、升级结果回传
 */
const { app, BrowserWindow, Tray, Menu, dialog, shell, ipcMain, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

const platform = require("./platform.cjs");
const runner = require("./runner.cjs");
const recorder = require("./recorder.cjs");
const browsers = require("./browsers.cjs");

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DOWNLOAD_DIR = path.join(app.getPath("userData"), "updates");

let win = null;
let tray = null;
let updating = false;
let running = false;

const cfg = () => platform.getConfig();

/* --------------------------------- 主窗口 --------------------------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: `PlayFlow Agent — ${cfg().agentId}`,
    backgroundColor: "#f7f8fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 本机工作台随安装包一起分发：不请求平台页面，因此断网可用、无需登录
  win.loadFile(path.join(__dirname, "workbench.html"));

  win.on("close", (e) => {
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

function log(level, text) {
  send("agent:log", { level, text, at: new Date().toISOString() });
}

function focusWindow(tab) {
  if (!win) createWindow();
  win.show();
  win.focus();
  if (tab) send("agent:tray-action", { tab });
}

/* ------------------------------- 应用菜单 -------------------------------- */

/** macOS 需要标准应用菜单，否则 Cmd+Q / 菜单退出不可用 */
function createAppMenu() {
  const quit = {
    label: "退出 Agent",
    accelerator: process.platform === "darwin" ? "Command+Q" : "Ctrl+Q",
    click: () => {
      app.isQuiting = true;
      app.quit();
    },
  };
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: "PlayFlow Agent",
            submenu: [
              { label: `关于 PlayFlow Agent v${app.getVersion()}`, enabled: false },
              { type: "separator" },
              { label: "隐藏窗口", accelerator: "Command+H", click: () => win && win.hide() },
              { type: "separator" },
              quit,
            ],
          },
        ]
      : []),
    {
      label: "文件",
      submenu: [
        { label: "检查更新…", click: () => checkForUpdates({ manual: true }) },
        { label: "打开平台端", click: () => shell.openExternal(cfg().platformUrl) },
        { type: "separator" },
        ...(process.platform === "darwin" ? [{ label: "关闭窗口", accelerator: "Command+W", role: "close" }] : [quit]),
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* --------------------------------- 系统托盘 -------------------------------- */


function createTray() {
  const iconPath = path.join(__dirname, "assets", "tray.png");
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip(`PlayFlow Agent ${app.getVersion()}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `节点：${cfg().agentId}`, enabled: false },
      { type: "separator" },
      { label: "开始录制用例", click: () => focusWindow("record") },
      { label: "执行当前用例", click: () => focusWindow("run") },
      { label: "调试当前用例", click: () => focusWindow("debug") },
      { label: "上传到平台", click: () => focusWindow("upload") },
      { label: "平台下发任务", click: () => focusWindow("queue") },
      { type: "separator" },
      { label: "检查更新…", click: () => checkForUpdates({ manual: true }) },
      { label: "打开平台端", click: () => shell.openExternal(cfg().platformUrl) },
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

/* ----------------------------- 首次启动自动注册 ---------------------------- */

let setupWin = null;

/**
 * 首次启动（本机还没有节点令牌）时弹出配置窗口：
 * 用户只需填写平台地址与设备标识，客户端自动向平台注册并保存下发的节点令牌。
 */
function openSetup() {
  return new Promise((resolve) => {
    setupWin = new BrowserWindow({
      width: 520,
      height: 560,
      resizable: false,
      title: "PlayFlow Agent 首次配置",
      backgroundColor: "#f7f8fb",
      webPreferences: {
        preload: path.join(__dirname, "setup-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    setupWin.setMenuBarVisibility(false);
    setupWin.loadFile(path.join(__dirname, "setup.html"));

    ipcMain.handle("agent-setup:defaults", () => ({
      platformUrl: cfg().platformUrl,
      agentId: cfg().agentId,
    }));

    ipcMain.handle("agent-setup:register", async (_e, payload) => {
      const platformUrl = String((payload && payload.platformUrl) || "").replace(/\/$/, "");
      const agentId = String((payload && payload.agentId) || "").trim();
      if (!platformUrl || agentId.length < 2) return { ok: false, error: "参数不完整" };
      platform.saveConfig({ platformUrl, agentId, token: "" });
      try {
        const res = await platform.register("在线");
        if (!res || !res.token) return { ok: false, error: "平台未下发节点令牌" };
        setTimeout(() => {
          if (setupWin && !setupWin.isDestroyed()) setupWin.destroy();
          setupWin = null;
          resolve(true);
        }, 600);
        return { ok: true, agentId };
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
      }
    });

    setupWin.on("closed", () => {
      setupWin = null;
      resolve(Boolean(cfg().token));
    });
  });
}

/* ------------------------------ 注册与任务领取 ----------------------------- */

async function registerAgent(status = "在线") {
  try {
    const res = await platform.register(status);
    send("agent:registered", { agentId: cfg().agentId, token: Boolean(res.token) });
    return res;
  } catch (err) {
    log("error", `注册平台失败：${err.message || err}`);
    throw err;
  }
}


/** 真实执行一条用例，全过程回传平台 */
async function executeCase(testCase, runId) {
  if (running) throw new Error("当前节点已有用例在执行");
  running = true;
  const logs = [];
  const collect = (level, text) => {
    logs.push({ level, message: text });
    log(level, text);
  };
  try {
    await platform
      .report({
        runId,
        caseId: testCase.id && /^[0-9a-f-]{36}$/.test(testCase.id) ? testCase.id : undefined,
        caseName: testCase.name,
        status: "执行中",
        logs: [{ level: "info", message: `节点 ${cfg().agentId} 开始真实执行` }],
      })
      .catch(() => {});

    const result = await runner.runCase(testCase, (e) => {
      if (e.type === "log") collect(e.level || "info", e.text);
      if (e.type === "step-start") collect("info", `执行步骤 ${e.index + 1}：${e.step.keyword} ${e.step.target || e.step.value || ""}`);
      if (e.type === "step-end") {
        collect(e.status === "passed" ? "success" : "error", `步骤 ${e.index + 1} ${e.status === "passed" ? "通过" : `失败：${e.error}`}（${e.durationMs}ms）`);
      }
      send("agent:run-event", e);
    });

    const report = await platform
      .report({
        runId,
        caseId: testCase.id && /^[0-9a-f-]{36}$/.test(testCase.id) ? testCase.id : undefined,
        caseName: testCase.name,
        status: result.status === "passed" ? "通过" : "失败",
        durationMs: result.durationMs,
        error: result.error,
        steps: result.steps,
        logs,
      })
      .catch((err) => ({ error: String(err.message || err) }));

    send("agent:run-done", { ...result, report });
    return result;
  } finally {
    running = false;
  }
}

async function pollJobs() {
  if (running) return;
  try {
    const jobs = await platform.claimJobs();
    for (const job of jobs) {
      const ver = job.caseVersion ? ` · 用例版本 v${job.caseVersion}${job.fromSnapshot ? "（历史版本）" : ""}` : "";
      log("info", `领取平台下发任务：${job.name}${ver}`);
      await executeCase(
        {
          id: job.caseId,
          name: job.name,
          steps: job.steps,
          startUrl: job.startUrl,
          version: job.caseVersion,
        },
        job.runId,
      );
    }
  } catch {
    /* 平台不可达时静默重试 */
  }
}

/** AI 页面元素定位：领取平台下发的抓取指令，用本机浏览器抓取元素后回传 */
async function pollInspects() {
  if (running) return;
  try {
    const jobs = await platform.claimInspects();
    for (const job of jobs) {
      running = true;
      log("info", `领取 AI 元素抓取指令：${job.url}`);
      try {
        const { inspectPage } = require("./inspect.cjs");
        const { elements } = await inspectPage(job, (t) => log("info", t));
        await platform.reportInspect({ jobId: job.id, elements });
        log("success", `已回传 ${elements.length} 个元素`);
      } catch (err) {
        await platform
          .reportInspect({ jobId: job.id, elements: [], error: String(err && err.message ? err.message : err) })
          .catch(() => {});
        log("error", `元素抓取失败：${err && err.message ? err.message : err}`);
      } finally {
        running = false;
      }
    }
  } catch {
    /* 平台不可达时静默重试 */
  }
}

/* --------------------------- 浏览器内核与离线补传 --------------------------- */

let preparing = false;

/** 首次运行时从平台镜像下载浏览器内核（只下载一次，安装包因此保持轻量） */
async function prepareBrowsers(manual = false) {
  if (preparing) return { ok: false, message: "内核下载进行中" };
  preparing = true;
  try {
    if (!manual && browsers.isInstalled("chromium")) {
      send("agent:browser-stage", { stage: "内核已就绪", progress: 100 });
      return { ok: true, cached: true };
    }
    send("agent:browser-stage", { stage: "从平台下载浏览器内核", progress: 10 });
    await browsers.ensure("chromium", (t) => {
      log("info", t);
      send("agent:browser-stage", { stage: t, progress: 60 });
    });
    send("agent:browser-stage", { stage: "内核已就绪", progress: 100 });
    return { ok: true };
  } catch (err) {
    log("error", `浏览器内核下载失败：${err.message || err}`);
    send("agent:browser-stage", { stage: "内核下载失败", progress: 100, error: String(err.message || err) });
    return { ok: false, message: String(err.message || err) };
  } finally {
    preparing = false;
  }
}

/** 网络恢复后补传本地保留的执行结果与日志 */
async function flushPending() {
  if (running) return;
  try {
    const res = await platform.flushOutbox((t) => log("info", t));
    if (res.sent || res.pending) send("agent:outbox", res);
  } catch {
    /* 仍不可达，下次再试 */
  }
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
  const res = await fetch(`${cfg().platformUrl}/api/public/agent/version?platform=${platformKey()}`);
  if (!res.ok) throw new Error(`版本清单请求失败：HTTP ${res.status}`);
  return res.json();
}

async function reportUpgrade(payload) {
  try {
    await fetch(`${cfg().platformUrl}/api/public/agent/upgrade-report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: cfg().agentId,
        token: cfg().token,

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
    if (manual) dialog.showErrorBox("升级失败", String(err.message || err));
  } finally {
    updating = false;
  }
}

async function pollPushedUpgrade() {
  try {
    if (!cfg().token) return; // 未注册的节点不轮询升级推送
    const res = await fetch(
      `${cfg().platformUrl}/api/public/agent/upgrade?agentId=${encodeURIComponent(cfg().agentId)}&token=${encodeURIComponent(cfg().token)}&version=${app.getVersion()}`,
    );

    if (!res.ok) return;
    const data = await res.json();
    if (data.pending) await checkForUpdates({ pushedBy: data.jobId || "platform" });
  } catch {
    /* 静默重试 */
  }
}

/* --------------------------------- IPC ---------------------------------- */

ipcMain.handle("agent:info", () => ({
  agentId: cfg().agentId,
  version: app.getVersion(),
  host: os.hostname(),
  os: `${os.type()} ${os.release()}`,
  platformUrl: cfg().platformUrl,
  registered: Boolean(cfg().token),
  isElectron: true,
}));
ipcMain.handle("agent:configure", (_e, patch) => platform.saveConfig(patch || {}));
ipcMain.handle("agent:register", () => registerAgent());
ipcMain.handle("agent:check-updates", () => checkForUpdates({ manual: true }));
ipcMain.handle("agent:pull-cases", () => platform.pullCases());
ipcMain.handle("agent:upload-case", (_e, testCase) => platform.uploadCase(testCase));
ipcMain.handle("agent:run-case", (_e, testCase) => executeCase(testCase));
ipcMain.handle("agent:record-start", (_e, url) => recorder.start(url, (t) => log("info", t)));
ipcMain.handle("agent:record-stop", () => recorder.stop());
ipcMain.handle("agent:recording", () => recorder.isRecording());
ipcMain.handle("agent:outbox", () => ({
  pending: platform.pendingCount(),
  logDir: platform.LOG_DIR,
}));
ipcMain.handle("agent:flush-outbox", () => platform.flushOutbox((t) => log("info", t)));
ipcMain.handle("agent:prepare-browsers", () => prepareBrowsers(true));

/* -------------------------------- 生命周期 -------------------------------- */

const single = app.requestSingleInstanceLock();
if (!single) {
  app.quit();
} else {
  app.on("second-instance", () => focusWindow());
  app.whenReady().then(async () => {
    // 首次启动：本机还没有节点令牌时，先走自动注册配置窗口
    if (!cfg().token) await openSetup();
    createWindow();
    createTray();
    createAppMenu();
    registerAgent().catch(() => {});
    setTimeout(() => prepareBrowsers(), 3000);
    setInterval(() => registerAgent().catch(() => {}), 30 * 1000);
    setInterval(() => pollJobs(), 10 * 1000);
    setInterval(() => flushPending(), 15 * 1000);
    setTimeout(() => checkForUpdates(), 8000);
    setInterval(() => checkForUpdates(), CHECK_INTERVAL_MS);
    setInterval(() => pollPushedUpgrade(), 30 * 1000);
  });
  app.on("before-quit", () => {
    // 统一置退出标记：Cmd+Q、应用菜单、托盘退出、升级重启都能真正结束进程
    app.isQuiting = true;
    platform.register("离线").catch(() => {});
  });
  app.on("window-all-closed", () => {
    /* 常驻托盘 */
  });
  app.on("activate", () => focusWindow());
}
