import { createFileRoute } from "@tanstack/react-router";
import { agentReportSchema } from "@/lib/agent-report-schema";

/** 客户端回传真实执行状态、步骤结果与日志 */
export const Route = createFileRoute("/api/public/agent/run-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = agentReportSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "参数不合法" }, { status: 400 });
        const d = parsed.data;
        const { admin, verifyAgent } = await import("@/lib/agent-db.server");
        if (!(await verifyAgent(d.agentId, d.token))) {
          return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
        }
        const db = admin();
        const finished = d.status !== "执行中";
        const row = {
          case_id: d.caseId ?? null,
          case_name: d.caseName,
          agent_id: d.agentId,
          status: d.status,
          duration_ms: d.durationMs ?? null,
          error: d.error ?? null,
          steps: d.steps,
          finished_at: finished ? new Date().toISOString() : null,
        };

        let runId = d.runId;
        if (runId) {
          const { error } = await db.from("case_runs").update(row).eq("id", runId);
          if (error) return Response.json({ error: error.message }, { status: 500 });
        } else {
          const { data, error } = await db.from("case_runs").insert(row).select("id").single();
          if (error) return Response.json({ error: error.message }, { status: 500 });
          runId = data.id as string;
        }

        if (finished) {
          const { data: agent } = await db
            .from("agents")
            .select("total_runs")
            .eq("id", d.agentId)
            .maybeSingle();
          await db
            .from("agents")
            .update({ total_runs: ((agent?.total_runs as number) ?? 0) + 1 })
            .eq("id", d.agentId);
        }

        if (d.logs.length) {
          await db
            .from("run_logs")
            .insert(d.logs.map((l) => ({ run_id: runId!, level: l.level, message: l.message })));
        }
        return Response.json({ ok: true, runId });
      },
    },
  },
});
