import { useSyncExternalStore } from "react";
import type { CaseStep } from "./keywords";
import {
  abortTask,
  addTask,
  fetchSnapshot,
  pushAgentUpgrade,
  removeCase,
  retryTaskCases,
  saveCase,
  saveSettings,
  sendTask,
  toggleAgent,
} from "./platform.functions";

/* ---------------------------------- 类型 ---------------------------------- */

export type CaseStatus = "就绪" | "草稿" | "维护中";
export type RunStatus = "等待中" | "运行中" | "通过" | "失败" | "已跳过";
export type TaskStatus = "排队中" | "下发中" | "运行中" | "已完成" | "失败" | "已取消";
export type AgentStatus = "在线" | "忙碌" | "离线";
export type LogLevel = "info" | "warn" | "error" | "success";

export interface TestCase {
  id: string;
  name: string;
  module: string;
  priority: "P0" | "P1" | "P2";
  tags: string[];
  author: string;
  status: CaseStatus;
  updatedAt: string;
  source: "平台编写" | "Agent 录制";
  startUrl?: string;
  steps: CaseStep[];
}

export interface Agent {
  id: string;
  name: string;
  host: string;
  ip: string;
  os: string;
  version: string;
  status: AgentStatus;
  browsers: string[];
  cpu: number;
  memory: number;
  lastHeartbeat: string;
  heartbeatAgoSec: number;
  concurrency: number;
  runningTaskId?: string | undefined;
  totalRuns: number;
}

export interface LogEntry {
  id: string;
  time: string;
  level: LogLevel;
  text: string;
}

export interface CaseRun {
  caseId: string;
  caseName: string;
  status: RunStatus;
  stepIndex: number;
  stepTotal: number;
  durationMs: number;
  failReason?: string | undefined;
  failedStep?: string | undefined;
  attempt: number;
}

export interface Task {
  id: string;
  name: string;
  env: "测试环境" | "预发环境" | "生产环境";
  browser: "Chromium" | "Firefox" | "WebKit";
  agentId: string;
  concurrency: number;
  retry: number;
  status: TaskStatus;
  stage: string;
  createdAt: string;
  trigger: "手动" | "定时" | "CI 触发";
  caseRuns: CaseRun[];
  logs: LogEntry[];
  reportId?: string | undefined;
}

export interface Report {
  id: string;
  taskId: string;
  taskName: string;
  env: string;
  browser: string;
  agentName: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  cases: CaseRun[];
}

export interface Settings {
  platformName: string;
  minAgentVersion: string;
  heartbeatTimeoutSec: number;
  defaultRetry: number;
  defaultConcurrency: number;
  keepReportDays: number;
  notifyEmail: string;
  notifyOnFailure: boolean;
  autoDispatch: boolean;
  videoOnFailure: boolean;
  traceMode: "关闭" | "仅失败" | "始终";
  autoUpgrade: boolean;
  updateChannel: "稳定版" | "灰度版";
}

export type UpgradeStage =
  | "排队中"
  | "下发升级包"
  | "下载中"
  | "校验签名"
  | "安装中"
  | "重启 Agent"
  | "回传结果";
export type UpgradeStatus = "进行中" | "成功" | "失败";

export interface UpgradeJob {
  id: string;
  agentId: string;
  agentName: string;
  fromVersion: string;
  toVersion: string;
  channel: "稳定版" | "灰度版";
  trigger: "手动推送" | "版本拦截自动推送";
  stage: UpgradeStage;
  progress: number;
  status: UpgradeStatus;
  startedAt: string;
  finishedAt?: string | undefined;
  report?:
    | {
        ok: boolean;
        message: string;
        installedVersion: string;
        durationMs: number;
        reportedAt: string;
      }
    | undefined;
  logs: LogEntry[];
}

export interface AgentRelease {
  version: string;
  channel: "稳定版" | "灰度版";
  publishedAt: string;
  notes: string[];
  artifacts: { platform: string; file: string; sizeMB: number; sha256: string }[];
}

export interface State {
  cases: TestCase[];
  agents: Agent[];
  tasks: Task[];
  reports: Report[];
  settings: Settings;
  upgrades: UpgradeJob[];
  release: AgentRelease;
  trend: { date: string; passed: number; failed: number }[];
  loaded: boolean;
}

/* ------------------------------ 真实数据本地缓存 ----------------------------- */

const emptySettings: Settings = {
  platformName: "PlayFlow 自动化测试平台",
  minAgentVersion: "1.8.0",
  heartbeatTimeoutSec: 60,
  defaultRetry: 1,
  defaultConcurrency: 2,
  keepReportDays: 30,
  notifyEmail: "",
  notifyOnFailure: true,
  autoDispatch: true,
  videoOnFailure: true,
  traceMode: "仅失败",
  autoUpgrade: true,
  updateChannel: "稳定版",
};

let state: State = {
  cases: [],
  agents: [],
  tasks: [],
  reports: [],
  settings: emptySettings,
  upgrades: [],
  release: { version: "0.0.0", channel: "稳定版", publishedAt: "", notes: [], artifacts: [] },
  trend: [],
  loaded: false,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getState(): State {
  return state;
}

export function useAppStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}

let inflight: Promise<void> | null = null;

