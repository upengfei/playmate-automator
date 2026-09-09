import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const stepSchema = z.object({
  id: z.string().max(64).optional(),
  keyword: z.string().max(32),
  target: z.string().max(500).default(""),
  value: z.string().max(1000).default(""),
});

/** 平台所有页面的真实数据快照 */
export const fetchSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  const { loadSnapshot } = await import("@/lib/platform.server");
  return loadSnapshot();
});

export const saveCase = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(120),
        module: z.string().max(40).default("未分类"),
        priority: z.string().max(8).default("P1"),
        tags: z.array(z.string().max(24)).max(20).default([]),
        author: z.string().max(40).default("平台"),
        status: z.string().max(12).default("草稿"),
        source: z.string().max(20).default("平台编写"),
        startUrl: z.string().max(500).default(""),
        steps: z.array(stepSchema).max(300).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/lib/platform.server");
    const { generatePlaywrightCode } = await import("@/lib/keywords");
    const script = generatePlaywrightCode(data.name, data.steps as any);
    const row = {
      name: data.name,
      module: data.module,
      priority: data.priority,
      tags: data.tags,
      author: data.author,
      status: data.status,
      source: data.source,
      start_url: data.startUrl,
      steps: data.steps,
      script,
      updated_at: new Date().toISOString(),
    };
    const client = db();

    const snapshot = async (caseId: string, version: number, note: string) => {
      await client.from("case_versions").insert({
        case_id: caseId,
        version,
        name: data.name,
        module: data.module,
        priority: data.priority,
        start_url: data.startUrl,
        steps: data.steps,
        script,
        note,
        author: data.author,
        source: data.source,
      });
    };

    if (data.id) {
      const { data: current } = await client
        .from("test_cases")
        .select("version")
        .eq("id", data.id)
        .maybeSingle();
      const nextVersion = ((current?.["version"] as number) ?? 1) + 1;
      const { error } = await client
        .from("test_cases")
        .update({ ...row, version: nextVersion })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      await snapshot(data.id, nextVersion, "保存修改");
      return { id: data.id, version: nextVersion };
    }
    const { data: created, error } = await client
      .from("test_cases")
      .insert({ ...row, version: 1 })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const id = created["id"] as string;
    await snapshot(id, 1, "初始版本");
    return { id, version: 1 };
  });

export type CaseVersion = {
  id: string;
  version: number;
  name: string;
  module: string;
  priority: string;
  startUrl: string;
  note: string;
  author: string;
  source: string;
  createdAt: string;
  steps: { id?: string; keyword: string; target?: string; value?: string }[];
  script: string;
};

/** 某条用例的真实版本历史 */
export const fetchCaseVersions = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ caseId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import("@/lib/platform.server");
    const client = db();
    const [{ data: rows }, { data: current }] = await Promise.all([
      client
        .from("case_versions")
        .select("*")
        .eq("case_id", data.caseId)
        .order("version", { ascending: false })
        .limit(50),
      client.from("test_cases").select("version").eq("id", data.caseId).maybeSingle(),
    ]);
    const versions: CaseVersion[] = ((rows ?? []) as Record<string, any>[]).map((r) => ({
      id: r["id"] as string,
      version: (r["version"] as number) ?? 1,
      name: (r["name"] as string) ?? "",
      module: (r["module"] as string) ?? "",
      priority: (r["priority"] as string) ?? "P1",
      startUrl: (r["start_url"] as string) ?? "",
      note: (r["note"] as string) ?? "",
      author: (r["author"] as string) ?? "",
      source: (r["source"] as string) ?? "",
      createdAt: (r["created_at"] as string) ?? "",
      steps: ((r["steps"] as unknown[]) ?? []) as CaseVersion["steps"],
      script: (r["script"] as string) ?? "",
    }));
    return { versions, currentVersion: (current?.["version"] as number) ?? 1 };
  });

