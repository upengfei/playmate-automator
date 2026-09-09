import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  agentId: z.string().min(1).max(64),
  ok: z.boolean().optional(),
  stage: z.string().max(20).optional(),
  progress: z.number().min(0).max(100).optional(),
  message: z.string().max(500).default(""),
  installedVersion: z.string().max(32).default("0.0.0"),
  fromVersion: z.string().max(32).optional(),
  durationMs: z.number().nonnegative().optional(),
  reportedAt: z.string().max(64).optional(),
});

/** 桌面 Agent 升级进度与结果回传（写入真实升级记录） */
export const Route = createFileRoute("/api/public/agent/upgrade-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("invalid payload", { status: 400 });
        const d = parsed.data;
        const { db } = await import("@/lib/platform.server");
        const client = db();
        const { data: job } = await client
          .from("agent_upgrades")
          .select("id, logs")
          .eq("agent_id", d.agentId)
          .eq("status", "进行中")
          .order("started_at", { ascending: false })
          .maybeSingle();
        if (!job) return Response.json({ ok: true, ignored: true });

        const logs = [
          ...(((job as Record<string, unknown>)["logs"] as unknown[]) ?? []),
          {
            level: d.ok === false ? "error" : d.ok === true ? "success" : "info",
            text: d.message || d.stage || "升级进度更新",
            time: d.reportedAt ?? new Date().toISOString(),
          },
        ];
        const id = (job as Record<string, string>)["id"];

        if (d.ok === undefined) {
          await client
            .from("agent_upgrades")
            .update({
              ...(d.stage ? { stage: d.stage } : {}),
              ...(d.progress !== undefined ? { progress: Math.round(d.progress) } : {}),
              logs,
            })
            .eq("id", id);
          return Response.json({ ok: true });
        }

        await client
          .from("agent_upgrades")
          .update({
            stage: "回传结果",
            progress: 100,
            status: d.ok ? "成功" : "失败",
            finished_at: new Date().toISOString(),
            report: {
              ok: d.ok,
              message: d.message,
              installedVersion: d.installedVersion,
              durationMs: d.durationMs ?? 0,
              reportedAt: d.reportedAt ?? new Date().toISOString(),
            },
            logs,
          })
          .eq("id", id);

        if (d.ok) {
          await client
            .from("agents")
            .update({ version: d.installedVersion, last_heartbeat: new Date().toISOString() })
            .eq("id", d.agentId);
        }
        return Response.json({ ok: true });
      },
      GET: async ({ request }) => {
        const agentId = new URL(request.url).searchParams.get("agentId");
        const { db } = await import("@/lib/platform.server");
        let q = db()
          .from("agent_upgrades")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(50);
        if (agentId) q = q.eq("agent_id", agentId);
        const { data } = await q;
        return Response.json({ reports: data ?? [] });
      },
    },
  },
});
