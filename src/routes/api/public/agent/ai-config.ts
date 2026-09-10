import { createFileRoute } from "@tanstack/react-router";

/**
 * 客户端启动时读取平台当前生效的 AI 配置（模型全部来自平台数据库，不依赖任何外部清单）。
 * 只返回模型名称与抓取参数，绝不返回密钥。
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
          configured: s.mode === "lovable" ? true : Boolean(s.baseUrl && s.apiKey && s.models.length),
          inspectScreenshot: s.inspectScreenshot,
          inspectCacheMinutes: s.inspectCacheMinutes,
          retry: { maxAttempts: 3, delaysMs: [2000, 5000, 10_000] },
          updatedAt: s.updatedAt,
        });
      },
    },
  },
});
