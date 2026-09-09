import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertOctagon, ListChecks, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader, Panel, ProgressBar, StatCard, StatusChip } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { fetchCaseStats } from "@/lib/platform.functions";
import { dispatchTask, retryTask, useAppStore, type Task, type TaskStatus } from "@/lib/store";

const COLUMNS: { title: string; statuses: TaskStatus[]; hint: string }[] = [
  { title: "排队中", statuses: ["排队中"], hint: "等待下发到空闲执行节点" },
  { title: "下发 / 执行中", statuses: ["下发中", "运行中"], hint: "Agent 正在执行并实时回传" },
  { title: "已完成", statuses: ["已完成"], hint: "全部用例通过，报告已生成" },
  { title: "失败 / 已取消", statuses: ["失败", "已取消"], hint: "需关注失败原因并重试" },
];

export const Route = createFileRoute("/board")({
  head: () => ({
    meta: [
      { title: "任务进度看板 | PlayFlow" },
      {
        name: "description",
        content: "看板视角查看任务队列状态、执行阶段、用例级进度与失败原因，并直接发起重试。",
      },
      { property: "og:title", content: "任务进度看板 | PlayFlow" },
      { property: "og:description", content: "队列状态、执行阶段、失败原因与重试入口一屏可见。" },
    ],
  }),
  component: BoardPage,
});

function BoardPage() {
  const { tasks, agents } = useAppStore();
  const { data: caseStats } = useQuery({
    queryKey: ["board-case-stats"],
    queryFn: () => fetchCaseStats(),
    refetchInterval: 5000,
  });
  const stats = caseStats?.stats ?? [];
  const failures = tasks.flatMap((t) =>
    t.caseRuns
      .filter((r) => r.status === "失败")
      .map((r) => ({ task: t, run: r })),
  );

  return (
    <PlatformShell>
      <PageHeader title="任务进度看板" desc="按队列阶段跟踪所有执行任务，聚焦失败并快速重试" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => (
          <StatCard
            key={col.title}
            label={col.title}
            value={tasks.filter((t) => col.statuses.includes(t.status)).length}
            unit="个任务"
            hint={col.hint}
            tone={
              col.title === "已完成"
                ? "success"
                : col.title.startsWith("失败")
                  ? "danger"
                  : "primary"
            }
          />
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = tasks.filter((t) => col.statuses.includes(t.status));
          return (
            <div key={col.title} className="bg-muted/40 rounded-xl border p-3">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">{col.title}</h2>
                <span className="text-muted-foreground text-xs tabular-nums">{list.length}</span>
              </div>
              <div className="space-y-3">
                {list.map((t) => (
                  <TaskCard key={t.id} task={t} agentName={agents.find((a) => a.id === t.agentId)?.name} />
                ))}
                {list.length === 0 && (
                  <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-xs">
                    暂无任务
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Panel
        className="mt-4"
        title={
          <span className="flex items-center gap-2">
            <AlertOctagon className="text-destructive size-4" />
            失败聚合（{failures.length}）
          </span>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-medium">
                <th>任务</th>
                <th>用例</th>
                <th>失败步骤</th>
                <th>失败原因</th>
                <th>尝试</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {failures.map(({ task, run }) => (
                <tr key={`${task.id}-${run.caseId}`} className="[&>td]:px-4 [&>td]:py-2.5">
                  <td>
                    <Link
                      to="/tasks/$taskId"
                      params={{ taskId: task.id }}
                      className="hover:text-primary"
                    >
                      {task.name}
                    </Link>
                  </td>
                  <td className="text-xs">
                    <span className="text-muted-foreground font-mono">{run.caseId}</span>{" "}
                    {run.caseName}
                  </td>
                  <td className="text-muted-foreground text-xs">{run.failedStep ?? "-"}</td>
                  <td className="text-destructive max-w-80 text-xs">{run.failReason}</td>
                  <td className="text-xs tabular-nums">第 {run.attempt} 次</td>
                  <td className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        retryTask(task.id, true);
                        toast.info(`已重跑 ${task.name} 的失败用例`);
                      }}
                    >
                      <RotateCcw className="mr-1 size-3.5" />
                      重试
                    </Button>
                  </td>
                </tr>
              ))}
              {failures.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-muted-foreground px-4 py-10 text-center text-sm">
                    当前没有失败用例
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </PlatformShell>
  );
}

function TaskCard({ task, agentName }: { task: Task; agentName?: string | undefined }) {
  const done = task.caseRuns.filter((r) => r.status !== "等待中" && r.status !== "运行中").length;
  const failed = task.caseRuns.filter((r) => r.status === "失败").length;
  const current = task.caseRuns.find((r) => r.status === "运行中");
  return (
    <div className="md-elevation-1 bg-card rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <Link
          to="/tasks/$taskId"
          params={{ taskId: task.id }}
          className="hover:text-primary text-sm font-medium"
        >
          {task.name}
        </Link>
        <StatusChip status={task.status} />
      </div>
      <p className="text-muted-foreground mt-1.5 text-xs">{task.stage}</p>
      <p className="text-muted-foreground mt-1 text-xs">
        {task.env} · {task.browser} · {agentName ?? task.agentId}
      </p>
      {current && (
        <p className="text-primary mt-1.5 text-xs">
          正在执行：{current.caseName}（步骤 {current.stepIndex}/{current.stepTotal}）
        </p>
      )}
      <ProgressBar
        className="mt-2"
        value={(done / Math.max(1, task.caseRuns.length)) * 100}
        tone={failed ? "danger" : task.status === "已完成" ? "success" : "primary"}
      />
      <div className="text-muted-foreground mt-2 flex items-center justify-between text-xs">
        <span>
          {done}/{task.caseRuns.length} 已完成 · 失败 {failed}
        </span>
        {task.status === "排队中" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              dispatchTask(task.id);
              toast.success(`任务 ${task.id} 已下发`);
            }}
          >
            <Send className="mr-1 size-3.5" />
            下发
          </Button>
        )}
        {failed > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              retryTask(task.id, true);
              toast.info("已发起失败重跑");
            }}
          >
            <RotateCcw className="mr-1 size-3.5" />
            重试
          </Button>
        )}
      </div>
    </div>
  );
}
