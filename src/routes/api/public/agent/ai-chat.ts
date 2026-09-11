import { createFileRoute } from "@tanstack/react-router";

/**
 * 客户端 AI 助手的平台代理：客户端没有填本机模型时，把对话转发到平台配置的模型。
 * 用节点令牌鉴权；平台只负责生成步骤，用例仍由客户端本地草稿保存，用户确认后才上传。
 */
export const Route = createFileRoute("/api/public/agent/ai-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            agentId?: string;
            token?: string;
            model?: string;
            messages?: { role?: string; content?: string }[];
          };
          const { verifyAgent } = await import("@/lib/agent-db.server");
          if (!(await verifyAgent(String(body.agentId ?? ""), String(body.token ?? "")))) {
            return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
          }

          const messages = (body.messages ?? [])
            .filter((m) => m && typeof m.content === "string" && m.content.trim())
            .slice(-24)
            .map((m) => ({
              role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
              content: String(m.content).slice(0, 20_000),
            }));
          if (!messages.length) return Response.json({ error: "对话内容为空" }, { status: 400 });

          const { readAiSettings, resolveModel } = await import("@/lib/ai-settings.server");
          const { CASE_SYSTEM_PROMPT, parseCaseReply, stripJsonBlock } = await import(
            "@/lib/ai-case.server"
          );
          const { streamText } = await import("ai");

          const settings = await readAiSettings();
          const resolved = await resolveModel(settings, request, body.model);
          // 推理模型的一次调用可能持续数分钟，必须流式请求，读完再整体返回给客户端
          const result = streamText({
            model: resolved.model,
            system: CASE_SYSTEM_PROMPT,
            messages,
            ...(resolved.providerOptions ? { providerOptions: resolved.providerOptions } : {}),
            abortSignal: request.signal,
          });
          const text = await result.text;
          const draft = parseCaseReply(text);
          return Response.json({
            label: resolved.label,
            reply: stripJsonBlock(text) || text,
            draft,
            ...(resolved.fallbackReason ? { fallbackReason: resolved.fallbackReason } : {}),
          });
        } catch (error) {
          if ((error as Error).name === "AbortError") return new Response(null, { status: 499 });
          return Response.json(
            { error: (error as Error).message || "平台模型调用失败" },
            { status: 500 },
          );
        }
      },
    },
  },
});