/** 从数据库拉取真实数据（节点心跳、任务进度、执行日志、报告） */
export function refresh(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetchSnapshot()
    .then((snap) => {
      state = { ...(snap as unknown as State), loaded: true };
      emit();
    })
    .catch((e) => {
      console.error("[store] 加载平台数据失败", e);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 界面定时调用：刷新真实心跳与执行进度 */
export function tickHeartbeats() {
  void refresh();
}

/* ---------------------------------- 动作 ---------------------------------- */

export async function upsertCase(c: TestCase): Promise<void> {
  await saveCase({
    data: {
      ...(c.id ? { id: c.id } : {}),
      name: c.name,
      module: c.module,
      priority: c.priority,
      tags: c.tags,
      author: c.author,
      status: c.status,
      source: c.source,
      startUrl: c.startUrl ?? "",
      steps: c.steps.map((s) => ({
        id: s.id,
        keyword: s.keyword,
        target: s.target ?? "",
        value: s.value ?? "",
      })),
    },
  });
  await refresh();
}

export async function createCase(partial: Partial<TestCase>): Promise<TestCase> {
  const { id } = await saveCase({
    data: {
      name: partial.name ?? "未命名用例",
      module: partial.module ?? "未分类",
      priority: partial.priority ?? "P1",
      tags: partial.tags ?? [],
      author: partial.author ?? "平台",
      status: partial.status ?? "草稿",
      source: partial.source ?? "平台编写",
      startUrl: partial.startUrl ?? "",
      steps: (partial.steps ?? []).map((s) => ({
        id: s.id,
        keyword: s.keyword,
        target: s.target ?? "",
        value: s.value ?? "",
      })),
    },
  });
  await refresh();
  return (
    state.cases.find((c) => c.id === id) ?? {
      id,
      name: partial.name ?? "未命名用例",
      module: partial.module ?? "未分类",
      priority: partial.priority ?? "P1",
      tags: partial.tags ?? [],
      author: partial.author ?? "平台",
      status: partial.status ?? "草稿",
      updatedAt: "",
      source: partial.source ?? "平台编写",
      steps: partial.steps ?? [],
    }
  );
}

export async function deleteCase(id: string) {
  await removeCase({ data: { id } });
  await refresh();
}

export async function updateSettings(patch: Partial<Settings>) {
  state = { ...state, settings: { ...state.settings, ...patch } };
  emit();
  await saveSettings({ data: patch as never });
}

export function versionOutdated(agent: Agent, min = state.settings.minAgentVersion): boolean {
  const cmp = (a: string, b: string) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  return cmp(agent.version, min) < 0;
}

export async function toggleAgentOnline(agentId: string) {
  await toggleAgent({ data: { agentId } });
  await refresh();
}

export interface CreateTaskInput {
  name: string;
  caseIds: string[];
  agentId: string;
  env: Task["env"];
  browser: Task["browser"];
  concurrency: number;
  retry: number;
  trigger?: Task["trigger"];
  /** 串行依赖：按所选顺序执行，前置用例通过后才执行下一个，失败自动跳过后续 */
  serialDependency?: boolean;
}

export async function createTask(input: CreateTaskInput): Promise<{ id: string }> {
  const res = await addTask({
    data: {
      name: input.name,
      caseIds: input.caseIds,
      agentId: input.agentId,
      env: input.env,
      browser: input.browser,
      concurrency: input.concurrency,
      retry: input.retry,
      trigger: input.trigger ?? "手动",
      serialDependency: input.serialDependency ?? false,
    },
  });
  await refresh();
  return res;
}

/** 真实下发：排入节点队列，客户端领取后用真实浏览器执行并回传进度 */
export async function dispatchTask(
  taskId: string,
  opts?: { forceCaseIds?: string[] | undefined },
): Promise<{ ok: boolean; message?: string }> {
  const res = await sendTask({
    data: {
      taskId,
      ...(opts?.forceCaseIds?.length ? { caseIds: opts.forceCaseIds } : {}),
      skipAutoUpgrade: false,
    },
  });
  await refresh();
  return res as { ok: boolean; message?: string };
}

export async function cancelTask(taskId: string) {
  await abortTask({ data: { taskId } });
  await refresh();
}

export async function retryTask(taskId: string, onlyFailed = true) {
  const res = await retryTaskCases({ data: { taskId, onlyFailed } });
  if (!res.ok) {
    await refresh();
    return res;
  }
  return dispatchTask(taskId, onlyFailed ? { forceCaseIds: res.caseIds } : undefined);
}

/** 桌面端上传录制/编写好的用例到平台 */
export async function uploadCaseFromAgent(input: {
  name: string;
  module: string;
  steps: CaseStep[];
  agentName: string;
}): Promise<TestCase> {
  return createCase({
    name: input.name,
    module: input.module,
    steps: input.steps,
    status: "就绪",
    source: "Agent 录制",
    author: `${input.agentName} 本地`,
    priority: "P1",
    tags: ["Agent 上传"],
  });
}

export function msToText(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

/** 向真实节点推送升级包，客户端下载安装后回传结果 */
export async function pushUpgrade(agentId: string) {
  await pushAgentUpgrade({ data: { agentId } });
  await refresh();
}

export function upgradesOfAgent(agentId: string): UpgradeJob[] {
  return state.upgrades.filter((j) => j.agentId === agentId);
}
