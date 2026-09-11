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
const keywords = require("./keywords.cjs");
const localCases = require("./local-cases.cjs");
const browsers = require("./browsers.cjs");
const ai = require("./ai.cjs");

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DOWNLOAD_DIR = path.join(app.getPath("userData"), "updates");

let win = null;
let tray = null;
let updating = false;
let offeredUpdateVersion = "";
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
  // 窗口可能已被销毁（托盘常驻时再次点击图标），此时重建，避免「点了没反应」
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (process.platform === "darwin") app.dock?.show?.();
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
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = new Tray(icon);
  tray.setToolTip(`PlayFlow Agent ${app.getVersion()}`);
  const headless = cfg().headless !== false;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `节点：${cfg().agentId}`, enabled: false },
      { label: `执行模式：${headless ? "无头" : "有头"}`, enabled: false },
      {
        label: headless ? "切换为有头执行" : "切换为无头执行",
        click: () => {
          platform.saveConfig({ headless: !headless });
          createTray();
          log("info", `执行模式已切换为${headless ? "有头" : "无头"}`);
          send("agent:run-options", { headless: !headless, keepOpenOnFail: Boolean(cfg().keepOpenOnFail) });
        },
      },
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

/* ----------------------------- 首次使用配置向导 ---------------------------- */

let setupWin = null;

/**
 * 首次启动（本机还没有节点令牌）时先弹出配置窗口：
 * 用户填写平台地址与平台下发的节点令牌，客户端换出设备标识与登记名称后才进入工作台。
 */
