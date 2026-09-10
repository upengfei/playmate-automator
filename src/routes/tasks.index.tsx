import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Rocket, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader, Panel, ProgressBar, StatusChip } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTask, dispatchTask, useAppStore, versionOutdated, type Task } from "@/lib/store";

export const Route = createFileRoute("/tasks/")({
  head: () => ({
    meta: [
      { title: "任务编排与下发 | PlayFlow" },
      {
        name: "description",
        content: "选择用例集合、执行节点、环境与浏览器，编排自动化任务并一键下发到桌面 Agent 执行。",
      },
      { property: "og:title", content: "任务编排与下发 | PlayFlow" },
      { property: "og:description", content: "任务编排、节点选择与一键下发执行。" },
    ],
  }),
  component: TasksPage,
});

function TasksPage() {
  const { cases, agents, tasks, settings } = useAppStore();
  const navigate = useNavigate();
  const onlineAgents = agents.filter((a) => a.status !== "离线");

  const [name, setName] = useState("回归任务（新建）");
  const [picked, setPicked] = useState<string[]>([]);
  const [agentId, setAgentId] = useState("");
  const effectiveAgentId = agentId || onlineAgents[0]?.id || agents[0]?.id || "";
  const [env, setEnv] = useState<Task["env"]>("测试环境");
  const [browser, setBrowser] = useState<Task["browser"]>("Chromium");
  const [concurrency, setConcurrency] = useState(String(settings.defaultConcurrency));
  const [retry, setRetry] = useState(String(settings.defaultRetry));
  const [serialDependency, setSerialDependency] = useState(false);
  const [kw, setKw] = useState("");
  const [moduleFilter, setModuleFilter] = useState("全部模块");
  const [statusFilter, setStatusFilter] = useState("全部状态");

  const modules = useMemo(
    () => ["全部模块", ...Array.from(new Set(cases.map((c) => c.module)))],
    [cases],
  );

  const filtered = cases.filter(
    (c) =>
      (moduleFilter === "全部模块" || c.module === moduleFilter) &&
      (statusFilter === "全部状态" || c.status === statusFilter) &&
      (kw === "" || c.name.includes(kw) || c.id.toLowerCase().includes(kw.toLowerCase())),
  );

  const filteredIds = filtered.map((c) => c.id);
  const allFilteredChecked =
    filteredIds.length > 0 && filteredIds.every((id) => picked.includes(id));
  const someFilteredChecked =
    !allFilteredChecked && filteredIds.some((id) => picked.includes(id));

  const toggleAllFiltered = () => {
    setPicked((p) =>
      allFilteredChecked ? p.filter((id) => !filteredIds.includes(id)) : [...new Set([...p, ...filteredIds])],
    );
  };

  const selectedAgent = agents.find((a) => a.id === effectiveAgentId);
  const blocked = !selectedAgent || selectedAgent.status === "离线" || versionOutdated(selectedAgent);

  const submit = async (dispatch: boolean) => {
    if (!effectiveAgentId) {
      toast.error("还没有已注册的执行节点，请先安装并启动桌面客户端");
      return;
    }
    if (picked.length === 0) {
      toast.error("请至少选择一个用例");
      return;
    }
    const task = await createTask({
      name,
      caseIds: picked,
      agentId: effectiveAgentId,
      env,
      browser,
      concurrency: Number(concurrency),
      retry: Number(retry),
      serialDependency,
    });
    if (dispatch) {
      const res = await dispatchTask(task.id);
      if (res.ok) toast.success(`任务已下发到 ${selectedAgent?.name}，节点领取后开始真实执行`);
      else toast.error(res.message ?? "下发失败");
      navigate({ to: "/tasks/$taskId", params: { taskId: task.id } });
    } else {
      toast.success("任务已创建并进入队列");
    }
  };

  return (
    <PlatformShell>
      <PageHeader
        title="任务编排与下发"
        desc="组合用例集合、指定执行节点与运行参数，一键下发给已连接的桌面 Agent"
        action={
          <Button variant="outline" asChild>
            <Link to="/board">任务进度看板</Link>
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <Panel
          title={`选择用例（已选 ${picked.length} 个${serialDependency ? "，按勾选顺序串行" : ""}）`}
          bodyClassName="p-0"
        >
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <div className="relative min-w-44 flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="搜索用例名称或编号"
                className="pl-9"
              />
            </div>
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="w-36">
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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
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
          <label className="bg-muted/40 hover:bg-accent/50 flex cursor-pointer items-center gap-3 border-b px-4 py-2 text-sm">
            <Checkbox
              aria-label="全选当前筛选结果"
              checked={allFilteredChecked ? true : someFilteredChecked ? "indeterminate" : false}
              onCheckedChange={toggleAllFiltered}
            />
            <span className="font-medium">全选当前筛选结果</span>
            <span className="text-muted-foreground text-xs">
              {filtered.length} 个用例
              {someFilteredChecked || allFilteredChecked
                ? `，已选 ${filteredIds.filter((id) => picked.includes(id)).length} 个`
                : ""}
            </span>
          </label>
          <div className="max-h-[28rem] divide-y overflow-y-auto">
            {filtered.map((c) => {
              const on = picked.includes(c.id);
              const order = picked.indexOf(c.id) + 1;
              return (
                <label
                  key={c.id}
                  className="hover:bg-accent/50 flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <Checkbox
                    checked={on}
                    onCheckedChange={() =>
                      setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))
                    }
                  />
                  <span className="text-muted-foreground w-20 shrink-0 font-mono text-xs">
                    {c.id}
                  </span>
                  {serialDependency && on && (
                    <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-xs font-medium">
                      第 {order} 步
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-muted-foreground hidden text-xs sm:block">{c.module}</span>
                  <span className="text-muted-foreground text-xs">{c.steps.length} 步</span>
                  <StatusChip status={c.status} />
                </label>
              );
            })}
          </div>
        </Panel>

        <Panel title="任务参数">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>任务名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>执行节点</Label>
              <Select value={effectiveAgentId} onValueChange={setAgentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.status} · v{a.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {blocked && (
                <p className="text-destructive text-xs">
                  该节点当前不可用（离线或版本低于 v{settings.minAgentVersion}），下发会被拦截。
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>环境</Label>
                <Select value={env} onValueChange={(v) => setEnv(v as Task["env"])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["测试环境", "预发环境", "生产环境"].map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>浏览器</Label>
                <Select value={browser} onValueChange={(v) => setBrowser(v as Task["browser"])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Chromium", "Firefox", "WebKit"].map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>并发数</Label>
                <Input
                  type="number"
                  value={concurrency}
                  disabled={serialDependency}
                  onChange={(e) => setConcurrency(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>失败重试</Label>
                <Input type="number" value={retry} onChange={(e) => setRetry(e.target.value)} />
              </div>
            </div>
            <label className="bg-muted/40 flex cursor-pointer items-start gap-3 rounded-md border p-3">
              <Checkbox
                checked={serialDependency}
                onCheckedChange={(v) => setSerialDependency(Boolean(v))}
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium">用例依赖（串行执行）</span>
                <span className="text-muted-foreground block text-xs">
                  按勾选顺序执行：前置用例通过后才执行下一个，前置失败时后续用例自动跳过。开启后并发固定为
                  1。
                </span>
              </span>
            </label>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={() => submit(true)}>
                <Rocket className="mr-1 size-4" />
                创建并下发
              </Button>
              <Button variant="outline" onClick={() => submit(false)}>
                仅入队
              </Button>
            </div>
          </div>
        </Panel>
      </div>

      <Panel className="mt-4" title="任务列表" bodyClassName="p-0">
        <ul className="divide-y">
          {tasks.map((t) => {
            const done = t.caseRuns.filter(
              (r) => r.status !== "等待中" && r.status !== "运行中",
            ).length;
            const agent = agents.find((a) => a.id === t.agentId);
            return (
              <li key={t.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    to="/tasks/$taskId"
                    params={{ taskId: t.id }}
                    className="hover:text-primary text-sm font-medium"
                  >
                    {t.name}
                  </Link>
                  <StatusChip status={t.status} />
                  <span className="text-muted-foreground text-xs">
                    {t.id} · {t.env} · {t.browser} · {agent?.name} · {t.trigger}
                  </span>
                  <div className="ml-auto flex gap-2">
                    {(t.status === "排队中" || t.status === "失败" || t.status === "已取消") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          dispatchTask(t.id);
                          toast.success(`任务 ${t.id} 已下发`);
                        }}
                      >
                        <Send className="mr-1 size-3.5" />
                        下发执行
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" asChild>
                      <Link to="/tasks/$taskId" params={{ taskId: t.id }}>
                        实时详情
                      </Link>
                    </Button>
                  </div>
                </div>
                <div className="text-muted-foreground mt-1.5 text-xs">{t.stage}</div>
                <ProgressBar
                  className="mt-2"
                  value={(done / Math.max(1, t.caseRuns.length)) * 100}
                  tone={t.status === "失败" ? "danger" : t.status === "已完成" ? "success" : "primary"}
                />
              </li>
            );
          })}
        </ul>
      </Panel>
    </PlatformShell>
  );
}
