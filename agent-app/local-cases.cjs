/* 本地用例仓库：录制结果先存本机 JSON 文件，离线也能继续编辑，联网后再上传平台 */
const fs = require("fs");
const path = require("path");

/** 仓库文件位置：优先环境变量（便于测试），否则放 Electron 用户数据目录 */
function repoFile() {
  if (process.env["PLAYFLOW_LOCAL_CASE_FILE"]) return path.resolve(process.env["PLAYFLOW_LOCAL_CASE_FILE"]);
  const { app } = require("electron");
  return path.join(app.getPath("userData"), "local-cases.json");
}

function readAll() {
  try {
    const raw = fs.readFileSync(repoFile(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(rows) {
  const file = repoFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
}

function newId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 按更新时间倒序列出本地用例 */
function list() {
  return readAll().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function get(id) {
  return readAll().find((c) => c.id === id) || null;
}

/** 新增或覆盖保存一条本地用例，返回保存后的完整记录 */
function save(testCase = {}) {
  const rows = readAll();
  const id = testCase.id || newId();
  const record = {
    id,
    name: String(testCase.name || "未命名用例").trim() || "未命名用例",
    startUrl: String(testCase.startUrl || ""),
    browser: testCase.browser || "chromium",
    steps: Array.isArray(testCase.steps) ? testCase.steps : [],
    script: String(testCase.script || ""),
    source: testCase.source || "本地录制",
    caseId: testCase.caseId || "",
    updatedAt: new Date().toISOString(),
  };
  const index = rows.findIndex((c) => c.id === id);
  if (index >= 0) rows[index] = { ...rows[index], ...record };
  else rows.push(record);
  writeAll(rows);
  return record;
}

function rename(id, name) {
  const row = get(id);
  if (!row) return null;
  return save({ ...row, name });
}

function remove(id) {
  const rows = readAll();
  const next = rows.filter((c) => c.id !== id);
  writeAll(next);
  return { removed: rows.length - next.length };
}

module.exports = { list, get, save, rename, remove, repoFile };
