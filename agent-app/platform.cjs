/* 与平台通信：注册 / 心跳 / 拉取用例 / 上传用例 / 领取下发任务 / 回传执行结果
 *
 * 断网保护：执行结果与日志先写入本地磁盘（outbox + 本地日志文件），
 * 网络恢复后按顺序补传，任务结果不会丢失。
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app } = require("electron");

const CONFIG_FILE = path.join(app.getPath("userData"), "config.json");
const OUTBOX_FILE = path.join(app.getPath("userData"), "outbox.json");
const LOG_DIR = path.join(app.getPath("userData"), "logs");

function defaultConfig() {
  return {
    platformUrl: (process.env.PLAYFLOW_PLATFORM_URL || "https://playflow.lovable.app").replace(/\/$/, ""),
    // 设备标识由首次使用配置时用节点令牌向平台换出，这里仅作为兜底占位
    agentId: process.env.PLAYFLOW_AGENT_ID || `AG-${os.hostname()}`.slice(0, 40),
    // 平台上登记的设备名称，配置成功后写入
    agentName: "",
    // 在平台「客户端下载更新」页注册设备后复制，支持环境变量预置
    token: process.env.PLAYFLOW_AGENT_TOKEN || "",
  };
}


let config = defaultConfig();
try {
  if (fs.existsSync(CONFIG_FILE)) config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) };
} catch {
  /* 配置损坏时用默认值 */
}

function saveConfig(patch) {
  config = { ...config, ...patch };
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  return config;
}

function getConfig() {
  return config;
}

async function api(pathname, { method = "GET", body } = {}) {
  const res = await fetch(`${config.platformUrl}/api/public/agent/${pathname}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ----------------------------- 本地日志与离线队列 ---------------------------- */

/** 把执行日志追加写到本地文件，断网也保留完整记录 */
function appendLocalLog(payload) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(LOG_DIR, `run-${day}.log`);
    const at = new Date().toISOString();
    const head = `[${at}] ${payload.caseName || payload.caseId || "用例"} · ${payload.status}`;
    const lines = [head, ...(payload.logs || []).map((l) => `  ${l.level}: ${l.message}`)];
    if (payload.error) lines.push(`  error: ${payload.error}`);
    fs.appendFileSync(file, lines.join("\n") + "\n");
    return file;
  } catch {
    return "";
  }
}

function readOutbox() {
  try {
    const list = JSON.parse(fs.readFileSync(OUTBOX_FILE, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeOutbox(list) {
  fs.mkdirSync(path.dirname(OUTBOX_FILE), { recursive: true });
  fs.writeFileSync(OUTBOX_FILE, JSON.stringify(list.slice(-500), null, 2));
}

function pendingCount() {
  return readOutbox().length;
}

function enqueue(payload) {
  const list = readOutbox();
  list.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, payload, at: new Date().toISOString() });
  writeOutbox(list);
  return list.length;
}

/** 网络恢复后按顺序补传离线积压的执行结果 */
async function flushOutbox(onLog = () => {}) {
  let list = readOutbox();
  if (!list.length) return { sent: 0, pending: 0 };
  onLog(`检测到 ${list.length} 条离线执行记录，开始补传平台`);
  let sent = 0;
  while (list.length) {
    const item = list[0];
    try {
      await api("run-report", {
        method: "POST",
        body: { agentId: config.agentId, token: config.token, offline: true, ...item.payload },
      });
      list = list.slice(1);
      writeOutbox(list);
      sent += 1;
    } catch (err) {
      // 仍然不可达（或参数被平台拒绝）：4xx 丢弃避免死循环，其余保留等下次
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 401) {
        list = list.slice(1);
        writeOutbox(list);
        onLog(`离线记录被平台拒绝，已丢弃：${err.message}`);
        continue;
      }
      break;
    }
  }
  if (sent) onLog(`离线执行记录补传完成：${sent} 条`);
  return { sent, pending: list.length };
}

/* ------------------------------- 平台接口调用 ------------------------------- */

/** 读取本机真实负载（百分比） */
function loadMetrics() {
  const cpus = os.cpus() || [];
  const load = os.loadavg ? os.loadavg()[0] || 0 : 0;
  const cpu = Math.max(0, Math.min(100, Math.round((load / Math.max(1, cpus.length)) * 100)));
  const total = os.totalmem() || 1;
  const memory = Math.max(0, Math.min(100, Math.round(((total - os.freemem()) / total) * 100)));
  return { cpu, memory, concurrency: Math.max(1, Math.min(8, Math.floor(cpus.length / 2) || 1)) };
}

/** 注册（或心跳）真实节点，首次注册由平台下发节点令牌 */
async function register(status = "在线") {
  const data = await api("register", {
    method: "POST",
    body: {
      agentId: config.agentId,
      token: config.token || undefined,
      name: config.agentId,
      host: os.hostname(),
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      version: app.getVersion(),
      capabilities: ["Chromium", "Firefox", "WebKit"],
      status,
      ...loadMetrics(),
    },
  });
  if (data.token) saveConfig({ token: data.token });
  return data;
}

async function pullCases() {
  const data = await api(`cases?agentId=${encodeURIComponent(config.agentId)}&token=${encodeURIComponent(config.token)}`);
  return data.cases || [];
}

async function uploadCase(testCase) {
  return api("cases", {
    method: "POST",
    body: { agentId: config.agentId, token: config.token, case: testCase },
  });
}

async function claimJobs() {
  const data = await api(`jobs?agentId=${encodeURIComponent(config.agentId)}&token=${encodeURIComponent(config.token)}`);
  return data.jobs || [];
}

/** 回传执行结果：先落本地日志，网络失败时进入离线队列等待补传 */
async function report(payload) {
  appendLocalLog(payload);
  try {
    return await api("run-report", {
      method: "POST",
      body: { agentId: config.agentId, token: config.token, ...payload },
    });
  } catch (err) {
    if (err.status && err.status >= 400 && err.status < 500 && err.status !== 401) throw err;
    const pending = enqueue(payload);
    return { ok: false, queued: true, pending, message: `网络不可用，已本地保留（待补传 ${pending} 条）` };
  }
}

/** AI 页面元素定位：领取抓取指令 */
async function claimInspects() {
  const data = await api(
    `inspect?agentId=${encodeURIComponent(config.agentId)}&token=${encodeURIComponent(config.token)}`,
  );
  return data.jobs || [];
}

/** 回传抓取到的元素清单 */
async function reportInspect(payload) {
  return api("inspect", {
    method: "POST",
    body: { agentId: config.agentId, token: config.token, ...payload },
  });
}

module.exports = {
  getConfig,
  saveConfig,
  register,
  pullCases,
  uploadCase,
  claimJobs,
  claimInspects,
  reportInspect,
  report,
  api,
  flushOutbox,
  pendingCount,
  LOG_DIR,
  OUTBOX_FILE,
  CONFIG_FILE,
};
