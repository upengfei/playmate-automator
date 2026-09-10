import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const paramSchema = z.object({
  name: z.string().min(1).max(60),
  value: z.string().max(500).default(""),
  note: z.string().max(120).default(""),
});

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

/** Refresh the same public release metadata used by the platform snapshot. */
export const refreshAgentRelease = createServerFn({ method: "POST" }).handler(async () => {
  const { readRelease } = await import("@/lib/agent-fleet.server");
  return readRelease({ force: true });
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
        params: z.array(paramSchema).max(50).default([]),
        isTemplate: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { caseRepo } = await import("@/lib/case-repo.server");
    const { generatePlaywrightCode, validateCaseSteps } = await import("@/lib/keywords");
    const stepError = validateCaseSteps(data.steps);
    if (stepError) throw new Error(stepError);
    const repo = await caseRepo();
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
      params: data.params,
      is_template: data.isTemplate,
      updated_at: new Date().toISOString(),
    };

    const snapshot = (caseId: string, version: number, note: string) =>
      repo.insertVersion({
        case_id: caseId,
        version,
        name: data.name,
        module: data.module,
        priority: data.priority,
        start_url: data.startUrl,
        steps: data.steps,
        script,
        params: data.params,
        note,
        author: data.author,
        source: data.source,
      });

    if (data.id) {
      const current = await repo.getCase(data.id);
      const nextVersion = (current?.version ?? 1) + 1;
      await repo.updateCase(data.id, { ...row, version: nextVersion });
      await snapshot(data.id, nextVersion, "保存修改");
      return { id: data.id, version: nextVersion };
    }
    const created = await repo.insertCase({ ...row, version: 1 });
    await snapshot(created.id, 1, "初始版本");
    return { id: created.id, version: 1 };
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
  params: { name: string; value: string; note?: string }[];
};

/** 某条用例的真实版本历史 */
export const fetchCaseVersions = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ caseId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { caseRepo } = await import("@/lib/case-repo.server");
    const repo = await caseRepo();
    const [rows, current] = await Promise.all([
      repo.listVersions(data.caseId, 50),
      repo.getCase(data.caseId),
    ]);
    const versions: CaseVersion[] = rows.map((r) => ({
      id: r.id,
      version: r.version ?? 1,
      name: r.name ?? "",
      module: r.module ?? "",
      priority: r.priority ?? "P1",
      startUrl: r.start_url ?? "",
      note: r.note ?? "",
      author: r.author ?? "",
      source: r.source ?? "",
      createdAt: r.created_at ?? "",
      steps: (r.steps ?? []) as CaseVersion["steps"],
      script: r.script ?? "",
      params: (r.params ?? []) as CaseVersion["params"],
    }));
    return { versions, currentVersion: current?.version ?? 1 };
  });

/** 回滚到指定历史版本：以旧内容生成一个新版本，保证历史可追溯 */
export const rollbackCase = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ caseId: z.string().uuid(), version: z.number().int().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { caseRepo } = await import("@/lib/case-repo.server");
    const repo = await caseRepo();
    const target = await repo.getVersion(data.caseId, data.version);
    if (!target) throw new Error("找不到该版本");
    const current = await repo.getCase(data.caseId);
    const nextVersion = (current?.version ?? 1) + 1;
    await repo.updateCase(data.caseId, {
      name: target.name,
      module: target.module,
      priority: target.priority,
      start_url: target.start_url,
      steps: target.steps,
      script: target.script,
      params: target.params ?? [],
      version: nextVersion,
      updated_at: new Date().toISOString(),
    });
    await repo.insertVersion({
      case_id: data.caseId,
      version: nextVersion,
      name: target.name,
      module: target.module,
      priority: target.priority,
      start_url: target.start_url,
      steps: target.steps,
      script: target.script,
      params: target.params ?? [],
      note: `回滚自 v${data.version}`,
      author: target.author,
      source: target.source,
    });
    return { version: nextVersion };
  });


export const removeCase = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { caseRepo } = await import("@/lib/case-repo.server");
    await (await caseRepo()).deleteCase(data.id);

    return { ok: true };
  });


