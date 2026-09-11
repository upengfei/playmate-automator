/**
 * 平台端 AI 报告分析可调用的服务端工具（仅服务端，全部只读）。
 *
 * 平台只做测试数据分析：读取本地 SQLite 的执行记录、任务、日志与节点状态。
 * 用例生成与页面元素定位已迁到客户端（见 agent-app/ai.cjs）。
 */
import { tool } from "ai";
import { z } from "zod";
import { analyzeStepResults, findSimilarCases } from "@/lib/ai-analysis";

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function buildAnalysisTools() {
  return {
    query_case_stats: tool({
      description: "按用例统计执行次数、通过率、平均耗时与最近状态，用于分析质量与不稳定用例。",
      inputSchema: z.object({ limit: z.number().nullable().describe("返回条数，默认 20") }),
      execute: async (input) => {
        const { localClient } = await import("@/lib/local-db.server");
        const { data } = await localClient()
          .from("case_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(3000);
        const rows = (data ?? []) as Record<string, any>[];
        const map = new Map<string, any>();
        for (const r of rows) {
          const key = (r["case_id"] as string) || (r["case_name"] as string) || "未知用例";
          const s =
            map.get(key) ??
            map
              .set(key, {
                caseId: r["case_id"] ?? null,
                caseName: r["case_name"] ?? key,
                total: 0,
                passed: 0,
                failed: 0,
                durations: [] as number[],
                lastStatus: r["status"],
                lastAt: r["started_at"],
              })
              .get(key);
          s.total += 1;
          if (r["status"] === "通过") s.passed += 1;
          if (r["status"] === "失败") s.failed += 1;
          const d = Number(r["duration_ms"] ?? 0);
          if (d > 0) s.durations.push(d);
        }
        const list = [...map.values()]
          .map((s) => ({
            caseId: s.caseId,
            caseName: s.caseName,
            total: s.total,
            passed: s.passed,
            failed: s.failed,
            passRate: `${Math.round((s.passed / Math.max(1, s.total)) * 100)}%`,
            avgDurationMs: s.durations.length
              ? Math.round(
                  s.durations.reduce((a: number, b: number) => a + b, 0) / s.durations.length,
                )
              : 0,
            lastStatus: s.lastStatus,
            lastAt: s.lastAt,
          }))
          .sort((a, b) => b.failed - a.failed || b.total - a.total)
          .slice(0, num(input.limit, 20));
        return { totalRuns: rows.length, cases: list };
      },
    }),

    query_runs: tool({
      description: "查询最近的用例执行记录（含状态、耗时、失败原因、所属任务与设备）。",
      inputSchema: z.object({
        status: z
          .string()
          .nullable()
          .describe("按状态过滤：通过 / 失败 / 运行中 / 已跳过，不过滤填 null"),
        agentId: z.string().nullable().describe("按设备过滤，不过滤填 null"),
        limit: z.number().nullable().describe("返回条数，默认 20"),
      }),
      execute: async (input) => {
        const { localClient } = await import("@/lib/local-db.server");
        let q = localClient().from("case_runs").select("*");
        if (input.status) q = q.eq("status", input.status);
        if (input.agentId) q = q.eq("agent_id", input.agentId);
        const { data } = await q.order("started_at", { ascending: false }).limit(num(input.limit, 20));
        return {
          runs: ((data ?? []) as Record<string, any>[]).map((r) => ({
            runId: r["id"],
            taskId: r["task_id"],
            caseId: r["case_id"],
            caseName: r["case_name"],
            caseVersion: r["case_version"],
            agentId: r["agent_id"],
            status: r["status"],
            durationMs: r["duration_ms"],
            error: r["error"],
            startedAt: r["started_at"],
          })),
        };
      },
    }),

    query_run_logs: tool({
      description: "查询某条执行记录的真实运行日志，用于定位失败原因。",
      inputSchema: z.object({ runId: z.string().describe("执行记录 id") }),
      execute: async (input) => {
        const { localClient } = await import("@/lib/local-db.server");
        const { data } = await localClient()
          .from("run_logs")
          .select("*")
          .eq("run_id", input.runId)
          .order("at", { ascending: true })
          .limit(300);
        return {
          logs: ((data ?? []) as Record<string, any>[]).map((l) => ({
            at: l["at"],
            level: l["level"],
            message: l["message"],
          })),
        };
      },
    }),

    list_agents: tool({
      description: "列出执行节点及其在线状态、版本与累计执行次数。",
      inputSchema: z.object({ onlineOnly: z.boolean().nullable().describe("只看在线设备") }),
      execute: async (input) => {
        const { localClient } = await import("@/lib/local-db.server");
        const { data } = await localClient()
          .from("agents")
          .select("*")
          .order("last_heartbeat", { ascending: false })
          .limit(50);
        const nowMs = Date.now();
        const list = ((data ?? []) as Record<string, any>[]).map((a) => {
          const agoSec = Math.round((nowMs - new Date(a["last_heartbeat"]).getTime()) / 1000);
          return {
            agentId: a["id"],
            name: a["name"],
            version: a["version"],
            online: agoSec <= 60 && a["status"] !== "离线",
            heartbeatAgoSec: agoSec,
            totalRuns: a["total_runs"] ?? 0,
          };
        });
        return { agents: input.onlineOnly ? list.filter((a) => a.online) : list };
      },
    }),

    query_step_failures: tool({
      description: "按失败步骤关键字、定位器和归一化错误原因聚合，识别高频失败节点与重复失败模式。",
      inputSchema: z.object({
        caseId: z.string().nullable().describe("只分析指定用例 id；分析全部时填 null"),
        limit: z.number().nullable().describe("返回条数，默认 20"),
      }),
      execute: async (input) => {
        const { localClient } = await import("@/lib/local-db.server");
        let query = localClient().from("case_runs").select("*").eq("status", "失败");
        if (input.caseId) query = query.eq("case_id", input.caseId);
        const { data } = await query.order("started_at", { ascending: false }).limit(3000);
        const result = analyzeStepResults((data ?? []) as Record<string, unknown>[], num(input.limit, 20));
        return { totalFailedRuns: data?.length ?? 0, failures: result.failures };
      },
    }),

    query_slow_steps: tool({
      description: "统计步骤关键字的总耗时、平均耗时和最大耗时，定位真实执行中的慢节点。",
      inputSchema: z.object({
        caseId: z.string().nullable().describe("只分析指定用例 id；分析全部时填 null"),
        limit: z.number().nullable().describe("返回条数，默认 20"),
      }),
      execute: async (input) => {
        const { localClient } = await import("@/lib/local-db.server");
        let query = localClient().from("case_runs").select("*");
        if (input.caseId) query = query.eq("case_id", input.caseId);
        const { data } = await query.order("started_at", { ascending: false }).limit(3000);
        const result = analyzeStepResults((data ?? []) as Record<string, unknown>[], num(input.limit, 20));
        return { totalRuns: data?.length ?? 0, slowSteps: result.slowSteps };
      },
    }),

    query_similar_cases: tool({
      description: "按当前用例的关键字、定位器和值计算步骤相似度，识别可合并或参数化的重复用例。",
      inputSchema: z.object({
        threshold: z.number().nullable().describe("相似度阈值 0 到 1，默认 0.8"),
        limit: z.number().nullable().describe("返回分组数，默认 20"),
      }),
      execute: async (input) => {
        const { caseRepo } = await import("@/lib/case-repo.server");
        const cases = await (await caseRepo()).listCases(1000);
        const threshold = Math.max(0.5, Math.min(1, num(input.threshold, 0.8)));
        return {
          totalCases: cases.length,
          threshold,
          groups: findSimilarCases(cases as unknown as Record<string, unknown>[], threshold, num(input.limit, 20)),
        };
      },
    }),
  };
}
