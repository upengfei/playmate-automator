/* 与平台通信：注册 / 心跳 / 拉取用例 / 上传用例 / 领取下发任务 / 回传执行结果 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app } = require("electron");

const CONFIG_FILE = path.join(app.getPath("userData"), "config.json");

function defaultConfig() {
  return {
    platformUrl: (process.env.PLAYFLOW_PLATFORM_URL || "https://playflow.lovable.app").replace(/\/$/, ""),
    agentId: process.env.PLAYFLOW_AGENT_ID || `AG-${os.hostname()}`.slice(0, 40),
    token: "",
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
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
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

async function report(payload) {
  return api("run-report", {
    method: "POST",
    body: { agentId: config.agentId, token: config.token, ...payload },
  });
}

module.exports = { getConfig, saveConfig, register, pullCases, uploadCase, claimJobs, report, api, CONFIG_FILE };
