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
          .select("id, case_id, case_name, case_version, test_cases(steps, start_url, script, version)")
          .eq("agent_id", agentId)
          .eq("status", "排队中")
          .order("started_at", { ascending: true })
          .limit(3);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const rows = (data ?? []) as Record<string, any>[];
        // 下发时携带版本号；若任务锁定的是旧版本，则取该版本的历史快照，保证客户端执行的是旧版本内容
        const snapshots = new Map<string, Record<string, any>>();
        const wanted = rows.filter(
          (r) => r["case_id"] && r["case_version"] && r["case_version"] !== r["test_cases"]?.["version"],
        );
        for (const r of wanted) {
          const { data: snap } = await db
            .from("case_versions")
            .select("steps, start_url, script, version")
            .eq("case_id", r["case_id"])
            .eq("version", r["case_version"])
            .maybeSingle();
          if (snap) snapshots.set(`${r["case_id"]}:${r["case_version"]}`, snap);
        }

        const jobs = rows.map((r) => {
          const c = r["test_cases"] as Record<string, any> | undefined;
          const snap = snapshots.get(`${r["case_id"]}:${r["case_version"]}`);
          const src = snap ?? c ?? {};
          return {
            runId: r["id"] as string,
            caseId: r["case_id"] as string,
            name: r["case_name"] as string,
            caseVersion: (r["case_version"] as number) ?? (c?.["version"] as number) ?? 1,
            fromSnapshot: Boolean(snap),
            steps: (src["steps"] as unknown[]) ?? [],
            startUrl: (src["start_url"] as string) ?? "",
            script: (src["script"] as string) ?? "",
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
