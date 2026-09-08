import { useSyncExternalStore } from "react";
import type { CaseStep } from "./keywords";
import { describeStep } from "./keywords";

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
  /** 版本校验拦截后是否自动推送升级包 */
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
  /** Agent 回传的结果详情 */
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
}

/* --------------------------------- 演示数据 -------------------------------- */

let seq = 1000;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

function now(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function step(keyword: CaseStep["keyword"], target: string, value = ""): CaseStep {
  return { id: nextId("st"), keyword, target, value };
}

const seedCases: TestCase[] = [
  {
    id: "TC-1001",
    name: "用户名密码登录成功",
    module: "登录鉴权",
    priority: "P0",
    tags: ["冒烟", "登录"],
    author: "张明",
    status: "就绪",
    updatedAt: "09-05 14:22",
    source: "Agent 录制",
    steps: [
      step("goto", "", "https://demo.shop.com/login"),
      step("fill", "#username", "qa_user"),
      step("fill", "#password", "Qa@123456"),
      step("click", "button[type=submit]"),
      step("waitFor", ".dashboard-header"),
      step("expectText", ".user-name", "qa_user"),
    ],
  },
  {
    id: "TC-1002",
    name: "密码错误提示校验",
    module: "登录鉴权",
    priority: "P1",
    tags: ["登录", "异常流"],
    author: "张明",
    status: "就绪",
    updatedAt: "09-04 10:11",
    source: "平台编写",
    steps: [
      step("goto", "", "https://demo.shop.com/login"),
      step("fill", "#username", "qa_user"),
      step("fill", "#password", "wrong"),
      step("click", "button[type=submit]"),
      step("expectText", ".error-tip", "账号或密码错误"),
    ],
  },
  {
    id: "TC-1003",
    name: "商品搜索结果排序",
    module: "商品中心",
    priority: "P1",
    tags: ["搜索"],
    author: "李婷",
    status: "就绪",
    updatedAt: "09-06 09:40",
    source: "平台编写",
    steps: [
      step("goto", "", "https://demo.shop.com"),
      step("fill", "input[name=q]", "机械键盘"),
      step("press", "input[name=q]", "Enter"),
      step("waitFor", ".goods-list"),
      step("select", "#sort", "price_asc"),
      step("expectVisible", ".goods-item:first-child"),
    ],
  },
  {
    id: "TC-1004",
    name: "加入购物车并结算",
    module: "交易下单",
    priority: "P0",
    tags: ["冒烟", "下单"],
    author: "王锐",
    status: "就绪",
    updatedAt: "09-06 16:05",
    source: "Agent 录制",
    steps: [
      step("goto", "", "https://demo.shop.com/goods/8801"),
      step("click", ".btn-add-cart"),
      step("click", ".cart-entry"),
      step("click", ".btn-checkout"),
      step("expectUrl", "", "checkout"),
      step("expectText", ".order-total", "￥"),
    ],
  },
  {
    id: "TC-1005",
    name: "优惠券叠加规则校验",
    module: "交易下单",
    priority: "P1",
    tags: ["优惠券"],
    author: "王锐",
    status: "维护中",
    updatedAt: "09-03 11:32",
    source: "平台编写",
    steps: [
      step("goto", "", "https://demo.shop.com/cart"),
      step("click", ".coupon-select"),
      step("click", ".coupon-item[data-id='full100']"),
      step("expectText", ".discount-amount", "100"),
    ],
  },
  {
    id: "TC-1006",
    name: "个人资料修改保存",
    module: "用户中心",
    priority: "P2",
    tags: ["资料"],
    author: "李婷",
    status: "草稿",
    updatedAt: "09-07 08:15",
    source: "平台编写",
    steps: [
      step("goto", "", "https://demo.shop.com/profile"),
      step("fill", "#nickname", "自动化测试君"),
      step("click", ".btn-save"),
      step("expectText", ".toast", "保存成功"),
    ],
  },
  {
    id: "TC-1007",
    name: "订单列表分页加载",
    module: "用户中心",
    priority: "P2",
    tags: ["订单"],
    author: "张明",
    status: "就绪",
    updatedAt: "09-05 19:48",
    source: "平台编写",
    steps: [
      step("goto", "", "https://demo.shop.com/orders"),
      step("click", ".pagination-next"),
      step("waitFor", ".order-row"),
      step("expectVisible", ".order-row"),
    ],
  },
  {
    id: "TC-1008",
    name: "退出登录清理会话",
    module: "登录鉴权",
    priority: "P1",
    tags: ["登录"],
    author: "王锐",
    status: "就绪",
    updatedAt: "09-02 15:20",
    source: "Agent 录制",
    steps: [
      step("goto", "", "https://demo.shop.com/profile"),
      step("click", ".btn-logout"),
      step("expectUrl", "", "login"),
    ],
  },
];

const seedAgents: Agent[] = [
  {
    id: "AG-01",
    name: "QA-Win-01",
    host: "DESKTOP-QA01",
    ip: "10.20.31.11",
    os: "Windows 11 23H2",
    version: "1.8.2",
    status: "在线",
    browsers: ["Chromium 129", "Firefox 130", "WebKit 18"],
    cpu: 23,
    memory: 46,
    lastHeartbeat: "刚刚",
    heartbeatAgoSec: 2,
    concurrency: 4,
    totalRuns: 1287,
  },
  {
    id: "AG-02",
    name: "QA-Mac-02",
    host: "mac-qa-02.local",
    ip: "10.20.31.24",
    os: "macOS 15.1",
    version: "1.8.2",
    status: "在线",
    browsers: ["Chromium 129", "WebKit 18"],
    cpu: 41,
    memory: 58,
    lastHeartbeat: "3 秒前",
    heartbeatAgoSec: 3,
    concurrency: 2,
    totalRuns: 864,
  },
  {
    id: "AG-03",
    name: "QA-Ubuntu-03",
    host: "ubuntu-runner-03",
    ip: "10.20.31.37",
    os: "Ubuntu 24.04",
    version: "1.6.4",
    status: "在线",
    browsers: ["Chromium 127"],
    cpu: 12,
    memory: 33,
    lastHeartbeat: "5 秒前",
    heartbeatAgoSec: 5,
    concurrency: 2,
    totalRuns: 402,
  },
  {
    id: "AG-04",
    name: "QA-Win-04",
    host: "DESKTOP-QA04",
    ip: "10.20.31.48",
    os: "Windows 10 22H2",
    version: "1.7.0",
    status: "离线",
    browsers: ["Chromium 128"],
    cpu: 0,
    memory: 0,
    lastHeartbeat: "42 分钟前",
    heartbeatAgoSec: 2520,
    concurrency: 2,
    totalRuns: 219,
  },
];

const seedSettings: Settings = {
  platformName: "PlayFlow 自动化测试平台",
  minAgentVersion: "1.8.0",
  heartbeatTimeoutSec: 60,
  defaultRetry: 1,
  defaultConcurrency: 2,
  keepReportDays: 30,
  notifyEmail: "qa-team@demo.com",
  notifyOnFailure: true,
  autoDispatch: true,
  videoOnFailure: true,
  traceMode: "仅失败",
  autoUpgrade: true,
  updateChannel: "稳定版",
};

function seedReport(): Report {
  const cases: CaseRun[] = [
    {
      caseId: "TC-1001",
      caseName: "用户名密码登录成功",
      status: "通过",
      stepIndex: 6,
      stepTotal: 6,
      durationMs: 4210,
      attempt: 1,
    },
    {
      caseId: "TC-1002",
      caseName: "密码错误提示校验",
      status: "通过",
      stepIndex: 5,
      stepTotal: 5,
      durationMs: 3180,
      attempt: 1,
    },
    {
      caseId: "TC-1003",
      caseName: "商品搜索结果排序",
      status: "失败",
      stepIndex: 5,
      stepTotal: 6,
      durationMs: 30120,
      failReason: "元素定位超时：.goods-list 在 30000ms 内未出现",
      failedStep: "等待元素出现 · .goods-list",
      attempt: 2,
    },
    {
      caseId: "TC-1004",
      caseName: "加入购物车并结算",
      status: "通过",
      stepIndex: 6,
      stepTotal: 6,
      durationMs: 7640,
      attempt: 1,
    },
    {
      caseId: "TC-1008",
      caseName: "退出登录清理会话",
      status: "通过",
      stepIndex: 3,
      stepTotal: 3,
      durationMs: 2110,
      attempt: 1,
    },
  ];
  return {
    id: "RP-2043",
    taskId: "TK-3011",
    taskName: "每日冒烟回归（09-07）",
    env: "测试环境",
    browser: "Chromium",
    agentName: "QA-Win-01",
    finishedAt: "09-07 02:18",
    durationMs: 47260,
    total: cases.length,
    passed: 4,
    failed: 1,
    skipped: 0,
    cases,
  };
}

function seedReport2(): Report {
  const cases: CaseRun[] = [
    {
      caseId: "TC-1004",
      caseName: "加入购物车并结算",
      status: "通过",
      stepIndex: 6,
      stepTotal: 6,
      durationMs: 6980,
      attempt: 1,
    },
    {
      caseId: "TC-1005",
      caseName: "优惠券叠加规则校验",
      status: "失败",
      stepIndex: 3,
      stepTotal: 4,
      durationMs: 12400,
      failReason: "断言失败：期望 .discount-amount 包含「100」，实际为「50」",
      failedStep: "断言文本 · .discount-amount",
      attempt: 2,
    },
    {
      caseId: "TC-1007",
      caseName: "订单列表分页加载",
      status: "通过",
      stepIndex: 4,
      stepTotal: 4,
      durationMs: 5210,
      attempt: 1,
    },
  ];
  return {
    id: "RP-2042",
    taskId: "TK-3010",
    taskName: "交易链路专项回归",
    env: "预发环境",
    browser: "WebKit",
    agentName: "QA-Mac-02",
    finishedAt: "09-06 21:04",
    durationMs: 24590,
    total: 3,
    passed: 2,
    failed: 1,
    skipped: 0,
    cases,
  };
}

function seedTasks(): Task[] {
  const doneReport = seedReport();
  return [
    {
      id: "TK-3011",
      name: "每日冒烟回归（09-07）",
      env: "测试环境",
      browser: "Chromium",
      agentId: "AG-01",
      concurrency: 2,
      retry: 1,
      status: "已完成",
      stage: "报告已生成",
      createdAt: "09-07 02:00",
      trigger: "定时",
      caseRuns: doneReport.cases,
      logs: [
        { id: "lg-1", time: "02:00:01", level: "info", text: "任务已创建，等待下发" },
        { id: "lg-2", time: "02:00:03", level: "info", text: "已下发至执行节点 QA-Win-01" },
        { id: "lg-3", time: "02:00:05", level: "info", text: "Agent 校验通过（v1.8.2）" },
        { id: "lg-4", time: "02:17:48", level: "error", text: "TC-1003 执行失败：定位超时" },
        { id: "lg-5", time: "02:18:10", level: "success", text: "任务执行完成，报告 RP-2043 已生成" },
      ],
      reportId: "RP-2043",
    },
    {
      id: "TK-3012",
      name: "登录模块回归验证",
      env: "测试环境",
      browser: "Chromium",
      agentId: "AG-02",
      concurrency: 2,
      retry: 1,
      status: "排队中",
      stage: "等待空闲节点",
      createdAt: "09-08 09:12",
      trigger: "手动",
      caseRuns: ["TC-1001", "TC-1002", "TC-1008"].map((id) => {
        const c = seedCases.find((x) => x.id === id)!;
        return {
          caseId: c.id,
          caseName: c.name,
          status: "等待中" as RunStatus,
          stepIndex: 0,
          stepTotal: c.steps.length,
          durationMs: 0,
          attempt: 1,
        };
      }),
      logs: [{ id: "lg-6", time: "09:12:30", level: "info", text: "任务已创建，等待下发" }],
    },
  ];
}

let state: State = {
  cases: seedCases,
  agents: seedAgents,
  tasks: seedTasks(),
  reports: [seedReport(), seedReport2()],
  settings: seedSettings,
  upgrades: [],
  release: {
    version: "1.8.2",
    channel: "稳定版",
    publishedAt: "2026-09-05",
    notes: [
      "内置 Playwright 1.47 执行内核，录制器支持 Shadow DOM 选择器",
      "任务下发通道改为长连接，断线后自动补传执行日志",
      "新增静默安装与后台自动更新（支持回滚到上一个版本）",
    ],
    artifacts: [
      {
        platform: "Windows 10/11 x64",
        file: "PlayFlowAgent-1.8.2-win-x64.zip",
        sizeMB: 135.0,
        sha256: "3aae7899c54411b6b6a61b10efbed815e333128645abcfdadfe8cef28ab608c0",
      },
      {
        platform: "macOS 12+ (Apple Silicon / Intel)",
        file: "PlayFlowAgent-1.8.2-darwin-arm64.zip",
        sizeMB: 325.0,
        sha256: "9aa9933e4d8422787ff5563e1fd5e2aec92422b56e96bf80449d69fdd3bd95e8",
      },
      {
        platform: "Linux x64 (Ubuntu / CentOS)",
        file: "PlayFlowAgent-1.8.2-linux-x64.tar.gz",
        sizeMB: 110.0,
        sha256: "947d136eb25fa7c2a0ae110e421092980f97e465c3c07e4ee79782a3c3bde0ab",
      },
    ],
  },
  trend: [
    { date: "09-01", passed: 42, failed: 6 },
    { date: "09-02", passed: 45, failed: 4 },
    { date: "09-03", passed: 40, failed: 9 },
    { date: "09-04", passed: 47, failed: 3 },
    { date: "09-05", passed: 44, failed: 5 },
    { date: "09-06", passed: 49, failed: 2 },
    { date: "09-07", passed: 46, failed: 4 },
  ],
};

/* --------------------------------- 订阅机制 -------------------------------- */

const listeners = new Set<() => void>();

function setState(mutator: (draft: State) => State) {
  state = mutator(state);
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

/* ---------------------------------- 动作 ---------------------------------- */

function log(level: LogLevel, text: string): LogEntry {
  return { id: nextId("lg"), time: now().slice(6), level, text };
}

export function upsertCase(c: TestCase) {
  setState((s) => {
    const exists = s.cases.some((x) => x.id === c.id);
    return {
      ...s,
      cases: exists ? s.cases.map((x) => (x.id === c.id ? c : x)) : [c, ...s.cases],
    };
  });
}

export function createCase(partial: Partial<TestCase>): TestCase {
  const c: TestCase = {
    id: `TC-${++seq}`,
    name: partial.name ?? "未命名用例",
    module: partial.module ?? "未分类",
    priority: partial.priority ?? "P1",
    tags: partial.tags ?? [],
    author: partial.author ?? "当前用户",
    status: partial.status ?? "草稿",
    updatedAt: now().slice(0, 11),
    source: partial.source ?? "平台编写",
    steps: partial.steps ?? [],
  };
  upsertCase(c);
  return c;
}

export function deleteCase(id: string) {
  setState((s) => ({ ...s, cases: s.cases.filter((c) => c.id !== id) }));
}

export function updateSettings(patch: Partial<Settings>) {
  setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
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

export function upgradeAgent(agentId: string) {
  setState((s) => ({
    ...s,
    agents: s.agents.map((a) =>
      a.id === agentId ? { ...a, version: s.settings.minAgentVersion } : a,
    ),
  }));
}

export function toggleAgentOnline(agentId: string) {
  setState((s) => ({
    ...s,
    agents: s.agents.map((a) =>
      a.id === agentId
        ? a.status === "离线"
          ? { ...a, status: "在线", lastHeartbeat: "刚刚", heartbeatAgoSec: 1, cpu: 15, memory: 35 }
          : { ...a, status: "离线", lastHeartbeat: "刚刚离线", heartbeatAgoSec: 0, cpu: 0, memory: 0 }
        : a,
    ),
  }));
}

/** 心跳：由界面定时调用，模拟节点上报 */
export function tickHeartbeats() {
  setState((s) => ({
    ...s,
    agents: s.agents.map((a) => {
      if (a.status === "离线") {
        const ago = a.heartbeatAgoSec + 3;
        return { ...a, heartbeatAgoSec: ago, lastHeartbeat: formatAgo(ago) };
      }
      const drift = (v: number, span: number) =>
        Math.max(4, Math.min(95, Math.round(v + (Math.random() - 0.5) * span)));
      return {
        ...a,
        heartbeatAgoSec: 1,
        lastHeartbeat: "刚刚",
        cpu: a.status === "忙碌" ? drift(a.cpu, 24) : drift(a.cpu, 10),
        memory: drift(a.memory, 8),
      };
    }),
  }));
}

function formatAgo(sec: number): string {
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  return `${Math.floor(sec / 3600)} 小时前`;
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
}

export function createTask(input: CreateTaskInput): Task {
  const runs: CaseRun[] = input.caseIds.map((id) => {
    const c = state.cases.find((x) => x.id === id);
    return {
      caseId: id,
      caseName: c?.name ?? id,
      status: "等待中",
      stepIndex: 0,
      stepTotal: c?.steps.length ?? 3,
      durationMs: 0,
      attempt: 1,
    };
  });
  const task: Task = {
    id: `TK-${++seq}`,
    name: input.name,
    env: input.env,
    browser: input.browser,
    agentId: input.agentId,
    concurrency: input.concurrency,
    retry: input.retry,
    status: "排队中",
    stage: "等待下发",
    createdAt: now().slice(0, 11),
    trigger: input.trigger ?? "手动",
    caseRuns: runs,
    logs: [log("info", `任务「${input.name}」已创建，包含 ${runs.length} 个用例`)],
  };
  setState((s) => ({ ...s, tasks: [task, ...s.tasks] }));
  return task;
}

function patchTask(taskId: string, patch: (t: Task) => Task) {
  setState((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === taskId ? patch(t) : t)) }));
}