/** 回滚到指定历史版本：以旧内容生成一个新版本，保证历史可追溯 */
export const rollbackCase = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ caseId: z.string().uuid(), version: z.number().int().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/lib/platform.server");
    const client = db();
    const { data: target } = await client
      .from("case_versions")
      .select("*")
      .eq("case_id", data.caseId)
      .eq("version", data.version)
      .maybeSingle();
    if (!target) throw new Error("找不到该版本");
    const { data: current } = await client
      .from("test_cases")
      .select("version")
      .eq("id", data.caseId)
      .maybeSingle();
    const nextVersion = ((current?.["version"] as number) ?? 1) + 1;
    const { error } = await client
      .from("test_cases")
      .update({
        name: target["name"],
        module: target["module"],
        priority: target["priority"],
        start_url: target["start_url"],
        steps: target["steps"],
        script: target["script"],
        version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.caseId);
    if (error) throw new Error(error.message);
    await client.from("case_versions").insert({
      case_id: data.caseId,
      version: nextVersion,
      name: target["name"],
      module: target["module"],
      priority: target["priority"],
      start_url: target["start_url"],
      steps: target["steps"],
      script: target["script"],
      note: `回滚自 v${data.version}`,
      author: target["author"],
      source: target["source"],
    });
    return { version: nextVersion };
  });


export const removeCase = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import("@/lib/platform.server");
    const { error } = await db().from("test_cases").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        platformName: z.string().max(80).optional(),
        minAgentVersion: z.string().max(20).optional(),
        heartbeatTimeoutSec: z.number().int().min(5).max(3600).optional(),
        defaultRetry: z.number().int().min(0).max(10).optional(),
        defaultConcurrency: z.number().int().min(1).max(32).optional(),
        keepReportDays: z.number().int().min(1).max(365).optional(),
        notifyEmail: z.string().max(120).optional(),
        notifyOnFailure: z.boolean().optional(),
        autoDispatch: z.boolean().optional(),
        videoOnFailure: z.boolean().optional(),
        traceMode: z.string().max(12).optional(),
        autoUpgrade: z.boolean().optional(),
        updateChannel: z.string().max(12).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/lib/platform.server");
    const map: Record<string, string> = {
      platformName: "platform_name",
      minAgentVersion: "min_agent_version",
      heartbeatTimeoutSec: "heartbeat_timeout_sec",
      defaultRetry: "default_retry",
      defaultConcurrency: "default_concurrency",
      keepReportDays: "keep_report_days",
      notifyEmail: "notify_email",
      notifyOnFailure: "notify_on_failure",
      autoDispatch: "auto_dispatch",
      videoOnFailure: "video_on_failure",
      traceMode: "trace_mode",
      autoUpgrade: "auto_upgrade",
      updateChannel: "update_channel",
    };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && map[k]) patch[map[k]!] = v;
    }
    const { error } = await db().from("platform_settings").update(patch).eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addTask = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(1).max(120),
        caseIds: z.array(z.string().uuid()).min(1).max(200),
        agentId: z.string().min(1).max(64),
        env: z.string().max(12),
        browser: z.string().max(12),
        concurrency: z.number().int().min(1).max(32),
        retry: z.number().int().min(0).max(10),
        trigger: z.string().max(12).default("手动"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/lib/platform.server");
    const client = db();
    const { data: task, error } = await client
      .from("tasks")
      .insert({
        name: data.name,
        env: data.env,
        browser: data.browser,
        agent_id: data.agentId,
        concurrency: data.concurrency,
        retry: data.retry,
        status: "排队中",
        stage: "等待下发",
        trigger: data.trigger,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { data: cases } = await client
      .from("test_cases")
      .select("id, name, steps")
      .in("id", data.caseIds);
    const rows = (cases ?? []).map((c: Record<string, any>) => ({
      task_id: task["id"],
      case_id: c["id"],
      case_name: c["name"],
      status: "等待中",
      step_total: Array.isArray(c["steps"]) ? c["steps"].length : 0,
      attempt: 1,
    }));
    if (rows.length) await client.from("case_runs").insert(rows);
    await client.from("task_logs").insert({
      task_id: task["id"],
      level: "info",
      message: `任务「${data.name}」已创建，包含 ${rows.length} 个用例`,
    });
    return { id: task["id"] as string };
  });

/** 真实下发：校验节点在线与版本后，把用例排入该节点队列，由客户端领取并用真实 Playwright 执行 */
export const sendTask = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        taskId: z.string().uuid(),
        caseIds: z.array(z.string().uuid()).max(200).optional(),
        skipAutoUpgrade: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { db, readSettings, outdated, pushUpgradeRow } = await import("@/lib/platform.server");
    const client = db();
    const settings = await readSettings(client);
    const { data: task } = await client.from("tasks").select("*").eq("id", data.taskId).maybeSingle();
    if (!task) throw new Error("任务不存在");
    const { data: agent } = await client
      .from("agents")
      .select("*")
      .eq("id", task["agent_id"])
      .maybeSingle();

    const log = (level: string, message: string) =>
      client.from("task_logs").insert({ task_id: data.taskId, level, message });
    const fail = async (stage: string, message: string) => {
      await log("error", message);
      await client.from("tasks").update({ status: "失败", stage }).eq("id", data.taskId);
      return { ok: false as const, message };
    };

    if (!agent) return fail("执行节点不存在", "下发失败：找不到指定执行节点，请先安装并注册客户端");

    const agoSec = (Date.now() - new Date(agent["last_heartbeat"]).getTime()) / 1000;
    if (agoSec > settings.heartbeatTimeoutSec || agent["status"] === "离线") {
      return fail("节点离线，下发中断", `下发失败：执行节点 ${agent["name"]} 当前离线`);
    }

    if (outdated(agent["version"], settings.minAgentVersion)) {
      await log(
        "error",
        `版本校验未通过：节点 ${agent["name"]} 版本 v${agent["version"]} 低于最低要求 v${settings.minAgentVersion}`,
      );
      if (settings.autoUpgrade && !data.skipAutoUpgrade) {
        await pushUpgradeRow(client, agent["id"], "版本拦截自动推送");
        await client
          .from("tasks")
          .update({ status: "下发中", stage: "自动推送升级包中" })
          .eq("id", data.taskId);
        await log("warn", `已自动向 ${agent["name"]} 推送升级包，升级完成后可重新下发`);
        return { ok: false as const, message: "节点版本过低，已自动推送升级包" };
      }
      await client
        .from("tasks")
        .update({ status: "失败", stage: "Agent 版本校验未通过" })
        .eq("id", data.taskId);
      return { ok: false as const, message: "节点版本校验未通过" };
    }

    let q = client
      .from("case_runs")
      .update({
        status: "排队中",
        agent_id: agent["id"],
        error: null,
        duration_ms: null,
        step_index: 0,
        steps: [],
        started_at: new Date().toISOString(),
        finished_at: null,
      })
      .eq("task_id", data.taskId);
    if (data.caseIds?.length) q = q.in("case_id", data.caseIds);
    const { error } = await q;
    if (error) throw new Error(error.message);

    await client
      .from("tasks")
      .update({ status: "下发中", stage: "已下发，等待节点领取", finished_at: null })
      .eq("id", data.taskId);
    await log("info", `已下发至执行节点 ${agent["name"]}（${agent["ip"] || "未知 IP"}）`);
    await log("success", `节点校验通过：v${agent["version"]} · ${agent["os"]} · ${task["browser"]}`);
    return { ok: true as const };
  });

