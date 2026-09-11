import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

const SYSTEM = `你是 PlayFlow 自动化测试平台的「AI 报告分析」助手，全程使用简体中文回答，只做测试数据分析。

工作方式：
- 必须先用 query_case_stats / query_runs / query_run_logs / list_agents / query_step_failures / query_slow_steps / query_similar_cases 查询真实数据，再给结论，不要编造任何数据。
- 回答顺序：结论 → 数据依据 → 改进建议 → 优化方案。
- 分析失败时按失败步骤/关键字、定位器、归一化错误原因分类，并指出涉及的用例名称、用例 id、任务 id 或运行 id。
- 分析性能时列出总耗时、平均耗时和最大耗时最高的步骤节点，区分导航、等待、定位与交互瓶颈。
- 分析重复用例时以步骤高度相似为准，给出相似度、共同步骤，并建议合并、参数化或保留差异。
- 只做分析和建议：生成用例、修改用例、页面元素定位都在客户端 AI 助手里完成，用户问到时告知在客户端操作。`;


/** 把底层报错转成可执行的中文提示 */
function explainAiError(error: unknown, label: string) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const hint = "（可在「系统配置 → AI 设置」检查模型接入）";
  if (/ENOTFOUND|EAI_AGAIN/i.test(raw)) return `模型接口地址无法解析，请检查 Base URL${hint}`;
  if (/ECONNREFUSED/i.test(raw)) return `模型接口拒绝连接，请检查 Base URL 与端口${hint}`;
  if (/401|403|invalid api key|unauthorized/i.test(raw)) return `模型接口拒绝了 API Key${hint}`;
  if (/429|rate limit/i.test(raw)) return "模型接口达到调用频率上限，请稍后重试";
  if (/without a finish reason/i.test(raw))
    return `模型（${label}）中途断开连接，未返回完整结果。多为自填接口不支持流式或工具调用${hint}`;
  return `${raw || "AI 调用失败"}${hint}`;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { messages?: UIMessage[]; model?: string };
          const messages = body.messages ?? [];

          const { readAiSettings, resolveModel } = await import("@/lib/ai-settings.server");
          const { buildAnalysisTools } = await import("@/lib/ai-tools.server");
          const settings = await readAiSettings();
          const resolved = await resolveModel(settings, request, body.model);

          const result = streamText({
            model: resolved.model,
            system: SYSTEM,
            messages: await convertToModelMessages(messages),
            tools: buildAnalysisTools(),

            stopWhen: stepCountIs(50),
            ...(resolved.providerOptions ? { providerOptions: resolved.providerOptions } : {}),
            abortSignal: request.signal,
          });

          return result.toUIMessageStreamResponse({
            sendReasoning: true,
            onError: (error) => explainAiError(error, resolved.label),
          });
        } catch (error) {
          if ((error as Error).name === "AbortError") return new Response(null, { status: 499 });
          const message = (error as Error).message || "AI 调用失败";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