function pushLog(taskId: string, level: LogLevel, text: string) {
  patchTask(taskId, (t) => ({ ...t, logs: [...t.logs, log(level, text)] }));
}

const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

function schedule(taskId: string, fn: () => void, delay: number) {
  const id = setTimeout(fn, delay);
  timers.set(taskId, [...(timers.get(taskId) ?? []), id]);
}

export function cancelTask(taskId: string) {
  (timers.get(taskId) ?? []).forEach(clearTimeout);
  timers.delete(taskId);
  patchTask(taskId, (t) => ({
    ...t,
    status: "已取消",
    stage: "已被用户取消",
    logs: [...t.logs, log("warn", "任务已被取消")],
    caseRuns: t.caseRuns.map((r) =>
      r.status === "等待中" || r.status === "运行中" ? { ...r, status: "已跳过" } : r,
    ),
  }));
  releaseAgent(taskId);
}

function releaseAgent(taskId: string) {
  setState((s) => ({
    ...s,
    agents: s.agents.map((a) =>
      a.runningTaskId === taskId ? { ...a, status: "在线", runningTaskId: undefined } : a,
    ),
  }));
}

const FAIL_LIBRARY = [
  {
    reason: "元素定位超时：目标元素在 30000ms 内未出现",
    hint: "页面结构可能已变更，建议更新定位器",
  },
  { reason: "断言失败：实际文本与期望不一致", hint: "检查业务数据或断言期望值" },
  { reason: "导航超时：目标页面加载超过 30000ms", hint: "确认测试环境可用性与网络" },
];

