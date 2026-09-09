import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** 平台把真实用例下发给真实节点：创建一条排队中的执行记录，客户端会轮询领取 */
export const dispatchToAgent = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ caseId: z.string().uuid(), agentId: z.string().min(2).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { admin } = await import("@/lib/agent-db.server");
    const { caseRepo } = await import("@/lib/case-repo.server");
    const c = await (await caseRepo()).getCase(data.caseId);
    if (!c) throw new Error("用例不存在");
    const db = admin();
    const { data: run, error } = await db
      .from("case_runs")
      .insert({
        case_id: c.id,
        case_name: c.name,
        case_version: c.version ?? 1,
        agent_id: data.agentId,
        status: "排队中",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { runId: run.id as string };
  });


/** 真实节点 / 用例 / 执行记录（全部读本地 SQLite，离线可用） */
export const fetchLiveData = createServerFn({ method: "GET" }).handler(async () => {
  const { admin } = await import("@/lib/agent-db.server");
  const { caseRepo } = await import("@/lib/case-repo.server");
  const db = admin();
  const [agentsRes, runsRes, cases] = await Promise.all([
    db.from("agents").select("*").order("last_heartbeat", { ascending: false }),
    db.from("case_runs").select("*").order("started_at", { ascending: false }).limit(30),
    caseRepo().then((repo) => repo.listCases(50)),
  ]);
  return {
    agents: ((agentsRes.data ?? []) as Record<string, any>[]).map((a) => ({
      id: String(a["id"]),
      name: String(a["name"] ?? a["id"]),
      host: String(a["host"] ?? ""),
      os: String(a["os"] ?? ""),
      version: String(a["version"] ?? ""),
      status: String(a["status"] ?? "离线"),
      last_heartbeat: String(a["last_heartbeat"] ?? ""),
      capabilities: (a["capabilities"] as string[]) ?? [],
    })),
    cases: (cases as unknown as Record<string, any>[]).map((c) => ({
      id: String(c["id"]),
      name: String(c["name"] ?? ""),
      module: String(c["module"] ?? ""),
      start_url: String(c["start_url"] ?? ""),
      source: String(c["source"] ?? ""),
      priority: String(c["priority"] ?? "P1"),
      steps: ((c["steps"] as { keyword?: string; target?: string; value?: string }[]) ?? []),
      updated_at: String(c["updated_at"] ?? ""),
    })),
    runs: ((runsRes.data ?? []) as Record<string, any>[]).map((r) => ({
      id: String(r["id"]),
      case_name: String(r["case_name"] ?? ""),
      agent_id: (r["agent_id"] as string) ?? null,
      status: String(r["status"] ?? ""),
      duration_ms: (r["duration_ms"] as number) ?? null,
      error: (r["error"] as string) ?? null,
      started_at: String(r["started_at"] ?? ""),
    })),
  };
});

/** 某条执行记录的真实日志 */
export const fetchRunLogs = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ runId: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }) => {
    const { admin } = await import("@/lib/agent-db.server");
    const { data: rows } = await admin()
      .from("run_logs")
      .select("*")
      .eq("run_id", data.runId)
      .order("at", { ascending: true })
      .limit(300);
    return {
      logs: ((rows ?? []) as Record<string, any>[]).map((l) => ({
        id: String(l["id"]),
        run_id: (l["run_id"] as string) ?? null,
        level: String(l["level"] ?? "info"),
        message: String(l["message"] ?? ""),
        at: String(l["at"] ?? ""),
      })),
    };
  });
