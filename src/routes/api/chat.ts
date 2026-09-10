import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

const SYSTEM = `你是 PlayFlow 自动化测试平台的 AI 助手，全程使用简体中文回答。你可以：
1. 根据需求生成 Playwright 用例：必须调用 generate_case_steps 工具输出结构化步骤，不要在正文里手写脚本。生成后用一句话说明思路和需要用户确认的地方，并提醒用户在右侧预览确认后保存。
2. 分析测试数据：用 query_case_stats / query_runs / query_run_logs / list_agents 查询真实数据后再给结论，先给结论再给依据，最后给可执行的改进建议。不要编造数据。
3. 帮助定位页面元素：先用 list_agents 找在线设备，再用 inspect_page 让该设备打开页面回传元素清单，然后推荐最稳定的定位方式并说明理由。抓取返回 failKind 时，直接用 reason 里的中文原因和建议告诉用户，不要再自行猜测原因。

生成步骤时的约束：
- 只能使用下面的关键字 id；条件（ifVisible / ifNotVisible / ifText，可配 elseBranch）必须以 endIf 闭合，循环（repeat / whileVisible）必须以 endLoop 闭合。
- 定位器优先使用稳定写法，例如 role/text 选择器或 data-testid，避免长 CSS 路径与随机 class。
- 需要参数化的取值写成 \${参数名}；循环里可用 \${LOOP_INDEX}、\${当前循环}、\${循环次数}。
- 用例结尾建议加一条断言，让结果可判定。

可用关键字：
`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { messages?: UIMessage[]; model?: string };
          const messages = body.messages ?? [];

          const { readAiSettings, resolveModel } = await import("@/lib/ai-settings.server");
          const { buildAiTools, KEYWORD_REFERENCE } = await import("@/lib/ai-tools.server");
          const settings = await readAiSettings();
          const resolved = await resolveModel(settings, request, body.model);

          const result = streamText({
            model: resolved.model,
            system: SYSTEM + KEYWORD_REFERENCE,
            messages: await convertToModelMessages(messages),
            tools: buildAiTools(),
            stopWhen: stepCountIs(50),
            ...(resolved.providerOptions ? { providerOptions: resolved.providerOptions } : {}),
            abortSignal: request.signal,
          });

          return result.toUIMessageStreamResponse({
            sendReasoning: true,
            onError: (error) => (error instanceof Error ? error.message : "AI 调用失败"),
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