/** 下发任务到 Agent 并模拟实时执行（步骤级进度 + 日志流） */
export function dispatchTask(
  taskId: string,
  opts?: { forceCaseIds?: string[] | undefined; skipAutoUpgrade?: boolean | undefined },
) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const agent = state.agents.find((a) => a.id === task.agentId);
  if (!agent) return;

  if (agent.status === "离线") {
    pushLog(taskId, "error", `下发失败：执行节点 ${agent.name} 当前离线`);
    patchTask(taskId, (t) => ({ ...t, status: "失败", stage: "节点离线，下发中断" }));
    return;
  }
  if (versionOutdated(agent)) {
    pushLog(
      taskId,
      "error",
      `版本校验未通过：节点 ${agent.name} 版本 v${agent.version} 低于最低要求 v${state.settings.minAgentVersion}`,
    );
    if (state.settings.autoUpgrade && !opts?.skipAutoUpgrade) {
      patchTask(taskId, (t) => ({ ...t, status: "下发中", stage: "自动推送升级包中" }));
      pushLog(taskId, "warn", `已自动向 ${agent.name} 推送 v${state.release.version} 升级包，升级完成后自动续跑`);
      pushUpgrade(agent.id, {
        trigger: "版本拦截自动推送",
        onFinish: (ok) => {
          if (ok) {
            pushLog(taskId, "success", `节点升级完成并回传成功，重新下发任务`);
            dispatchTask(taskId, { ...opts, skipAutoUpgrade: true });
          } else {
            pushLog(taskId, "error", "升级包回传失败，任务终止，请人工介入");
            patchTask(taskId, (t) => ({ ...t, status: "失败", stage: "自动升级失败" }));
          }
        },
      });
      return;
    }
    patchTask(taskId, (t) => ({ ...t, status: "失败", stage: "Agent 版本校验未通过" }));
    return;
  }


  const targets = opts?.forceCaseIds;
  patchTask(taskId, (t) => ({
    ...t,
    status: "下发中",
    stage: "正在下发到执行节点",
    reportId: undefined,
    logs: [
      ...t.logs,
      log("info", `已下发至执行节点 ${agent.name}（${agent.ip}）`),
      log("success", `Agent 校验通过：v${agent.version} · ${agent.os} · ${t.browser}`),
    ],
    caseRuns: t.caseRuns.map((r) =>
      !targets || targets.includes(r.caseId)
        ? { ...r, status: "等待中", stepIndex: 0, durationMs: 0, failReason: undefined }
        : r,
    ),
  }));
  setState((s) => ({
    ...s,
    agents: s.agents.map((a) =>
      a.id === agent.id ? { ...a, status: "忙碌", runningTaskId: taskId } : a,
    ),
  }));

  const runList = (state.tasks.find((t) => t.id === taskId)?.caseRuns ?? []).filter(
    (r) => !targets || targets.includes(r.caseId),
  );

  let cursor = 600;
  schedule(taskId, () => {
    patchTask(taskId, (t) => ({
      ...t,
      status: "运行中",
      stage: `执行中 0/${runList.length}`,
      logs: [...t.logs, log("info", `启动 ${t.browser} 浏览器实例，并发 ${t.concurrency}`)],
    }));
  }, cursor);

  runList.forEach((run, idx) => {
    const caseDef = state.cases.find((c) => c.id === run.caseId);
    const total = Math.max(1, run.stepTotal);
    const willFail = shouldFail(run.caseId, idx);
    const failAt = willFail ? Math.max(1, total - 1) : total;

    cursor += 500;
    schedule(taskId, () => {
      patchTask(taskId, (t) => ({
        ...t,
        stage: `执行中 ${idx}/${runList.length} · ${run.caseName}`,
        caseRuns: t.caseRuns.map((r) =>
          r.caseId === run.caseId ? { ...r, status: "运行中", stepIndex: 0 } : r,
        ),
        logs: [...t.logs, log("info", `▶ 开始执行 ${run.caseId} ${run.caseName}`)],
      }));
    }, cursor);

    for (let i = 0; i < failAt; i++) {
      cursor += 420;
      const stepText = caseDef?.steps[i] ? describeStep(caseDef.steps[i]!) : `步骤 ${i + 1}`;
      const isLast = i === failAt - 1;
      schedule(taskId, () => {
        patchTask(taskId, (t) => ({
          ...t,
          caseRuns: t.caseRuns.map((r) =>
            r.caseId === run.caseId
              ? { ...r, stepIndex: i + 1, durationMs: r.durationMs + 420 }
              : r,
          ),
          logs: [
            ...t.logs,
            willFail && isLast
              ? log("error", `  ✗ [${i + 1}/${total}] ${stepText}`)
              : log("info", `  ✓ [${i + 1}/${total}] ${stepText}`),
          ],
        }));
      }, cursor);
    }

    cursor += 400;
    schedule(taskId, () => {
      const fail = FAIL_LIBRARY[idx % FAIL_LIBRARY.length]!;
      patchTask(taskId, (t) => ({
        ...t,
        stage: `执行中 ${idx + 1}/${runList.length}`,
        caseRuns: t.caseRuns.map((r) =>
          r.caseId === run.caseId
            ? {
                ...r,
                status: willFail ? "失败" : "通过",
                stepIndex: failAt,
                failReason: willFail ? fail.reason : undefined,
                failedStep: willFail
                  ? caseDef?.steps[failAt - 1]
                    ? describeStep(caseDef.steps[failAt - 1]!)
                    : `步骤 ${failAt}`
                  : undefined,
              }
            : r,
        ),
        logs: [
          ...t.logs,
          willFail
            ? log("error", `✗ ${run.caseId} 执行失败：${fail.reason}（建议：${fail.hint}）`)
            : log("success", `✓ ${run.caseId} 执行通过`),
        ],
      }));
    }, cursor);
  });

  cursor += 700;
  schedule(taskId, () => finishTask(taskId), cursor);
}

