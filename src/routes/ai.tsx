import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, Save, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeStep, generatePlaywrightCode, type CaseStep } from "@/lib/keywords";
import { createCase } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ai")({
  head: () => ({
    meta: [
      { title: "AI 助手 | PlayFlow" },
      {
        name: "description",
        content: "用对话生成 Playwright 用例、分析执行数据与失败原因，并借助真实节点定位页面元素。",
      },
      { property: "og:title", content: "AI 助手 | PlayFlow" },
      { property: "og:description", content: "对话生成用例、AI 分析测试数据、AI 辅助元素定位。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search["q"] === "string" ? (search["q"] as string) : undefined,
  }),
  component: AiAssistantPage,
});

interface CaseDraft {
  name: string;
  module: string;
  startUrl: string;
  note: string;
  steps: CaseStep[];
  rejected: string[];
}

const QUICK = [
  "帮我生成一条用例：打开 https://example.com，断言标题包含 Example，最后截图",
  "最近失败最多的用例是哪些？分析常见失败原因并给出改进建议",
  "统计各用例的执行次数、通过率和平均耗时，指出不稳定用例",
  "帮我在在线节点上打开 https://example.com，找到主标题最稳定的定位方式",
];

function AiAssistantPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<CaseDraft | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  // 从最后一次工具输出里取出生成的用例，作为右侧预览草稿
  const generated = useMemo(() => {
    let latest: CaseDraft | null = null;
    for (const m of messages) {
      for (const p of m.parts as any[]) {
        if (p?.type === "tool-generate_case_steps" && p.state === "output-available" && p.output) {
          const o = p.output as any;
          latest = {
            name: o.name ?? "AI 生成用例",
            module: o.module ?? "AI 生成",
            startUrl: o.startUrl ?? "",
            note: o.note ?? "",
            steps: (o.steps ?? []) as CaseStep[],
            rejected: (o.rejected ?? []) as string[],
          };
        }
      }
    }
    return latest;
  }, [messages]);

  useEffect(() => {
    if (generated) setDraft(generated);
  }, [generated]);

  useEffect(() => {
    if (q) {
      void sendMessage({ text: q });
      void navigate({ to: "/ai", search: () => ({ q: undefined }), replace: true });
    }
    // 只在首次带参进入时自动提问
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const busy = status === "submitted" || status === "streaming";
  const script = draft ? generatePlaywrightCode(draft.name, draft.steps) : "";

  const send = () => {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    void sendMessage({ text: value });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const created = await createCase({
        name: draft.name,
        module: draft.module || "AI 生成",
        priority: "P1",
        status: "草稿",
        source: "平台编写",
        startUrl: draft.startUrl,
        steps: draft.steps,
      });
      toast.success("已保存为用例，可继续在编排页调整");
      void navigate({ to: "/cases/$caseId", params: { caseId: created.id } });
    } catch (err) {
      toast.error(`保存失败：${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PlatformShell>
      <PageHeader
        title="AI 助手"
        desc="用对话生成用例、分析执行数据、辅助定位页面元素；生成的用例确认后才会保存"
        action={
          <Button
            variant="outline"
            onClick={() => {
              setMessages([]);
              setDraft(null);
            }}
          >
            <Trash2 className="mr-1 size-4" />
            清空会话
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_26rem]">
        <Panel title="对话">
          <div className="flex h-[36rem] flex-col">
            <Conversation className="flex-1">
              <ConversationContent>
                {messages.length === 0 ? (
                  <ConversationEmptyState
                    icon={<Bot className="text-primary size-8" />}
                    title="告诉我你想测什么"
                    description="可以描述业务流程生成用例，也可以让我分析执行数据或定位页面元素"
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
                              <div key={i} className="space-y-2">
                                <Tool defaultOpen={false}>
                                  <ToolHeader type={part.type} state={part.state} />
                                  <ToolContent>
                                    <ToolInput input={part.input} />
                                    <ToolOutput output={part.output} errorText={part.errorText} />
                                  </ToolContent>
                                </Tool>
                                {part.output?.screenshotUrl ? (
                                  <figure className="space-y-1">
                                    <img
                                      src={part.output.screenshotUrl}
                                      alt={`页面截图：${part.output.url ?? ""}`}
                                      loading="lazy"
                                      className="max-h-64 w-full rounded-lg border object-cover object-top"
                                    />
                                    <figcaption className="text-muted-foreground text-xs">
                                      {part.output.cached
                                        ? `来自缓存，抓取于 ${part.output.ageMinutes ?? 0} 分钟前`
                                        : "本次实时抓取"}
                                      {part.output.url ? ` · ${part.output.url}` : ""}
                                    </figcaption>
                                  </figure>
                                ) : null}
                              </div>
                            );

                          return null;
                        })}
                      </MessageContent>
                    </Message>
                  ))
                )}
                {busy && <Shimmer>正在思考…</Shimmer>}
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
                placeholder="例如：登录后进入订单列表，断言列表标题包含订单，重复 3 次搜索"
              />
              <PromptInputFooter className="justify-end">
                <PromptInputSubmit status={status} disabled={!text.trim() && !busy} />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </Panel>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Panel title="用例预览（确认后保存）">
            {!draft ? (
              <p className="text-muted-foreground text-xs">
                让我生成用例后，这里会显示步骤和实时脚本，确认无误再保存。
              </p>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>用例名称</Label>
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>模块</Label>
                    <Input
                      value={draft.module}
                      onChange={(e) => setDraft({ ...draft, module: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>起始地址</Label>
                    <Input
                      value={draft.startUrl}
                      onChange={(e) => setDraft({ ...draft, startUrl: e.target.value })}
                    />
                  </div>
                </div>

                {draft.note && <p className="text-muted-foreground text-xs">{draft.note}</p>}
                {draft.rejected.length > 0 && (
                  <p className="text-warning text-xs">
                    已忽略无法识别的关键字：{draft.rejected.join("、")}
                  </p>
                )}

                <div className="space-y-1">
                  {draft.steps.map((s, i) => (
                    <div
                      key={s.id ?? i}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                      )}
                    >
                      <span className="truncate">
                        <span className="text-muted-foreground mr-2">{i + 1}</span>
                        {describeStep(s)}
                      </span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  {draft.steps.length === 0 && (
                    <p className="text-muted-foreground text-xs">步骤已全部删除</p>
                  )}
                </div>

                <Button className="w-full" disabled={saving || !draft.steps.length} onClick={save}>
                  <Save className="mr-1 size-4" />
                  保存为用例
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    void sendMessage({ text: "在刚才的用例基础上补一步失败截图，并再检查一次断言" })
                  }
                >
                  <Wand2 className="mr-1 size-4" />
                  让 AI 继续完善
                </Button>
              </div>
            )}
          </Panel>

          {draft && (
            <Panel title="生成的 Playwright 脚本">
              <pre className="bg-muted max-h-80 overflow-auto rounded-lg p-3 text-[11px] leading-relaxed">
                <code>{script}</code>
              </pre>
            </Panel>
          )}
        </div>
      </div>
    </PlatformShell>
  );
}
