import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const pushSchema = z.object({ agentId: z.string().min(1).max(64) });

/**
 * GET  ?agentId=&version=  桌面 Agent 轮询是否有待处理的升级推送
 * POST { agentId }         平台推送升级包
 */
export const Route = createFileRoute("/api/public/agent/upgrade")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const agentId = url.searchParams.get("agentId");
        const version = url.searchParams.get("version") ?? "0.0.0";
        if (!agentId) return new Response("missing agentId", { status: 400 });
        const { compareVersion, RELEASE } = await import("@/lib/agent-fleet.server");
        const { db, readSettings, pushUpgradeRow } = await import("@/lib/platform.server");
        const client = db();
        const settings = await readSettings(client);

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
                  { level: "info", text: "节点已领取升级指令，开始下载安装包", time: new Date().toISOString() },
                ],
              })
              .eq("id", (job as Record<string, string>)["id"]);
          }
          return Response.json({
            pending: true,
            jobId: (job as Record<string, string>)["id"],
            reason: "平台推送升级包",
            toVersion: RELEASE.version,
          });
        }

        // 版本低于最低支持版本时自动建单推送
        if (compareVersion(version, settings.minAgentVersion) < 0) {
          const created = await pushUpgradeRow(client, agentId, "版本拦截自动推送");
          return Response.json({
            pending: true,
            jobId: created.ok ? created.id : null,
            reason: "版本低于最低支持版本",
            toVersion: RELEASE.version,
          });
        }

        return Response.json({ pending: false, jobId: null, reason: null, toVersion: RELEASE.version });
      },
      POST: async ({ request }) => {
        const parsed = pushSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("invalid payload", { status: 400 });
        const { db, pushUpgradeRow } = await import("@/lib/platform.server");
        const res = await pushUpgradeRow(db(), parsed.data.agentId, "手动推送");
        if (!res.ok) return Response.json({ error: res.message }, { status: 400 });
        return Response.json({ ok: true, jobId: res.id });
      },
    },
  },
});
