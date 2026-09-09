/**
 * 平台端真实数据访问（仅服务端）。所有页面数据都来自 Lovable Cloud 数据库，
 * 执行进度与日志来自真实客户端回传。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readRelease, compareVersion } from "./agent-fleet.server";

export function db(): SupabaseClient {
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Row = Record<string, any>;
type StepLike = { id?: string; keyword: string; target?: string; value?: string };

function fmt(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ago(sec: number): string {
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  return `${Math.floor(sec / 3600)} 小时前`;
}

const RUN_STATUS: Record<string, string> = {
  排队中: "等待中",
  等待中: "等待中",
  执行中: "运行中",
  运行中: "运行中",
  通过: "通过",
  失败: "失败",
  已跳过: "已跳过",
};

export function outdated(version: string, min: string): boolean {
  return compareVersion(version, min) < 0;
}

export async function readSettings(client: SupabaseClient) {
  const { data } = await client.from("platform_settings").select("*").eq("id", 1).maybeSingle();
  const s = (data ?? {}) as Row;
  return {
    platformName: s["platform_name"] ?? "PlayFlow 自动化测试平台",
    minAgentVersion: s["min_agent_version"] ?? "1.8.0",
    heartbeatTimeoutSec: s["heartbeat_timeout_sec"] ?? 60,
    defaultRetry: s["default_retry"] ?? 1,
    defaultConcurrency: s["default_concurrency"] ?? 2,
    keepReportDays: s["keep_report_days"] ?? 30,
    notifyEmail: s["notify_email"] ?? "",
    notifyOnFailure: s["notify_on_failure"] ?? true,
    autoDispatch: s["auto_dispatch"] ?? true,
    videoOnFailure: s["video_on_failure"] ?? true,
    traceMode: s["trace_mode"] ?? "仅失败",
    autoUpgrade: s["auto_upgrade"] ?? true,
    updateChannel: s["update_channel"] ?? "稳定版",
  };
}

export async function pushUpgradeRow(
  client: SupabaseClient,
  agentId: string,
  trigger: "手动推送" | "版本拦截自动推送",
) {
  const { data: agent } = await client.from("agents").select("*").eq("id", agentId).maybeSingle();
  if (!agent) return { ok: false as const, message: "节点不存在" };
  const { data: running } = await client
    .from("agent_upgrades")
    .select("id")
    .eq("agent_id", agentId)
    .eq("status", "进行中")
    .maybeSingle();
  if (running) return { ok: true as const, id: running["id"] as string };
  const settings = await readSettings(client);
  const release = await readRelease(client);
  const { data, error } = await client
    .from("agent_upgrades")
    .insert({
      agent_id: agentId,
      agent_name: (agent as Row)["name"] ?? agentId,
      from_version: (agent as Row)["version"] ?? "0.0.0",
      to_version: release.version,
      channel: settings.updateChannel,
      trigger,
      stage: "排队中",
      progress: 5,
      status: "进行中",
      logs: [
        {
          level: "info",
          text: `创建升级任务：v${(agent as Row)["version"]} → v${release.version}（${settings.updateChannel}）`,
          time: new Date().toISOString(),
        },
      ],
    })

    .select("id")
    .single();
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const, id: data["id"] as string };
}

/** 把已经全部跑完的任务收敛为最终状态，并统计节点累计执行次数 */
async function reconcileTasks(client: SupabaseClient, tasks: Row[], runs: Row[]) {
  const updates: PromiseLike<unknown>[] = [];
  for (const t of tasks) {
    if (!["下发中", "运行中", "排队中"].includes(t["status"])) continue;
    const mine = runs.filter((r) => r["task_id"] === t["id"]);
    if (!mine.length) continue;
    const done = mine.every((r) => ["通过", "失败", "已跳过"].includes(r["status"]));
    if (!done) {
      if (t["status"] !== "运行中" && mine.some((r) => r["status"] === "执行中")) {
        t["status"] = "运行中";
        t["stage"] = "节点执行中";
        updates.push(
          client.from("tasks").update({ status: "运行中", stage: "节点执行中" }).eq("id", t["id"]),
        );
      }
      continue;
    }
    const failed = mine.filter((r) => r["status"] === "失败").length;
    const passed = mine.filter((r) => r["status"] === "通过").length;
    t["status"] = failed > 0 ? "失败" : "已完成";
    t["stage"] = failed > 0 ? `执行完成，${failed} 个用例失败` : "报告已生成";
    t["finished_at"] = new Date().toISOString();
    updates.push(
      client
        .from("tasks")
        .update({ status: t["status"], stage: t["stage"], finished_at: t["finished_at"] })
        .eq("id", t["id"]),
      client.from("task_logs").insert({
        task_id: t["id"],
        level: failed > 0 ? "warn" : "success",
        message: `任务执行结束：通过 ${passed} · 失败 ${failed}，报告已生成`,
      }),
    );
  }
  await Promise.all(updates);
}

