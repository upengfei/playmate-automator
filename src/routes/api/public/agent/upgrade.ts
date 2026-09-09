import { createFileRoute } from "@tanstack/react-router";

/**
 * GET ?agentId=&token=&version=  桌面 Agent 轮询是否有待处理的升级推送。
 * 与任务领取、执行结果回传一致，必须携带注册时下发的节点令牌。
 * 平台侧的手动推送走已登录的平台接口（pushAgentUpgrade），不再对外公开。
 */
export const Route = createFileRoute("/api/public/agent/upgrade")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const agentId = url.searchParams.get("agentId") ?? "";
        const token = url.searchParams.get("token") ?? "";
        const version = url.searchParams.get("version") ?? "0.0.0";
        if (!agentId) return Response.json({ error: "缺少节点标识" }, { status: 400 });

        const { verifyAgent } = await import("@/lib/agent-db.server");
        if (!(await verifyAgent(agentId, token))) {
          return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
        }

        const { compareVersion, readRelease } = await import("@/lib/agent-fleet.server");
        const { db, readSettings, pushUpgradeRow } = await import("@/lib/platform.server");
        const client = db();
        const [settings, release] = await Promise.all([readSettings(client), readRelease(client)]);

        const { data: job } = await client
          .from("agent_upgrades")
          .select("id, stage, logs")
          .eq("agent_id", agentId)
          .eq("status", "进行中")
          .order("started_at", { ascending: false })
          .maybeSingle();

        if (job) {
          if ((job as Record<string, unknown>)["stage"] === "排队中") {
            await client
              .from("agent_upgrades")
              .update({
                stage: "下发升级包",
                progress: 15,
                logs: [
                  ...(((job as Record<string, unknown>)["logs"] as unknown[]) ?? []),
                  {
                    level: "info",
                    text: "节点已领取升级指令，开始下载安装包",
                    time: new Date().toISOString(),
                  },
                ],
              })
              .eq("id", (job as Record<string, string>)["id"]);
          }
          return Response.json({
            pending: true,
            jobId: (job as Record<string, string>)["id"],
            reason: "平台推送升级包",
            toVersion: release.version,
          });
        }

        // 版本低于最低支持版本时自动建单推送
        if (compareVersion(version, settings.minAgentVersion) < 0) {
          const created = await pushUpgradeRow(client, agentId, "版本拦截自动推送");
          return Response.json({
            pending: true,
            jobId: created.ok ? created.id : null,
            reason: "版本低于最低支持版本",
            toVersion: release.version,
          });
        }

        return Response.json({
          pending: false,
          jobId: null,
          reason: null,
          toVersion: release.version,
        });
      },
    },
  },
});
