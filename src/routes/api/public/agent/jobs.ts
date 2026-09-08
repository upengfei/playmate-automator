import { createFileRoute } from "@tanstack/react-router";

/** 客户端轮询领取平台下发的执行任务（排队中的执行记录） */
export const Route = createFileRoute("/api/public/agent/jobs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const agentId = url.searchParams.get("agentId") ?? "";
        const token = url.searchParams.get("token") ?? "";
        const { admin, verifyAgent } = await import("@/lib/agent-db.server");
        if (!(await verifyAgent(agentId, token))) {
          return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
        }
        const db = admin();
        const { data, error } = await db
          .from("case_runs")
          .select("id, case_id, case_name, test_cases(steps, start_url, script)")
          .eq("agent_id", agentId)
          .eq("status", "排队中")
          .order("started_at", { ascending: true })
          .limit(3);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const jobs = (data ?? []).map((r) => {
          const c = (r as { test_cases?: { steps?: unknown; start_url?: string } }).test_cases;
          return {
            runId: r.id,
            caseId: r.case_id,
            name: r.case_name,
            steps: (c?.steps as unknown[]) ?? [],
            startUrl: c?.start_url ?? "",
          };
        });
        if (jobs.length) {
          await db
            .from("case_runs")
            .update({ status: "执行中" })
            .in(
              "id",
              jobs.map((j) => j.runId),
            );
        }
        return Response.json({ jobs });
      },
    },
  },
});