export const abortTask = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ taskId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import("@/lib/platform.server");
    const client = db();
    await client
      .from("case_runs")
      .update({ status: "已跳过", finished_at: new Date().toISOString() })
      .eq("task_id", data.taskId)
      .in("status", ["等待中", "排队中", "执行中"]);
    await client
      .from("tasks")
      .update({ status: "已取消", stage: "已被用户取消", finished_at: new Date().toISOString() })
      .eq("id", data.taskId);
    await client
      .from("task_logs")
      .insert({ task_id: data.taskId, level: "warn", message: "任务已被取消" });
    return { ok: true };
  });

export const retryTaskCases = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ taskId: z.string().uuid(), onlyFailed: z.boolean().default(true) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/lib/platform.server");
    const client = db();
    const { data: runs } = await client
      .from("case_runs")
      .select("id, case_id, status, attempt")
      .eq("task_id", data.taskId);
    const targets = ((runs ?? []) as Record<string, any>[]).filter(
      (r) => !data.onlyFailed || r["status"] === "失败",
    );
    if (!targets.length) return { ok: false as const, message: "没有需要重跑的用例" };
    await Promise.all(
      targets.map((r) =>
        client
          .from("case_runs")
          .update({ attempt: (r["attempt"] ?? 1) + 1 })
          .eq("id", r["id"]),
      ),
    );
    await client.from("task_logs").insert({
      task_id: data.taskId,
      level: "warn",
      message: data.onlyFailed ? `发起失败重跑：${targets.length} 个用例` : "发起全量重跑",
    });
    return {
      ok: true as const,
      caseIds: targets.map((r) => r["case_id"] as string).filter(Boolean),
    };
  });

export const pushAgentUpgrade = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ agentId: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }) => {
    const { db, pushUpgradeRow } = await import("@/lib/platform.server");
    return pushUpgradeRow(db(), data.agentId, "手动推送");
  });