/** 从模板用例派生一个新用例（参数默认值一并复制，可再按需覆盖） */
export const createCaseFromTemplate = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        templateId: z.string().uuid(),
        name: z.string().min(1).max(120),
        params: z.array(paramSchema).max(50).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { caseRepo } = await import("@/lib/case-repo.server");
    const repo = await caseRepo();
    const tpl = await repo.getCase(data.templateId);
    if (!tpl) throw new Error("找不到模板用例");
    const params = data.params.length ? data.params : ((tpl.params ?? []) as typeof data.params);
    const created = await repo.insertCase({
      name: data.name,
      module: tpl.module,
      priority: tpl.priority,
      tags: tpl.tags,
      author: tpl.author,
      status: "草稿",
      source: tpl.source,
      start_url: tpl.start_url,
      steps: tpl.steps,
      script: tpl.script,
      params,
      is_template: false,
      version: 1,
      updated_at: new Date().toISOString(),
    });
    await repo.insertVersion({
      case_id: created.id,
      version: 1,
      name: data.name,
      module: tpl.module,
      priority: tpl.priority,
      start_url: tpl.start_url,
      steps: tpl.steps,
      script: tpl.script,
      params,
      note: `由模板「${tpl.name}」创建`,
      author: tpl.author,
      source: tpl.source,
    });
    return { id: created.id };
  });

/** 新增或更新一条环境 / 设备参数绑定 */
export const saveParamBinding = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        scope: z.enum(["环境", "设备"]),
        scopeKey: z.string().min(1).max(64),
        name: z.string().min(1).max(60),
        value: z.string().max(500).default(""),
        note: z.string().max(120).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/lib/platform.server");
    const { error } = await db()
      .from("param_bindings")
      .upsert(
        {
          scope: data.scope,
          scope_key: data.scopeKey,
          name: data.name,
          value: data.value,
          note: data.note,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "scope,scope_key,name" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeParamBinding = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import("@/lib/platform.server");
    await db().from("param_bindings").delete().eq("id", data.id);
    return { ok: true };
  });

/**
 * 平台端为一台真实设备注册节点并签发节点令牌（需登录）。
 * 客户端拿到该令牌后，注册 / 心跳 / 领任务 / 回传执行结果 / 回传升级结果都会带上它，
 * 平台侧一律用 verifyAgent 校验，未通过直接 401。
 */
