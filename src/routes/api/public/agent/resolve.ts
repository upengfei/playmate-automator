import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({ token: z.string().min(16).max(128) });

/** 客户端首次配置：用平台下发的节点令牌换出设备标识与登记名称 */
export const Route = createFileRoute("/api/public/agent/resolve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "节点令牌格式不正确" }, { status: 400 });

        const { findAgentByToken } = await import("@/lib/agent-store.server");
        const agentId = await findAgentByToken(parsed.data.token.trim());
        if (!agentId) return Response.json({ error: "节点令牌无效，请在平台重新获取" }, { status: 401 });

        let name = agentId;
        try {
          const { admin } = await import("@/lib/agent-db.server");
          const { data } = await admin().from("agents").select("name").eq("id", agentId).maybeSingle();
          name = ((data as { name?: string } | null)?.name || agentId) as string;
        } catch {
          /* 台账不可用时用设备标识兜底 */
        }

        return Response.json({ ok: true, agentId, name });
      },
    },
  },
});