/** 平台侧把节点标记为离线/恢复可用（离线标记仅在下一次心跳前有效） */
export const toggleAgent = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ agentId: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import("@/lib/platform.server");
    const client = db();
    const { data: agent } = await client
      .from("agents")
      .select("status")
      .eq("id", data.agentId)
      .maybeSingle();
    if (!agent) throw new Error("节点不存在");
    const next = agent["status"] === "离线" ? "在线" : "离线";
    await client.from("agents").update({ status: next }).eq("id", data.agentId);
    return { status: next };
  });

/** 某条用例的真实执行历史（含步骤结果与日志），供用例详情的流程图调试使用 */
export const fetchCaseRuns = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ caseId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import("@/lib/platform.server");
    const client = db();
    const { data: runs } = await client
      .from("case_runs")
      .select("id, case_name, agent_id, status, duration_ms, error, steps, started_at")
      .eq("case_id", data.caseId)
      .order("started_at", { ascending: false })
      .limit(10);
    const rows = (runs ?? []) as Record<string, any>[];
    const ids = rows.map((r) => r["id"] as string);
    const { data: logs } = ids.length
      ? await client
          .from("run_logs")
          .select("id, run_id, level, message, at")
          .in("run_id", ids)
          .order("at", { ascending: true })
          .limit(2000)
      : { data: [] as Record<string, any>[] };
    return {
      runs: rows.map((r) => ({
        id: r["id"] as string,
        agentId: (r["agent_id"] as string) ?? "",
        status: (r["status"] as string) ?? "",
        durationMs: (r["duration_ms"] as number) ?? 0,
        error: (r["error"] as string) ?? "",
        startedAt: (r["started_at"] as string) ?? "",
        steps: ((r["steps"] as unknown[]) ?? []) as {
          index: number;
          keyword?: string;
          status?: string;
          durationMs?: number;
          error?: string;
        }[],
      })),
      logs: ((logs ?? []) as Record<string, any>[]).map((l) => ({
        id: String(l["id"]),
        runId: (l["run_id"] as string) ?? "",
        level: (l["level"] as string) ?? "info",
        message: (l["message"] as string) ?? "",
        at: (l["at"] as string) ?? "",
      })),
    };
  });

export type CaseStat = {
  caseId: string;
  caseName: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  avgDurationMs: number;
  lastStatus: string;
  lastRunAt: string;
};

/** 用例维度聚合统计：执行次数 / 通过率 / 平均耗时，失败用例自动置顶 */
export const fetchCaseStats = createServerFn({ method: "GET" }).handler(async () => {
  const { db } = await import("@/lib/platform.server");
  const client = db();
  const { data: runs } = await client
    .from("case_runs")
    .select("case_id, case_name, status, duration_ms, started_at")
    .order("started_at", { ascending: false })
    .limit(5000);
  const map = new Map<string, CaseStat & { durationSum: number; durationCount: number }>();
  for (const r of (runs ?? []) as Record<string, any>[]) {
    const key = (r["case_id"] as string) ?? (r["case_name"] as string) ?? "unknown";
    let s = map.get(key);
    if (!s) {
      s = {
        caseId: (r["case_id"] as string) ?? "",
        caseName: (r["case_name"] as string) || "未命名用例",
        total: 0,
        passed: 0,
        failed: 0,
        passRate: 0,
        avgDurationMs: 0,
        lastStatus: "",
        lastRunAt: "",
        durationSum: 0,
        durationCount: 0,
      };
      map.set(key, s);
    }
    s.total += 1;
    const status = (r["status"] as string) ?? "";
    if (status === "通过") s.passed += 1;
    if (status === "失败") s.failed += 1;
    const dur = r["duration_ms"] as number | null;
    if (typeof dur === "number" && dur > 0) {
      s.durationSum += dur;
      s.durationCount += 1;
    }
    const at = (r["started_at"] as string) ?? "";
    if (!s.lastRunAt || at > s.lastRunAt) {
      s.lastRunAt = at;
      s.lastStatus = status;
    }
  }
  const stats: CaseStat[] = [...map.values()].map(({ durationSum, durationCount, ...s }) => ({
    ...s,
    passRate: s.total ? Math.round((s.passed / s.total) * 100) : 0,
    avgDurationMs: durationCount ? Math.round(durationSum / durationCount) : 0,
  }));
  // 失败用例自动置顶：先按失败次数降序，再按总执行次数降序
  stats.sort((a, b) => b.failed - a.failed || b.total - a.total);
  return { stats };
});
