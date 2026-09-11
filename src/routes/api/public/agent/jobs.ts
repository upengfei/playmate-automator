import { createFileRoute } from "@tanstack/react-router";

const DONE = ["通过", "失败", "已跳过"];

/** 客户端轮询领取平台下发的执行任务（排队中的执行记录，遵守用例依赖关系） */
export const Route = createFileRoute("/api/public/agent/jobs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const agentId = url.searchParams.get("agentId") ?? "";
        const token = url.searchParams.get("token") ?? "";
        const { admin, verifyAgent } = await import("@/lib/agent-db.server");
        const { caseRepo } = await import("@/lib/case-repo.server");
        if (!(await verifyAgent(agentId, token))) {
          return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
        }
        const db = admin();
        const { data, error } = await db
          .from("case_runs")
          .select(
            "id, task_id, case_id, case_name, case_version, depends_on_case_id",
          )
          .eq("agent_id", agentId)
          .eq("status", "排队中")
          .order("started_at", { ascending: true })
          .limit(10);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        let rows = (data ?? []) as Record<string, any>[];

        /* -------- 用例依赖：前置用例通过后才可执行，前置失败/跳过则自动跳过 -------- */
        const taskIds = [...new Set(rows.map((r) => r["task_id"]).filter(Boolean))];
        const { data: siblings } = taskIds.length
          ? await db.from("case_runs").select("task_id, case_id, status").in("task_id", taskIds)
          : { data: [] as Record<string, any>[] };
        const statusOf = new Map<string, string>(
          ((siblings ?? []) as Record<string, any>[]).map((r) => [
            `${r["task_id"]}:${r["case_id"]}`,
            r["status"] as string,
          ]),
        );

        const skipped: Record<string, any>[] = [];
        const runnable: Record<string, any>[] = [];
        for (const r of rows) {
          const dep = r["depends_on_case_id"] as string | null;
          if (!dep) {
            runnable.push(r);
            continue;
          }
          const depStatus = statusOf.get(`${r["task_id"]}:${dep}`) ?? "等待中";
          if (depStatus === "通过") runnable.push(r);
          else if (DONE.includes(depStatus)) skipped.push(r);
          // 前置仍在等待/执行中：本轮不下发，保持排队
        }

        for (const r of skipped) {
          await db
            .from("case_runs")
            .update({
              status: "已跳过",
              error: "前置用例未通过，已自动跳过",
              finished_at: new Date().toISOString(),
            })
            .eq("id", r["id"]);
          await db.from("task_logs").insert({
            task_id: r["task_id"],
            level: "warn",
            message: `用例「${r["case_name"]}」的前置用例未通过，已自动跳过`,
          });
        }

        // 串行依赖任务每轮只放行一个用例，保证执行顺序
        const serialTasks = new Set(
          rows.filter((r) => r["depends_on_case_id"]).map((r) => r["task_id"] as string),
        );
        const perTask = new Map<string, number>();
        rows = runnable
          .filter((r) => {
            const t = r["task_id"] as string;
            if (!serialTasks.has(t)) return true;
            const n = perTask.get(t) ?? 0;
            perTask.set(t, n + 1);
            return n === 0;
          })
          .slice(0, 3);

        // 下发时携带版本号；若任务锁定的是旧版本，则取该版本的历史快照，保证客户端执行的是旧版本内容
        const repo = await caseRepo();
        const caseById = new Map<string, Record<string, any>>();
        for (const id of [...new Set(rows.map((r) => r["case_id"]).filter(Boolean))]) {
          const c = await repo.getCase(id as string);
          if (c) caseById.set(id as string, c as unknown as Record<string, any>);
        }
        const snapshots = new Map<string, Record<string, any>>();
        for (const r of rows) {
          const c = caseById.get(r["case_id"]);
          if (!r["case_id"] || !r["case_version"] || r["case_version"] === c?.["version"]) continue;
          const snap = await repo.getVersion(r["case_id"] as string, r["case_version"] as number);
          if (snap) snapshots.set(`${r["case_id"]}:${r["case_version"]}`, snap as unknown as Record<string, any>);
        }

        // 参数化替换：用例默认值 < 环境绑定 < 设备绑定
        const { readParamBindings, resolveParamMap, applyParams, applyParamsToSteps, missingParams } =
          await import("@/lib/case-params.server");
        const bindings = await readParamBindings(db);
        const { data: taskRows } = taskIds.length
          ? await db.from("tasks").select("id, env, browser, headless").in("id", taskIds)
          : { data: [] as Record<string, any>[] };
        const envOf = new Map<string, string>(
          ((taskRows ?? []) as Record<string, any>[]).map((t) => [t["id"] as string, (t["env"] as string) ?? ""]),
        );
        // 平台下发一律无头执行，客户端忽略本机「有头」偏好
        const headlessOf = new Map<string, boolean>(
          ((taskRows ?? []) as Record<string, unknown>[]).map((t) => [
            t["id"] as string,
            t["headless"] === false ? false : true,
          ]),
        );
        const browserOf = new Map<string, string>(
          ((taskRows ?? []) as Record<string, unknown>[]).map((t) => [
            t["id"] as string,
            String(t["browser"] ?? "Chromium").toLowerCase(),
          ]),
        );

        const jobs = rows.map((r) => {
          const c = caseById.get(r["case_id"]);
          const snap = snapshots.get(`${r["case_id"]}:${r["case_version"]}`);
          const src = snap ?? c ?? {};
          const map = resolveParamMap(
            (src["params"] as unknown[]) ?? (c?.["params"] as unknown[]) ?? [],
            bindings,
            envOf.get(r["task_id"] as string) ?? "",
            agentId,
          );
          const steps = applyParamsToSteps((src["steps"] as unknown[]) ?? [], map);
          const startUrl = applyParams((src["start_url"] as string) ?? "", map);
          const script = applyParams((src["script"] as string) ?? "", map);
          const missing = missingParams(
            [
              (src["start_url"] as string) ?? "",
              ...(((src["steps"] as any[]) ?? []).flatMap((st) => [st?.target ?? "", st?.value ?? ""])),
            ],
            map,
          );
          return {
            runId: r["id"] as string,
            caseId: r["case_id"] as string,
            name: r["case_name"] as string,
            caseVersion: (r["case_version"] as number) ?? (c?.["version"] as number) ?? 1,
            fromSnapshot: Boolean(snap),
            browser: browserOf.get(r["task_id"] as string) ?? "chromium",
            headless: headlessOf.get(r["task_id"] as string) ?? true,
            dependsOnCaseId: (r["depends_on_case_id"] as string) ?? null,
            steps,
            startUrl,
            script,
            params: map,
            missingParams: missing,
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