export async function loadSnapshot() {
  const client = db();
  const settings = await readSettings(client);
  const release = await readRelease(client);


  const { caseRepo } = await import("./case-repo.server");
  const [agentsRes, caseRows, tasksRes, upgradesRes] = await Promise.all([
    client.from("agents").select("*").order("last_heartbeat", { ascending: false }),
    caseRepo().then((repo) => repo.listCases(300)),
    client.from("tasks").select("*").order("created_at", { ascending: false }).limit(60),
    client.from("agent_upgrades").select("*").order("started_at", { ascending: false }).limit(40),
  ]);


  const taskRows = (tasksRes.data ?? []) as Row[];
  const taskIds = taskRows.map((t) => t["id"]);

  const runsRes = taskIds.length
    ? await client
        .from("case_runs")
        .select("*")
        .in("task_id", taskIds)
        .order("started_at", { ascending: true })
    : { data: [] as Row[] };
  const runRows = (runsRes.data ?? []) as Row[];

  await reconcileTasks(client, taskRows, runRows);

  const [taskLogsRes, runLogsRes] = await Promise.all([
    taskIds.length
      ? client
          .from("task_logs")
          .select("*")
          .in("task_id", taskIds)
          .order("at", { ascending: true })
          .limit(2000)
      : Promise.resolve({ data: [] as Row[] }),
    runRows.length
      ? client
          .from("run_logs")
          .select("*")
          .in(
            "run_id",
            runRows.map((r) => r["id"]),
          )
          .order("at", { ascending: true })
          .limit(3000)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const runToTask = new Map<string, string>(runRows.map((r) => [r["id"], r["task_id"]]));
  const logsByTask = new Map<string, Row[]>();
  const push = (taskId: string | undefined, entry: Row) => {
    if (!taskId) return;
    const list = logsByTask.get(taskId) ?? [];
    list.push(entry);
    logsByTask.set(taskId, list);
  };
  for (const l of (taskLogsRes.data ?? []) as Row[]) {
    push(l["task_id"], { id: `tl-${l["id"]}`, at: l["at"], level: l["level"], text: l["message"] });
  }
  for (const l of (runLogsRes.data ?? []) as Row[]) {
    push(runToTask.get(l["run_id"]), {
      id: `rl-${l["id"]}`,
      at: l["at"],
      level: l["level"],
      text: l["message"],
    });
  }

  const nowMs = Date.now();

  const agents = ((agentsRes.data ?? []) as Row[]).map((a) => {
    const agoSec = Math.max(0, Math.round((nowMs - new Date(a["last_heartbeat"]).getTime()) / 1000));
    const offline = agoSec > settings.heartbeatTimeoutSec;
    const runningTask = taskRows.find(
      (t) => t["agent_id"] === a["id"] && ["下发中", "运行中"].includes(t["status"]),
    );
    return {
      id: a["id"],
      name: a["name"],
      host: a["host"],
      ip: a["ip"],
      os: a["os"],
      version: a["version"],
      status: offline ? "离线" : runningTask ? "忙碌" : a["status"] === "离线" ? "离线" : "在线",
      browsers: (a["capabilities"] as string[]) ?? [],
      cpu: offline ? 0 : (a["cpu"] ?? 0),
      memory: offline ? 0 : (a["memory"] ?? 0),
      lastHeartbeat: agoSec <= 3 ? "刚刚" : ago(agoSec),
      heartbeatAgoSec: agoSec,
      concurrency: a["concurrency"] ?? 1,
      runningTaskId: runningTask ? (runningTask["id"] as string) : undefined,
      totalRuns: a["total_runs"] ?? 0,
    };
  });

  const cases = (caseRows as unknown as Row[]).map((c) => ({
    id: c["id"],
    name: c["name"],
    module: c["module"],
    priority: c["priority"] ?? "P1",
    tags: (c["tags"] as string[]) ?? [],
    author: c["author"] ?? "平台",
    status: c["status"] ?? "就绪",
    updatedAt: fmt(c["updated_at"]),
    source: c["source"] ?? "平台编写",
    startUrl: c["start_url"] ?? "",
    steps: ((c["steps"] as StepLike[]) ?? []) as StepLike[],
  }));

  const tasks = taskRows.map((t) => {
    const mine = runRows.filter((r) => r["task_id"] === t["id"]);
    return {
      id: t["id"],
      name: t["name"],
      env: t["env"],
      browser: t["browser"],
      agentId: t["agent_id"] ?? "",
      concurrency: t["concurrency"],
      retry: t["retry"],
      status: t["status"],
      stage: t["stage"],
      createdAt: fmt(t["created_at"]),
      trigger: t["trigger"],
      reportId: t["finished_at"] ? `RP-${String(t["id"]).slice(0, 6).toUpperCase()}` : undefined,
      caseRuns: mine.map((r) => ({
        caseId: r["case_id"] ?? r["id"],
        caseName: r["case_name"],
        status: RUN_STATUS[r["status"]] ?? "等待中",
        stepIndex: r["step_index"] ?? 0,
        stepTotal: r["step_total"] ?? 0,
        durationMs: r["duration_ms"] ?? 0,
        failReason: r["error"] ?? undefined,
        failedStep: undefined,
        attempt: r["attempt"] ?? 1,
      })),
      logs: (logsByTask.get(t["id"]) ?? []).map((l) => ({
        id: l["id"],
        time: fmt(l["at"]).slice(6),
        level: l["level"],
        text: l["text"],
      })),
    };
  });

  const reports = tasks
    .filter((t) => t.reportId)
    .map((t) => {
      const raw = taskRows.find((x) => x["id"] === t.id)!;
      const passed = t.caseRuns.filter((r) => r.status === "通过").length;
      const failed = t.caseRuns.filter((r) => r.status === "失败").length;
      const skipped = t.caseRuns.filter((r) => r.status === "已跳过").length;
      return {
        id: t.reportId!,
        taskId: t.id,
        taskName: t.name,
        env: t.env,
        browser: t.browser,
        agentName: agents.find((a) => a.id === t.agentId)?.name ?? t.agentId,
        finishedAt: fmt(raw["finished_at"]),
        durationMs: t.caseRuns.reduce((s, r) => s + r.durationMs, 0),
        total: t.caseRuns.length,
        passed,
        failed,
        skipped,
        cases: t.caseRuns,
      };
    });

  // 近 7 天真实执行趋势
  const trend: { date: string; passed: number; failed: number }[] = [];
  const since = new Date(nowMs - 6 * 86400000);
  since.setHours(0, 0, 0, 0);
  const { data: recent } = await client
    .from("case_runs")
    .select("status, finished_at")
    .gte("finished_at", since.toISOString())
    .limit(5000);
  for (let i = 0; i < 7; i++) {
    const d = new Date(since.getTime() + i * 86400000);
    const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const rows = ((recent ?? []) as Row[]).filter((r) => fmt(r["finished_at"]).startsWith(key));
    trend.push({
      date: key,
      passed: rows.filter((r) => r["status"] === "通过").length,
      failed: rows.filter((r) => r["status"] === "失败").length,
    });
  }

  const upgrades = ((upgradesRes.data ?? []) as Row[]).map((u) => ({
    id: u["id"],
    agentId: u["agent_id"],
    agentName: u["agent_name"],
    fromVersion: u["from_version"],
    toVersion: u["to_version"],
    channel: u["channel"],
    trigger: u["trigger"],
    stage: u["stage"],
    progress: u["progress"],
    status: u["status"],
    startedAt: fmt(u["started_at"]),
    finishedAt: u["finished_at"] ? fmt(u["finished_at"]) : undefined,
    report: (u["report"] as Row | null) ?? undefined,
    logs: ((u["logs"] as Row[]) ?? []).map((l, i) => ({
      id: `ul-${u["id"]}-${i}`,
      time: fmt(l["time"]).slice(6),
      level: l["level"] ?? "info",
      text: l["text"] ?? "",
    })),
  }));

  return {
    cases,
    agents,
    tasks,
    reports,
    settings,
    upgrades,
    trend,
    release: {
      version: release.version,
      channel: release.channel || settings.updateChannel,
      publishedAt: release.publishedAt,
      notes: release.notes,
      artifacts: release.artifacts.map((a) => ({
        platform:
          a.platform === "win"
            ? "Windows 10/11 x64"
            : a.platform === "darwin"
              ? "macOS 12+ (Apple Silicon)"
              : "Linux x64 (Ubuntu / CentOS)",
        file: a.file,
        sizeMB: a.sizeMB,
        sha256: a.sha256,
        url: a.url,
      })),
    },

  };
}

export type Snapshot = Awaited<ReturnType<typeof loadSnapshot>>;
