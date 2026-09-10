import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Blocks, Copy, ListChecks, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader, StatusChip } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCase, createTask, deleteCase, newCaseFromTemplate, useAppStore } from "@/lib/store";

export const Route = createFileRoute("/cases/")({
  head: () => ({
    meta: [
      { title: "用例管理 | PlayFlow" },
      {
        name: "description",
        content: "按模块、优先级与状态管理 Playwright 自动化用例，支持关键字积木式编排与 Agent 录制上传。",
      },
      { property: "og:title", content: "用例管理 | PlayFlow" },
      { property: "og:description", content: "关键字积木式用例编写与用例资产管理。" },
    ],
  }),
  component: CasesPage,
});

function CasesPage() {
  const { cases, agents, settings } = useAppStore();
  const navigate = useNavigate();
  const [kw, setKw] = useState("");
  const [module, setModule] = useState("全部模块");
  const [status, setStatus] = useState("全部状态");
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const modules = useMemo(
    () => ["全部模块", ...Array.from(new Set(cases.map((c) => c.module)))],
    [cases],
  );

  const list = cases.filter(
    (c) =>
      (module === "全部模块" || c.module === module) &&
      (status === "全部状态" || c.status === status) &&
      (kw === "" || c.name.includes(kw) || c.id.toLowerCase().includes(kw.toLowerCase())),
  );

  // 筛选或数据变化后，剔除已不在当前筛选结果里的勾选
  useEffect(() => {
    const visible = new Set(list.map((c) => c.id));
    setPicked((p) => (p.every((id) => visible.has(id)) ? p : p.filter((id) => visible.has(id))));
  }, [list]);

  const listIds = useMemo(() => list.map((c) => c.id), [list]);
  const allChecked = listIds.length > 0 && listIds.every((id) => picked.includes(id));
  const someChecked = !allChecked && listIds.some((id) => picked.includes(id));

  const toggleAll = () => {
    setPicked(allChecked ? [] : listIds);
  };

  const quickCreateTask = async () => {
    if (picked.length === 0 || creating) return;
    const target = agents.find((a) => a.status !== "离线") ?? agents[0];
    if (!target) {
      toast.error("还没有已注册的执行节点，请先安装并启动桌面客户端");
      return;
    }
    setCreating(true);
    try {
      const scope = module !== "全部模块" ? module : "筛选";
      const task = await createTask({
        name: `批量任务（${scope}）${new Date().toLocaleDateString("zh-CN")}`,
        caseIds: picked,
        agentId: target.id,
        env: "测试环境",
        browser: "Chromium",
        concurrency: settings.defaultConcurrency,
        retry: settings.defaultRetry,
      });
      toast.success(`已用 ${picked.length} 个用例创建任务，可在详情页确认后下发`);
      setPicked([]);
      navigate({ to: "/tasks/$taskId", params: { taskId: task.id } });
    } finally {
      setCreating(false);
    }
  };

  return (
    <PlatformShell>
      <PageHeader
        title="用例管理"
        desc={`共 ${cases.length} 个用例，其中 ${cases.filter((c) => c.source === "Agent 录制").length} 个由桌面端录制上传`}
        action={
          <Button
            onClick={async () => {
              const c = await createCase({ name: "新建用例", module: "未分类" });
              toast.success("已创建用例，开始积木式编排");
              navigate({ to: "/cases/$caseId", params: { caseId: c.id } });
            }}
          >
            <Plus className="mr-1 size-4" />
            新建用例
          </Button>
        }
      />

      <div className="md-elevation-1 bg-card mb-4 flex flex-wrap items-center gap-3 rounded-xl border p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜索用例名称或编号"
            className="pl-9"
          />
        </div>
        <Select value={module} onValueChange={setModule}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modules.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["全部状态", "就绪", "草稿", "维护中"].map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {picked.length > 0 && (
        <div className="bg-primary-soft/60 border-primary/20 mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-sm">
          <span className="font-medium">已选 {picked.length} 个用例</span>
          <Button size="sm" disabled={creating} onClick={quickCreateTask}>
            <ListChecks className="mr-1 size-4" />
            {creating ? "创建中…" : "创建任务"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
            <X className="mr-1 size-4" />
            清空
          </Button>
          <span className="text-muted-foreground text-xs">
            创建后跳到任务详情页，确认节点与参数后再下发
          </span>
        </div>
      )}

      <div className="md-elevation-1 bg-card overflow-hidden rounded-xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-medium">
                <th className="w-10">
                  <Checkbox
                    aria-label="全选当前筛选结果"
                    checked={allChecked ? true : someChecked ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th>编号</th>
                <th>用例名称</th>
                <th>模块</th>
                <th>优先级</th>
                <th>步骤</th>
                <th>来源</th>
                <th>负责人</th>
                <th>状态</th>
                <th>更新时间</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((c) => (
                <tr key={c.id} className="hover:bg-accent/50 [&>td]:px-4 [&>td]:py-2.5">
                  <td className="text-muted-foreground font-mono text-xs">{c.id}</td>
                  <td>
                    <Link
                      to="/cases/$caseId"
                      params={{ caseId: c.id }}
                      className="hover:text-primary font-medium"
                    >
                      {c.name}
                    </Link>
                    <div className="mt-1 flex gap-1">
                      {c.isTemplate ? (
                        <span className="bg-primary-soft text-primary rounded px-1.5 py-0.5 text-[11px]">
                          模板 · {(c.params ?? []).length} 个参数
                        </span>
                      ) : null}
                      {c.tags.map((t) => (
                        <span key={t} className="bg-secondary rounded px-1.5 py-0.5 text-[11px]">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{c.module}</td>
                  <td>
                    <span
                      className={
                        c.priority === "P0"
                          ? "text-destructive font-medium"
                          : c.priority === "P1"
                            ? "text-warning font-medium"
                            : "text-muted-foreground"
                      }
                    >
                      {c.priority}
                    </span>
                  </td>
                  <td className="tabular-nums">{c.steps.length}</td>
                  <td className="text-muted-foreground text-xs">{c.source}</td>
                  <td className="text-xs">{c.author}</td>
                  <td>
                    <StatusChip status={c.status} />
                  </td>
                  <td className="text-muted-foreground text-xs">{c.updatedAt}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" asChild>
                        <Link to="/cases/$caseId" params={{ caseId: c.id }}>
                          <Blocks className="mr-1 size-3.5" />
                          编排
                        </Link>
                      </Button>
                      {c.isTemplate ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const name = window.prompt("新用例名称", `${c.name} 副本`);
                            if (!name) return;
                            const id = await newCaseFromTemplate(c.id, name, c.params ?? []);
                            toast.success("已按模板创建用例，可直接调整参数取值");
                            navigate({ to: "/cases/$caseId", params: { caseId: id } });
                          }}
                        >
                          <Copy className="mr-1 size-3.5" />
                          用模板创建
                        </Button>
                      ) : null}
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="删除用例"
                        onClick={() => {
                          deleteCase(c.id);
                          toast.info(`已删除 ${c.id}`);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-muted-foreground px-4 py-10 text-center text-sm">
                    没有符合条件的用例
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PlatformShell>
  );
}