/** 演示用：固定几个用例会失败，保证展示失败原因与重试入口 */
function shouldFail(caseId: string, idx: number): boolean {
  if (caseId === "TC-1003" || caseId === "TC-1005") return true;
  return idx > 0 && idx % 5 === 4;
}

function finishTask(taskId: string) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  const agent = state.agents.find((a) => a.id === t.agentId);
  const passed = t.caseRuns.filter((r) => r.status === "通过").length;
  const failed = t.caseRuns.filter((r) => r.status === "失败").length;
  const skipped = t.caseRuns.filter((r) => r.status === "已跳过").length;
  const durationMs = t.caseRuns.reduce((s, r) => s + r.durationMs, 0);
  const report: Report = {
    id: `RP-${++seq}`,
    taskId: t.id,
    taskName: t.name,
    env: t.env,
    browser: t.browser,
    agentName: agent?.name ?? t.agentId,
    finishedAt: now().slice(0, 11),
    durationMs,
    total: t.caseRuns.length,
    passed,
    failed,
    skipped,
    cases: t.caseRuns,
  };
  setState((s) => ({
    ...s,
    reports: [report, ...s.reports],
    tasks: s.tasks.map((x) =>
      x.id === taskId
        ? {
            ...x,
            status: failed > 0 ? "失败" : "已完成",
            stage: failed > 0 ? `执行完成，${failed} 个用例失败` : "报告已生成",
            reportId: report.id,
            logs: [
              ...x.logs,
              log(
                failed > 0 ? "warn" : "success",
                `任务执行结束：通过 ${passed} · 失败 ${failed}，报告 ${report.id} 已生成`,
              ),
            ],
          }
        : x,
    ),
    agents: s.agents.map((a) =>
      a.id === t.agentId
        ? { ...a, status: "在线", runningTaskId: undefined, totalRuns: a.totalRuns + report.total }
        : a,
    ),
  }));
  timers.delete(taskId);
}

