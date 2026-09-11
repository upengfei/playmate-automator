import { createFileRoute } from "@tanstack/react-router";

/**
 * 客户端启动时查询「平台 AI 代理」是否可用：客户端没填本机模型时会把对话转发到平台模型。
 * 只返回模型名称，绝不返回密钥；抓取截图 / 缓存 / 重试等参数由客户端本机设置。
 */
export const Route = createFileRoute("/api/public/agent/ai-config")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const agentId = url.searchParams.get("agentId") ?? "";
        const token = url.searchParams.get("token") ?? "";
        const { verifyAgent } = await import("@/lib/agent-db.server");
        if (!(await verifyAgent(agentId, token))) {
          return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
        }
        const { readAiSettings } = await import("@/lib/ai-settings.server");
        const s = await readAiSettings();
        return Response.json({
          mode: s.mode,
          models: s.models,
          defaultModel: s.defaultModel || s.models[0] || "",
          configured:
            s.mode === "lovable" ? true : Boolean(s.baseUrl && s.apiKey && s.models.length),
          updatedAt: s.updatedAt,
        });
      },
    },
  },
});