export const registerAgentDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        agentId: z
          .string()
          .min(2)
          .max(64)
          .regex(/^[A-Za-z0-9_.\-]+$/, "节点标识只能使用字母、数字、下划线、点和短横线"),
        name: z.string().max(64).default(""),
        rotate: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { newToken } = await import("@/lib/agent-db.server");
    const { readAgentToken, writeAgentToken } = await import("@/lib/agent-store.server");

    let token = await readAgentToken(data.agentId);
    if (!token || data.rotate) {
      token = newToken();
      await writeAgentToken(data.agentId, token);
    }

    // 设备台账仍写入平台数据库，供节点看板展示；写入失败不影响令牌签发
    try {
      const { admin } = await import("@/lib/agent-db.server");
      await admin()
        .from("agents")
        .upsert({
          id: data.agentId,
          name: data.name || data.agentId,
          status: "离线",
          last_heartbeat: new Date(0).toISOString(),
        });
    } catch (err) {
      console.warn("[register-device] 设备台账写入失败：", (err as Error).message);
    }

    return { agentId: data.agentId, token, registeredBy: context.userId };
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
        /** 串行依赖：按所选顺序，前置用例通过后才执行下一个，失败则自动跳过后续 */
        serialDependency: z.boolean().default(false),
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
        concurrency: data.serialDependency ? 1 : data.concurrency,
        retry: data.retry,
        status: "排队中",
        stage: "等待下发",
        trigger: data.trigger,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { caseRepo } = await import("@/lib/case-repo.server");
    const repo = await caseRepo();
    const cases = await Promise.all(data.caseIds.map((id) => repo.getCase(id)));
    // 按用户选择顺序排列，依赖链才与编排顺序一致
    const ordered = cases.filter(Boolean).map((c) => c as unknown as Record<string, any>);

    const rows = ordered.map((c, i) => ({
      task_id: task["id"],
      case_id: c["id"],
      case_name: c["name"],
      status: "等待中",
      step_total: Array.isArray(c["steps"]) ? c["steps"].length : 0,
      case_version: (c["version"] as number) ?? 1,
      attempt: 1,
      depends_on_case_id: data.serialDependency && i > 0 ? ordered[i - 1]!["id"] : null,
    }));
    if (rows.length) await client.from("case_runs").insert(rows);
    await client.from("task_logs").insert({
      task_id: task["id"],
      level: "info",
      message: data.serialDependency
        ? `任务「${data.name}」已创建，包含 ${rows.length} 个用例，已启用串行依赖（前置用例通过后才执行下一个）`
        : `任务「${data.name}」已创建，包含 ${rows.length} 个用例`,
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
        // 明确指定时保留任务创建时锁定的历史版本，默认下发平台最新版本
        pinVersion: z.boolean().default(false),
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
        const pushed = await pushUpgradeRow(client, agent["id"], "版本拦截自动推送");
        if (!pushed.ok) return fail("升级包不可用", pushed.message);
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

    const reset = {
      status: "排队中",
      agent_id: agent["id"],
      error: null,
      duration_ms: null,
      step_index: 0,
      steps: [],
      started_at: new Date().toISOString(),
      finished_at: null,
    };

    let q = client.from("case_runs").update(reset).eq("task_id", data.taskId);
    if (data.caseIds?.length) q = q.in("case_id", data.caseIds);
    const { error } = await q;
    if (error) throw new Error(error.message);

    // 重新下发时默认同步到平台最新版本，否则平台改完用例，节点仍会执行旧版本快照
    if (!data.pinVersion) {
      const { caseRepo } = await import("@/lib/case-repo.server");
      const repo = await caseRepo();
      let rowsQuery = client.from("case_runs").select("id, case_id").eq("task_id", data.taskId);
      if (data.caseIds?.length) rowsQuery = rowsQuery.in("case_id", data.caseIds);
      const { data: rows } = await rowsQuery;
      for (const row of rows ?? []) {
        const caseId = row["case_id"] as string | null;
        if (!caseId) continue;
        const latest = await repo.getCase(caseId);
        if (!latest) continue;
        await client
          .from("case_runs")
          .update({
            case_version: (latest["version"] as number) ?? 1,
            case_name: latest["name"],
            step_total: ((latest["steps"] as unknown[]) ?? []).length,
          })
          .eq("id", row["id"] as string);
      }
      await log("info", "已同步各用例最新版本，本次执行使用平台最新步骤");
    }

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

export type AgentStat = {
  agentId: string;
  claimed: number;
  passed: number;
  failed: number;
  running: number;
  skipped: number;
  passRate: number;
  avgDurationMs: number;
  lastRunAt: string;
  lastCaseName: string;
  lastStatus: string;
};

/** 设备维度聚合：任务领取数、成功率、平均耗时，与任务队列联动 */
export const fetchAgentStats = createServerFn({ method: "GET" }).handler(async () => {
  const { db } = await import("@/lib/platform.server");
  const client = db();
  const { data: runs } = await client
    .from("case_runs")
    .select("agent_id, case_name, status, duration_ms, started_at, task_id")
    .order("started_at", { ascending: false })
    .limit(5000);
  const map = new Map<string, AgentStat & { sum: number; count: number; tasks: Set<string> }>();
  for (const r of (runs ?? []) as Record<string, any>[]) {
    const id = (r["agent_id"] as string) ?? "";
    if (!id) continue;
    let s = map.get(id);
    if (!s) {
      s = {
        agentId: id,
        claimed: 0,
        passed: 0,
        failed: 0,
        running: 0,
        skipped: 0,
        passRate: 0,
        avgDurationMs: 0,
        lastRunAt: "",
        lastCaseName: "",
        lastStatus: "",
        sum: 0,
        count: 0,
        tasks: new Set<string>(),
      };
      map.set(id, s);
    }
    s.claimed += 1;
    const status = (r["status"] as string) ?? "";
    if (status === "通过") s.passed += 1;
    else if (status === "失败") s.failed += 1;
    else if (status === "已跳过") s.skipped += 1;
    else s.running += 1;
    const taskId = r["task_id"] as string | null;
    if (taskId) s.tasks.add(taskId);
    const dur = r["duration_ms"] as number | null;
    if (typeof dur === "number" && dur > 0) {
      s.sum += dur;
      s.count += 1;
    }
    const at = (r["started_at"] as string) ?? "";
    if (!s.lastRunAt || at > s.lastRunAt) {
      s.lastRunAt = at;
      s.lastStatus = status;
      s.lastCaseName = (r["case_name"] as string) ?? "";
    }
  }
  const stats = [...map.values()].map(({ sum, count, tasks, ...s }) => ({
    ...s,
    taskCount: tasks.size,
    passRate: s.passed + s.failed ? Math.round((s.passed / (s.passed + s.failed)) * 100) : 0,
    avgDurationMs: count ? Math.round(sum / count) : 0,
  }));
  stats.sort((a, b) => b.claimed - a.claimed);
  return { stats };
});