/** 重试整个任务或仅失败用例 */
export function retryTask(taskId: string, onlyFailed = true) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  const failedIds = t.caseRuns.filter((r) => r.status === "失败").map((r) => r.caseId);
  const targets = onlyFailed ? failedIds : t.caseRuns.map((r) => r.caseId);
  if (targets.length === 0) return;
  patchTask(taskId, (x) => ({
    ...x,
    caseRuns: x.caseRuns.map((r) =>
      targets.includes(r.caseId) ? { ...r, attempt: r.attempt + 1 } : r,
    ),
    logs: [
      ...x.logs,
      log("warn", onlyFailed ? `发起失败重跑：${targets.join("、")}` : "发起全量重跑"),
    ],
  }));
  dispatchTask(taskId, onlyFailed ? { forceCaseIds: targets } : undefined);
}

/** 桌面端上传录制/编写好的用例到平台 */
export function uploadCaseFromAgent(input: {
  name: string;
  module: string;
  steps: CaseStep[];
  agentName: string;
}): TestCase {
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

/* ------------------------------ 升级包推送与回传 ------------------------------ */

function patchUpgrade(id: string, fn: (j: UpgradeJob) => UpgradeJob) {
  setState((s) => ({ ...s, upgrades: s.upgrades.map((j) => (j.id === id ? fn(j) : j)) }));
}

function upLog(id: string, level: LogLevel, text: string) {
  patchUpgrade(id, (j) => ({ ...j, logs: [...j.logs, log(level, text)] }));
}

/**
 * 向指定执行节点推送升级包：下发 → 下载 → 校验 → 安装 → 重启 → 结果回传。
 * 返回创建的升级任务；完成后通过 onFinish 回调告知调用方（用于拦截后自动重试下发）。
 */
export function pushUpgrade(
  agentId: string,
  opts?: { trigger?: UpgradeJob["trigger"]; onFinish?: (ok: boolean) => void },
): UpgradeJob | undefined {
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return undefined;
  if (state.upgrades.some((j) => j.agentId === agentId && j.status === "进行中")) {
    return state.upgrades.find((j) => j.agentId === agentId && j.status === "进行中");
  }

  const target = state.release.version;
  const job: UpgradeJob = {
    id: nextId("UP"),
    agentId,
    agentName: agent.name,
    fromVersion: agent.version,
    toVersion: target,
    channel: state.settings.updateChannel,
    trigger: opts?.trigger ?? "手动推送",
    stage: "排队中",
    progress: 0,
    status: "进行中",
    startedAt: now(),
    logs: [log("info", `创建升级任务：v${agent.version} → v${target}（${state.settings.updateChannel}）`)],
  };
  setState((s) => ({ ...s, upgrades: [job, ...s.upgrades] }));

  const startedMs = Date.now();
  const finish = (ok: boolean, message: string) => {
    const installed = ok ? target : agent.version;
    patchUpgrade(job.id, (j) => ({
      ...j,
      stage: "回传结果",
      progress: 100,
      status: ok ? "成功" : "失败",
      finishedAt: now(),
      report: {
        ok,
        message,
        installedVersion: installed,
        durationMs: Date.now() - startedMs,
        reportedAt: now(),
      },
      logs: [
        ...j.logs,
        log(ok ? "success" : "error", `Agent 回传升级结果：${ok ? "成功" : "失败"} · ${message}`),
      ],
    }));
    if (ok) {
      setState((s) => ({
        ...s,
        agents: s.agents.map((a) =>
          a.id === agentId
            ? { ...a, version: installed, lastHeartbeat: "刚刚", heartbeatAgoSec: 1 }
            : a,
        ),
      }));
    }
    opts?.onFinish?.(ok);
  };

  if (agent.status === "离线") {
    setTimeout(() => {
      upLog(job.id, "warn", "尝试建立升级通道…");
      finish(false, "节点离线，升级包无法下发，请等待节点上线后重试");
    }, 600);
    return job;
  }

  const steps: { stage: UpgradeStage; progress: number; text: string; level?: LogLevel }[] = [
    { stage: "下发升级包", progress: 12, text: `平台已向 ${agent.name}（${agent.ip}）下发升级指令` },
    { stage: "下载中", progress: 32, text: `Agent 开始下载安装包 PlayFlowAgent-${target}` },
    { stage: "下载中", progress: 58, text: "安装包下载进度 60%，速度 8.4 MB/s" },
    { stage: "校验签名", progress: 72, text: "SHA256 与数字签名校验通过", level: "success" },
    { stage: "安装中", progress: 86, text: "静默安装中，旧版本已备份用于回滚" },
    { stage: "重启 Agent", progress: 94, text: "Agent 进程重启，重新注册心跳与能力信息" },
  ];

  steps.forEach((s, i) => {
    setTimeout(
      () => {
        patchUpgrade(job.id, (j) =>
          j.status === "进行中"
            ? { ...j, stage: s.stage, progress: s.progress, logs: [...j.logs, log(s.level ?? "info", s.text)] }
            : j,
        );
      },
      700 * (i + 1),
    );
  });

  setTimeout(
    () => finish(true, `已安装 v${target} 并重新完成版本校验`),
    700 * (steps.length + 1),
  );

  return job;
}

export function upgradesOfAgent(agentId: string): UpgradeJob[] {
  return state.upgrades.filter((j) => j.agentId === agentId);
}
