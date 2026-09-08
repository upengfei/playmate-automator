import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { compareVersion, queueUpgrade, RELEASE, takePendingUpgrade } from "@/lib/agent-fleet.server";

const pushSchema = z.object({ agentId: z.string().min(1).max(64) });

/**
 * GET  ?agentId=&version=  桌面 Agent 轮询是否有待处理的升级推送
 * POST { agentId }         平台在版本校验拦截后推送升级包
 */
export const Route = createFileRoute("/api/public/agent/upgrade")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const agentId = url.searchParams.get("agentId");
        const version = url.searchParams.get("version") ?? "0.0.0";
        if (!agentId) return new Response("missing agentId", { status: 400 });
        const job = takePendingUpgrade(agentId);
        const outdated = compareVersion(version, RELEASE.minSupported) < 0;
        return Response.json({
          pending: Boolean(job) || outdated,
          jobId: job?.jobId ?? null,
          reason: job ? "平台推送升级包" : outdated ? "版本低于最低支持版本" : null,
          toVersion: RELEASE.version,
        });
      },
      POST: async ({ request }) => {
        const parsed = pushSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("invalid payload", { status: 400 });
        const job = queueUpgrade(parsed.data.agentId);
        return Response.json({ ok: true, ...job });
      },
    },
  },
});
