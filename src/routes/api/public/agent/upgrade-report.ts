import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { listReports, recordReport } from "@/lib/agent-fleet.server";

const schema = z.object({
  agentId: z.string().min(1).max(64),
  ok: z.boolean(),
  message: z.string().max(500).default(""),
  installedVersion: z.string().max(32).default("0.0.0"),
  fromVersion: z.string().max(32).optional(),
  durationMs: z.number().nonnegative().optional(),
  reportedAt: z.string().max(64).optional(),
});

/** 桌面 Agent 升级结果回传（公开端点，仅接受节点自身升级结果） */
export const Route = createFileRoute("/api/public/agent/upgrade-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("invalid payload", { status: 400 });
        const d = parsed.data;
        recordReport({
          agentId: d.agentId,
          ok: d.ok,
          message: d.message,
          installedVersion: d.installedVersion,
          ...(d.fromVersion ? { fromVersion: d.fromVersion } : {}),
          ...(d.durationMs !== undefined ? { durationMs: d.durationMs } : {}),
          reportedAt: d.reportedAt ?? new Date().toISOString(),
        });
        return Response.json({ ok: true });
      },
      GET: async ({ request }) => {
        const agentId = new URL(request.url).searchParams.get("agentId");
        return Response.json({ reports: listReports(agentId ?? undefined) });
      },
    },
  },
});
