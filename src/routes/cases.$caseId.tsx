import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download, Play, Save } from "lucide-react";
import { toast } from "sonner";
import { PlatformShell } from "@/components/platform-shell";
import { KeywordPalette, StepBlocks, newStep } from "@/components/block-editor";
import { StepFlow } from "@/components/step-flow";
import { CaseVersions } from "@/components/case-versions";
import { CaseParamsEditor, extractParamNames } from "@/components/case-params";
import { ParamPreview } from "@/components/param-preview";

import { PageHeader, Panel } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generatePlaywrightCode, type CaseStep } from "@/lib/keywords";
import { getState, refresh, upsertCase, useAppStore, type TestCase } from "@/lib/store";

export const Route = createFileRoute("/cases/$caseId")({
  head: () => ({
    meta: [
      { title: "用例编排 | PlayFlow" },
      {
        name: "description",
        content: "以关键字积木的方式编排 Playwright 用例步骤，实时生成可执行脚本。",
      },
      { property: "og:title", content: "用例编排 | PlayFlow" },
      { property: "og:description", content: "关键字积木式编排，零代码生成 Playwright 脚本。" },
    ],
  }),
  component: CaseEditor,
});

function CaseEditor() {
  const { caseId } = Route.useParams();
  const { cases, loaded } = useAppStore();
  const navigate = useNavigate();
  const found = cases.find((c) => c.id === caseId);
  const [draft, setDraft] = useState<TestCase | null>(found ?? null);

  // 数据是异步从数据库加载的：用例出现后同步一次草稿，避免误报“未找到用例”
  useEffect(() => {
    setDraft((d) => (d && d.id === caseId ? d : (found ?? null)));
  }, [found, caseId]);

  if (!draft) {
    return (
      <PlatformShell>
        <div className="text-muted-foreground py-20 text-center text-sm">
          {loaded ? (
            <>
              未找到用例 {caseId}
              <div className="mt-4">
                <Button variant="outline" asChild>
                  <Link to="/cases">返回用例列表</Link>
                </Button>
              </div>
            </>
          ) : (
            "正在加载用例…"
          )}
        </div>
      </PlatformShell>
    );
  }


  const setSteps = (steps: CaseStep[]) => setDraft({ ...draft, steps });
  const usedParams = extractParamNames([
    draft.startUrl ?? "",
    ...draft.steps.flatMap((s) => [s.target ?? "", s.value ?? ""]),
  ]);
  const code = generatePlaywrightCode(draft.name, draft.steps);

  return (
    <PlatformShell>
      <PageHeader
        title="用例编排"
        desc={`${draft.id} · 关键字积木式编写，保存后可加入执行任务`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/cases">
                <ArrowLeft className="mr-1 size-4" />
                返回列表
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast.info("已通知桌面端 Agent 进行本地调试，可在 Agent 客户端查看执行过程")
              }
            >
              <Play className="mr-1 size-4" />
              本地调试
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const blob = new Blob([code], { type: "text/javascript;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${draft.name || "case"}.spec.js`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("已导出 Playwright 脚本");
              }}
            >
              <Download className="mr-1 size-4" />
              导出脚本
            </Button>
            <Button
              onClick={() => {
                upsertCase({ ...draft, updatedAt: new Date().toISOString().slice(5, 16).replace("T", " ") });
                toast.success("用例已保存");
                navigate({ to: "/cases" });
              }}
            >
              <Save className="mr-1 size-4" />
              保存用例
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[16rem_1fr_22rem]">
        <Panel title="关键字积木">
          <KeywordPalette onPick={(id) => setSteps([...draft.steps, newStep(id)])} />
          <p className="text-muted-foreground mt-4 text-xs">
            点击积木即追加步骤，支持上下移动排序；每个积木对应一条 Playwright 指令。
          </p>
        </Panel>

        <div className="space-y-4">
          <Panel title="基础信息">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>用例名称</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>所属模块</Label>
                <Input
                  value={draft.module}
                  onChange={(e) => setDraft({ ...draft, module: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>优先级</Label>
                <Select
                  value={draft.priority}
                  onValueChange={(v) => setDraft({ ...draft, priority: v as TestCase["priority"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["P0", "P1", "P2"].map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>状态</Label>
                <Select
                  value={draft.status}
                  onValueChange={(v) => setDraft({ ...draft, status: v as TestCase["status"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["就绪", "草稿", "维护中"].map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Panel>

          <Panel title="参数化（模板变量）">
            <CaseParamsEditor
              params={draft.params ?? []}
              isTemplate={draft.isTemplate ?? false}
              usedNames={usedParams}
              onChange={(params) => setDraft({ ...draft, params })}
              onTemplateChange={(isTemplate) => setDraft({ ...draft, isTemplate })}
            />
          </Panel>

          <Panel title="参数绑定实时预览">
            <ParamPreview
              caseName={draft.name}
              startUrl={draft.startUrl ?? ""}
              steps={draft.steps}
              params={draft.params ?? []}
              usedNames={usedParams}
            />
          </Panel>


          <Panel title={`步骤编排（${draft.steps.length} 步）`}>
            <StepBlocks steps={draft.steps} onChange={setSteps} />
          </Panel>

          <Panel title="版本历史">
            <CaseVersions
              caseId={draft.id}
              onRolledBack={async () => {
                await refresh();
                const next = getState().cases.find((c) => c.id === draft.id);
                if (next) setDraft(next);
              }}
            />
          </Panel>

          <Panel title="执行流程图与步骤日志">
            <StepFlow caseId={draft.id} steps={draft.steps} />
          </Panel>
        </div>

        <Panel title="生成的 Playwright 脚本">
          <pre className="bg-muted text-foreground max-h-[32rem] overflow-auto rounded-lg p-3 text-[11px] leading-relaxed">
            <code>{code}</code>
          </pre>
          <Button
            variant="outline"
            className="mt-3 w-full"
            onClick={() => {
              void navigator.clipboard?.writeText(code);
              toast.success("脚本已复制");
            }}
          >
            复制脚本
          </Button>
        </Panel>
      </div>
    </PlatformShell>
  );
}
