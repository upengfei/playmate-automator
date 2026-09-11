import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { BarChart3, Trash2 } from "lucide-react";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader, Panel } from "@/components/ui-bits";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/ai")({
  head: () => ({
    meta: [
      { title: "AI 报告分析 | PlayFlow" },
      {
        name: "description",
        content: "用对话分析真实执行记录：失败最多的用例、通过率趋势、失败原因归类与改进建议。",
      },
      { property: "og:title", content: "AI 报告分析 | PlayFlow" },
      { property: "og:description", content: "基于真实执行数据的 AI 测试报告分析与改进建议。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search["q"] === "string" ? (search["q"] as string) : undefined,
  }),
  component: AiReportPage,
});

const QUICK = [
  "最近失败最多的用例是哪些？归类常见失败原因并给出改进建议",
  "统计各用例的执行次数、通过率和平均耗时，指出不稳定用例",
  "分析最近一次失败执行的日志，判断是定位失效还是等待不足",
  "各执行节点的在线情况和执行量是否均衡？有没有节点异常",
];

function AiReportPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const [text, setText] = useState("");

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  useEffect(() => {
    if (q) {
      void sendMessage({ text: q });
      void navigate({ to: "/ai", search: () => ({ q: undefined }), replace: true });
    }
    // 只在首次带参进入时自动提问
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const busy = status === "submitted" || status === "streaming";

  const send = () => {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    void sendMessage({ text: value });
  };

  return (
    <PlatformShell>
      <PageHeader
        title="AI 报告分析"
        desc="基于真实执行记录、任务与日志做数据分析；生成和修改用例请在客户端的 AI 助手里完成"
        action={
          <Button variant="outline" onClick={() => setMessages([])}>
            <Trash2 className="mr-1 size-4" />
            清空会话
          </Button>
        }
      />

      <Panel title="分析对话">
        <div className="flex h-[38rem] flex-col">
          <Conversation className="flex-1">
            <ConversationContent>
              {messages.length === 0 ? (
                <ConversationEmptyState
                  icon={<BarChart3 className="text-primary size-8" />}
                  title="想分析哪部分测试数据？"
                  description="我会先查询真实执行记录与日志，再给出结论、原因归类和改进建议"
                >
                  <div className="mt-4 grid gap-2">
                    {QUICK.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void sendMessage({ text: s })}
                        className="hover:bg-accent rounded-lg border px-3 py-2 text-left text-xs"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </ConversationEmptyState>
              ) : (
                messages.map((m) => (
                  <Message key={m.id} from={m.role}>
                    <MessageContent>
                      {(m.parts as any[]).map((part, i) => {
                        if (part.type === "text")
                          return <MessageResponse key={i}>{part.text}</MessageResponse>;
                        if (part.type === "reasoning" && part.text)
                          return (
                            <p key={i} className="text-muted-foreground text-xs italic">
                              {part.text}
                            </p>
                          );
                        if (typeof part.type === "string" && part.type.startsWith("tool-"))
                          return (
                            <Tool key={i} defaultOpen={false}>
                              <ToolHeader type={part.type} state={part.state} />
                              <ToolContent>
                                <ToolInput input={part.input} />
                                <ToolOutput output={part.output} errorText={part.errorText} />
                              </ToolContent>
                            </Tool>
                          );
                        return null;
                      })}
                    </MessageContent>
                  </Message>
                ))
              )}
              {busy && <Shimmer>正在分析…</Shimmer>}
              {error && (
                <p className="text-destructive text-xs">
                  AI 调用失败：{error.message}（可在「系统配置 → AI 设置」检查模型接入）
                </p>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <PromptInput
            className="mt-3"
            onSubmit={(_msg, e) => {
              e.preventDefault();
              send();
            }}
          >
            <PromptInputTextarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="例如：这周失败率最高的模块是哪个？失败原因主要是什么"
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={!text.trim() && !busy} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </Panel>
    </PlatformShell>
  );
}