function openSetup() {
  return new Promise((resolve) => {
    let done = false;
    setupWin = new BrowserWindow({
      width: 520,
      height: 580,
      resizable: false,
      title: "PlayFlow Agent 首次使用配置",
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
      token: cfg().token || "",
    }));

    ipcMain.handle("agent-setup:verify", async (_e, payload) => {
      const platformUrl = String((payload && payload.platformUrl) || "")
        .trim()
        .replace(/\/$/, "");
      const token = String((payload && payload.token) || "").trim();
      if (!platformUrl || token.length < 16) return { ok: false, error: "参数不完整" };
      const previous = { ...cfg() };
      platform.saveConfig({ platformUrl, token });
      try {
        const res = await fetch(`${platformUrl}/api/public/agent/resolve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.agentId) {
          platform.saveConfig(previous);
          return { ok: false, error: (data && data.error) || `平台返回 HTTP ${res.status}` };
        }
        platform.saveConfig({ agentId: data.agentId, agentName: data.name || data.agentId });
        await platform.register("在线");
        done = true;
        setTimeout(() => {
          if (setupWin && !setupWin.isDestroyed()) setupWin.destroy();
          setupWin = null;
          resolve(true);
        }, 700);
        return { ok: true, agentId: data.agentId, name: data.name || data.agentId };
      } catch (err) {
        platform.saveConfig(previous);
        return { ok: false, error: String((err && err.message) || err) };
      }
    });

    // 离线模式：不连接平台，直接进工作台；录制、编排、本地调试均在本机完成
    ipcMain.handle("agent-setup:offline", () => {
      platform.saveConfig({ offlineMode: true });
      done = true;
      setTimeout(() => {
        if (setupWin && !setupWin.isDestroyed()) setupWin.destroy();
        setupWin = null;
        resolve(true);
      }, 600);
      return { ok: true };
    });

    setupWin.on("closed", () => {
      setupWin = null;
      if (!done) resolve(Boolean(cfg().token) || Boolean(cfg().offlineMode));
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


/**
 * 真实执行一条用例，全过程回传平台。
 * @param {object} testCase 用例内容
 * @param {string=} runId 平台执行记录 ID（本机调试时不传）
 * @param {{headed?:boolean}=} options 本次运行覆盖项（有头 / 无头）
 */
async function executeCase(testCase, runId, options = {}) {
  if (running) throw new Error("当前节点已有用例在执行");
  running = true;
  const headed = typeof options.headed === "boolean" ? options.headed : !cfg().headless;
  const job = {
    ...testCase,
    browser: options.browser || testCase.browser || cfg().browser || "chromium",
    headed,
    keepOpenOnFail: Boolean(cfg().keepOpenOnFail),
  };
  testCase = job;
  const logs = [];
  const collect = (level, text) => {
    logs.push({ level, message: text });
    log(level, text);
  };
  try {
    collect("info", `执行模式：${headed ? "有头（可见浏览器窗口）" : "无头"}`);
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
      // 平台下发一律无头执行；本机的「有头运行」只对录制、调试与 AI 抓取生效
      const headed = job.headless === false ? true : false;
      await executeCase(
        {
          id: job.caseId,
          name: job.name,
          steps: job.steps,
          browser: job.browser,
          startUrl: job.startUrl,
          version: job.caseVersion,
        },
        job.runId,
        { headed },
      );
    }
  } catch {
    /* 平台不可达时静默重试 */
  }
}

/**
 * 平台代理是否可用：客户端没填本机模型时，AI 助手会把对话转发给平台配置的模型。
 * 元素抓取已改为本机直接执行，不再领取平台下发的抓取指令。
 */
let aiConfig = null;

async function loadAiConfig() {
  if (!cfg().token) return null;
  try {
    aiConfig = await platform.fetchAiConfig();
    const name = aiConfig.mode === "lovable" ? "内置模型" : aiConfig.defaultModel || "未指定模型";
    log("info", `平台 AI 代理可用：${name}（本机未填模型时使用）`);
  } catch (err) {
    log("warn", `读取平台 AI 配置失败：${err && err.message ? err.message : err}`);
  }
  return aiConfig;
}

setInterval(() => loadAiConfig().catch(() => {}), 10 * 60 * 1000);






/* --------------------------- 浏览器内核与离线补传 --------------------------- */

let preparing = false;

/** 首次运行时从平台镜像下载浏览器内核（只下载一次，安装包因此保持轻量） */
async function prepareBrowsers(manual = false) {
  if (preparing) return { ok: false, message: "内核下载进行中" };
  preparing = true;
  try {
    const target = browsers.resolve(cfg().browser);
    if (!target.download) {
      send("agent:browser-stage", { stage: `${target.label} 使用系统浏览器，无需下载内核`, progress: 100 });
      return { ok: true, cached: true };
    }
    if (!manual && browsers.isInstalled(target.engine)) {
      send("agent:browser-stage", { stage: "内核已就绪", progress: 100 });
      return { ok: true, cached: true };
    }
    send("agent:browser-stage", { stage: "从平台下载浏览器内核", progress: 10 });
    await browsers.ensure(target.engine, (t) => {
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
  const res = await fetch(`${cfg().platformUrl}/api/public/agent/version?platform=${platformKey()}&arch=${process.arch}`);
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
  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256 || "")) {
    throw new Error("安装包缺少有效的 SHA256 校验值");
  }
  if (path.basename(artifact.file) !== artifact.file) throw new Error("安装包文件名不合法");
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const target = path.join(DOWNLOAD_DIR, artifact.file);
  const res = await fetch(artifact.url);
  if (!res.ok) throw new Error(`安装包下载失败：HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  if (artifact.sha256.toLowerCase() !== sha) {
    throw new Error("安装包 SHA256 校验未通过，已丢弃");
  }
  fs.writeFileSync(target, buf);
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

    // Keep a pending manual installation from reopening a dialog every poll.
    if (!manual && offeredUpdateVersion === manifest.version) return;

    send("agent:update-stage", { stage: "下发升级包", progress: 15, version: manifest.version });
    const artifact = manifest.artifact;
    if (!artifact) throw new Error("当前平台没有适用于本机的安装包");
    send("agent:update-stage", { stage: "下载中", progress: 40 });
    const dl = await downloadArtifact(artifact);
    send("agent:update-stage", { stage: "SHA256 校验完成", progress: 70 });

    const choice = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["打开安装包", "稍后"],
      defaultId: 0,
      message: `发现新版本 v${manifest.version}`,
      detail: `${(manifest.notes || []).join("\n")}\n\n安装包：${artifact.file}（${dl.sizeMB} MB）\n请手动解压并替换旧版应用，再启动新版本。当前 Agent 会继续运行。`,
    });

    if (choice.response !== 0) {
      offeredUpdateVersion = manifest.version;
      send("agent:update-stage", { stage: "已下载，待安装", progress: 90 });
      await reportUpgrade({
        stage: "等待手动安装",
        progress: 90,
        installedVersion: current,
        toVersion: manifest.version,
        durationMs: Date.now() - started,
        message: "用户选择稍后安装，安装包已缓存在本地",
      });
      return;
    }

    const openError = await shell.openPath(dl.target);
    if (openError) throw new Error(`无法打开安装包：${openError}`);
    offeredUpdateVersion = manifest.version;
    send("agent:update-stage", { stage: "等待手动安装", progress: 90 });
    await reportUpgrade({
      stage: "等待手动安装",
      progress: 90,
      installedVersion: current,
      toVersion: manifest.version,
      durationMs: Date.now() - started,
      message: `已打开 v${manifest.version} 安装包，请手动安装并启动新版本；当前仍运行 v${current}`,
    });
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
ipcMain.handle("agent:pull-case", (_e, caseId) => platform.pullCase(caseId));
ipcMain.handle("agent:upload-case", (_e, testCase) => platform.uploadCase(testCase));
ipcMain.handle("agent:local-cases", () => localCases.list());
ipcMain.handle("agent:local-case", (_e, id) => localCases.get(id));
ipcMain.handle("agent:local-case-save", (_e, testCase) => localCases.save(testCase || {}));
ipcMain.handle("agent:local-case-rename", (_e, id, name) => localCases.rename(id, name));
ipcMain.handle("agent:local-case-delete", (_e, id) => localCases.remove(id));
ipcMain.handle("agent:run-case", (_e, testCase, options) => executeCase(testCase, undefined, options || {}));
ipcMain.handle("agent:keywords", () => keywords.keywordMeta());

/* ------------------------------- AI 助手 IPC ------------------------------ */

ipcMain.handle("agent:ai-settings", () => {
  const s = ai.settings();
  const r = ai.route();
  return { ...s, route: r.kind, routeReady: r.ready, platformConnected: Boolean(cfg().token) };
});
ipcMain.handle("agent:ai-save-settings", (_e, patch) => {
  ai.save(patch || {});
  const s = ai.settings();
  const r = ai.route();
  log("info", `AI 助手设置已保存：当前使用${r.kind === "local" ? "本机模型" : "平台模型"}`);
  return { ...s, route: r.kind, routeReady: r.ready, platformConnected: Boolean(cfg().token) };
});
ipcMain.handle("agent:ai-chat", async (_e, messages) => {
  try {
    const r = await ai.chat(messages || []);
    log("info", `AI 助手回复完成（${r.label}）`);
    return { ok: true, ...r };
  } catch (err) {
    const message = (err && err.message) || String(err);
    log("error", `AI 助手调用失败：${message}`);
    return { ok: false, error: message };
  }
});
ipcMain.handle("agent:ai-test", (_e, patch) => ai.test(patch));
ipcMain.handle("agent:ai-inspect", async (_e, url, options) => {
  if (!url) return { ok: false, error: "请先填写要抓取的页面地址" };
  try {
    const headless = options && options.headless !== undefined ? options.headless !== false : undefined;
    log("info", `开始抓取页面元素（${headless === false ? "有头" : "无头"}）：${url}`);
    const r = await ai.inspect(url, (t) => log("info", t), { headless });
    log("success", `已抓取 ${r.elements.length} 个可交互元素`);
    return { ok: true, ...r, summary: ai.describeElements(r.elements) };
  } catch (err) {
    const message = (err && err.message) || String(err);
    log("error", `元素抓取失败：${message}`);
    return { ok: false, error: message };
  }
});

ipcMain.handle("agent:generate-script", (_e, name, steps) => keywords.generateScript(name, steps || []));
ipcMain.handle("agent:run-options", () => ({
  headless: cfg().headless !== false,
  keepOpenOnFail: Boolean(cfg().keepOpenOnFail),
  browser: cfg().browser || "chromium",
  browsers: browsers.OPTIONS.map((o) => ({ id: o.id, label: o.label })),
}));
ipcMain.handle("agent:set-run-options", (_e, patch) => {
  const next = platform.saveConfig({
    ...(typeof patch?.headless === "boolean" ? { headless: patch.headless } : {}),
    ...(typeof patch?.keepOpenOnFail === "boolean" ? { keepOpenOnFail: patch.keepOpenOnFail } : {}),
    ...(patch?.browser ? { browser: browsers.resolve(patch.browser).id } : {}),
  });
  if (tray) createTray();
  log(
    "info",
    `执行设置已更新：${browsers.resolve(next.browser).label} · ${next.headless === false ? "有头" : "无头"}执行${next.keepOpenOnFail ? " · 失败保留窗口" : ""}（下次录制与执行生效）`,
  );
  return {
    headless: next.headless !== false,
    keepOpenOnFail: Boolean(next.keepOpenOnFail),
    browser: browsers.resolve(next.browser).id,
    browsers: browsers.OPTIONS.map((o) => ({ id: o.id, label: o.label })),
  };
});
ipcMain.handle("agent:record-start", (_e, url, browserId) =>
  recorder.start(url, (t) => log("info", t), browserId || cfg().browser || "chromium"),
);
ipcMain.handle("agent:record-stop", () => recorder.stop());
ipcMain.handle("agent:recording", () => recorder.isRecording());
ipcMain.handle("agent:outbox", () => ({
  pending: platform.pendingCount(),
  logDir: platform.LOG_DIR,
}));
ipcMain.handle("agent:flush-outbox", () => platform.flushOutbox((t) => log("info", t)));
ipcMain.handle("agent:prepare-browsers", () => prepareBrowsers(true));

/* -------------------------------- 生命周期 -------------------------------- */

/** 启动异常写入用户目录，便于排查「打不开 / 一闪而过」 */
function reportStartupError(err) {
  const text = `[${new Date().toISOString()}] ${(err && err.stack) || err}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "startup-error.log"), text);
  } catch {}
  try {
    dialog.showErrorBox("PlayFlow Agent 启动失败", String((err && err.message) || err));
  } catch {}
}

process.on("uncaughtException", reportStartupError);
process.on("unhandledRejection", reportStartupError);

const single = app.requestSingleInstanceLock();
if (!single) {
  // 已有一个实例在托盘常驻：把它唤到前台即可，不再重复启动
  app.quit();
} else {
  app.on("second-instance", () => focusWindow());
  app.whenReady().then(async () => {
    try {
      // 首次使用：本机没有节点令牌且未选择离线模式时，先完成配置向导；未完成则退出
      if (!cfg().token && !cfg().offlineMode) {
        const ok = await openSetup();
        if (!ok) {
          app.isQuiting = true;
          app.quit();
          return;
        }
      }
      createWindow();

      createTray();
      createAppMenu();
      loadAiConfig().catch(() => {});
      setTimeout(() => prepareBrowsers(), 3000);
      // 联网功能仅在有节点令牌时启用；离线模式下录制、本地调试与本机模型 AI 助手不受影响
      if (cfg().token) {
        registerAgent().catch(() => {});
        setInterval(() => registerAgent().catch(() => {}), 30 * 1000);
        setInterval(() => pollJobs(), 10 * 1000);

        setInterval(() => flushPending(), 15 * 1000);
        setTimeout(() => checkForUpdates(), 8000);
        setInterval(() => checkForUpdates(), CHECK_INTERVAL_MS);
        setInterval(() => pollPushedUpgrade(), 30 * 1000);
      }
    } catch (err) {
      reportStartupError(err);
    }
  });
  app.on("before-quit", () => {
    // 统一置退出标记：Cmd+Q、应用菜单、托盘退出、升级重启都能真正结束进程
    app.isQuiting = true;
    platform.register("离线").catch(() => {});
    try {
      require("./inspect.cjs").closeInspectBrowser();
    } catch {}
  });


  app.on("window-all-closed", () => {
    /* 常驻托盘 */
  });
  app.on("activate", () => focusWindow());
}
