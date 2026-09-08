import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  agentId: z.string().min(2).max(64),
  token: z.string().max(128).optional(),
  name: z.string().max(64).default(""),
  host: z.string().max(128).default(""),
  os: z.string().max(128).default(""),
  version: z.string().max(32).default("0.0.0"),
  capabilities: z.array(z.string().max(32)).max(20).default([]),
  status: z.string().max(16).default("在线"),
});

/** 真实客户端注册与心跳：首次注册下发节点令牌，之后必须携带令牌 */
export const Route = createFileRoute("/api/public/agent/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "参数不合法" }, { status: 400 });
        const d = parsed.data;
        const { admin, verifyAgent, newToken } = await import("@/lib/agent-db.server");
        const db = admin();

        const { data: existingToken } = await db
          .from("agent_tokens")
          .select("token")
          .eq("agent_id", d.agentId)
          .maybeSingle();

        let token = existingToken?.token as string | undefined;
        if (token) {
          const ok = await verifyAgent(d.agentId, d.token ?? "");
          if (!ok) return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
        }

        const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "";
        const { error } = await db.from("agents").upsert({
          id: d.agentId,
          name: d.name || d.agentId,
          host: d.host,
          os: d.os,
          ip: ip.split(",")[0]?.trim() ?? "",
          version: d.version,
          capabilities: d.capabilities,
          status: d.status,
          last_heartbeat: new Date().toISOString(),
        });
        if (error) return Response.json({ error: error.message }, { status: 500 });

        if (!token) {
          token = newToken();
          const { error: tErr } = await db.from("agent_tokens").insert({ agent_id: d.agentId, token });
          if (tErr) return Response.json({ error: tErr.message }, { status: 500 });
        }

        return Response.json({ ok: true, agentId: d.agentId, token });
      },
    },
  },
});
