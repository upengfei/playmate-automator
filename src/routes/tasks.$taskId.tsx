import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw, RotateCcw, Send, Square } from "lucide-react";
import { toast } from "sonner";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader, Panel, ProgressBar, StatCard, StatusChip } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  cancelTask,
  dispatchTask,
  msToText,
  retryTask,
  useAppStore,
  type CaseRun,
  type LogEntry,
} from "@/lib/store";

export const Route = createFileRoute("/tasks/$taskId")({
  head: () => ({
    meta: [
      { title: "任务实时进度 | PlayFlow" },
      {
        name: "description",
        content: "查看任务执行阶段、每个用例的实时进度、运行日志流、失败原因并一键重试。",
      },
      { property: "og:title", content: "任务实时进度 | PlayFlow" },
      { property: "og:description", content: "步骤级实时进度与日志流，失败原因与重试入口。" },
    ],
  }),
  component: TaskDetail,
});

function TaskDetail() {
  const { taskId } = Route.useParams();
  const { tasks, agents, loaded } = useAppStore();
  const task = tasks.find((t) => t.id === taskId);
  const [selected, setSelected] = useState<string | null>(null);

  if (!task) {
    return (
      <PlatformShell>
        <div className="text-muted-foreground py-20 text-center text-sm">
          {loaded ? (
            <>
              未找到任务 {taskId}
              <div className="mt-4">
                <Button variant="outline" asChild>
                  <Link to="/tasks">返回任务列表</Link>
                </Button>
              </div>
            </>
          ) : (
            "正在加载任务…"
          )}
        </div>
      </PlatformShell>
    );
  }


  const agent = agents.find((a) => a.id === task.agentId);
  const done = task.caseRuns.filter((r) => r.status !== "等待中" && r.status !== "运行中").length;
  const passed = task.caseRuns.filter((r) => r.status === "通过").length;
  const failed = task.caseRuns.filter((r) => r.status === "失败").length;
  const active = task.caseRuns.find((r) => r.caseId === selected) ?? task.caseRuns[0];
  const running = task.status === "运行中" || task.status === "下发中";

  return (
    <PlatformShell>
      <PageHeader
        title={task.name}
        desc={`${task.id} · ${task.env} · ${task.browser} · 执行节点 ${agent?.name ?? task.agentId} · ${task.trigger}触发`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/tasks">
                <ArrowLeft className="mr-1 size-4" />
                返回
              </Link>
            </Button>
            {running ? (
              <Button variant="outline" onClick={() => cancelTask(task.id)}>
                <Square className="mr-1 size-4" />
                停止执行
              </Button>
            ) : (
              <Button
                onClick={() => {
                  dispatchTask(task.id);
                  toast.success("任务已重新下发");
                }}
              >
                <Send className="mr-1 size-4" />
                重新下发
              </Button>
            )}
            {failed > 0 && !running && (
              <Button
                variant="outline"
                onClick={() => {
                  retryTask(task.id, true);
                  toast.info(`已重跑 ${failed} 个失败用例`);
                }}
              >
                <RotateCcw className="mr-1 size-4" />
                重跑失败用例（{failed}）
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="任务状态" value={task.status} hint={task.stage} tone="primary" />
        <StatCard
          label="执行进度"
          value={`${done}/${task.caseRuns.length}`}
          hint={running ? "实时上报中" : "已停止上报"}
        />
        <StatCard label="通过" value={passed} unit="个" tone="success" />
        <StatCard
          label="失败"
          value={failed}
          unit="个"
          tone={failed ? "danger" : "success"}
          hint={failed ? "可在下方查看失败原因并重试" : "暂无失败"}
        />
      </div>

      <div className="mt-4">
        <ProgressBar
          value={(done / Math.max(1, task.caseRuns.length)) * 100}
          tone={failed ? "danger" : task.status === "已完成" ? "success" : "primary"}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="用例执行状态" bodyClassName="p-0">
          <ul className="divide-y">
            {task.caseRuns.map((r) => (
              <li
                key={r.caseId}
                className={cn(
                  "cursor-pointer px-4 py-3",
                  active?.caseId === r.caseId ? "bg-accent/60" : "hover:bg-accent/40",
                )}
                onClick={() => setSelected(r.caseId)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground w-20 shrink-0 font-mono text-xs">
                    {r.caseId}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{r.caseName}</span>
                  {r.attempt > 1 && (
                    <span className="text-warning text-xs whitespace-nowrap">
                      第 {r.attempt} 次尝试
                    </span>
                  )}
                  <StatusChip status={r.status} />
                </div>
                <div className="text-muted-foreground mt-1.5 flex items-center gap-2 text-xs">
                  <span>
                    步骤 {r.stepIndex}/{r.stepTotal}
                  </span>
                  <span>·</span>
                  <span>{msToText(r.durationMs)}</span>
                </div>
                <ProgressBar
                  className="mt-2"
                  value={(r.stepIndex / Math.max(1, r.stepTotal)) * 100}
                  tone={r.status === "失败" ? "danger" : r.status === "通过" ? "success" : "primary"}
                />
                {r.status === "失败" && (
                  <div className="border-destructive/30 bg-destructive/5 text-destructive mt-2 rounded-lg border px-3 py-2 text-xs">
                    <p className="font-medium">失败原因：{r.failReason}</p>
                    {r.failedStep && <p className="mt-1 opacity-80">失败步骤：{r.failedStep}</p>}
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        retryTask(task.id, true);
                        toast.info("已发起失败重跑");
                      }}
                    >
                      <RefreshCw className="mr-1 size-3.5" />
                      重试该用例
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-4">
          <LogStream logs={task.logs} live={running} />
          {active && <RunSummary run={active} />}
        </div>
      </div>
    </PlatformShell>
  );
}

export function LogStream({ logs, live }: { logs: LogEntry[]; live?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs.length]);

  const tone: Record<LogEntry["level"], string> = {
    info: "text-muted-foreground",
    success: "text-success",
    warn: "text-warning",
    error: "text-destructive",
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          实时执行日志
          {live && <span className="bg-primary size-1.5 animate-pulse rounded-full" />}
        </span>
      }
      action={<span className="text-muted-foreground text-xs">{logs.length} 条</span>}
      bodyClassName="p-0"
    >
      <div ref={ref} className="bg-muted/40 max-h-80 overflow-y-auto p-3 font-mono text-[11px]">
        {logs.map((l) => (
          <div key={l.id} className="flex gap-2 py-0.5">
            <span className="text-muted-foreground shrink-0">{l.time}</span>
            <span className={cn("whitespace-pre-wrap", tone[l.level])}>{l.text}</span>
          </div>
        ))}
        {logs.length === 0 && <div className="text-muted-foreground">暂无日志</div>}
      </div>
    </Panel>
  );
}

function RunSummary({ run }: { run: CaseRun }) {
  return (
    <Panel title={`用例详情 · ${run.caseName}`}>
      <dl className="grid grid-cols-2 gap-y-2.5 text-xs">
        <dt className="text-muted-foreground">用例编号</dt>
        <dd className="font-mono">{run.caseId}</dd>
        <dt className="text-muted-foreground">执行状态</dt>
        <dd>
          <StatusChip status={run.status} />
        </dd>
        <dt className="text-muted-foreground">步骤进度</dt>
        <dd>
          {run.stepIndex}/{run.stepTotal}
        </dd>
        <dt className="text-muted-foreground">耗时</dt>
        <dd>{msToText(run.durationMs)}</dd>
        <dt className="text-muted-foreground">尝试次数</dt>
        <dd>{run.attempt}</dd>
      </dl>
      {run.status === "失败" ? (
        <p className="text-destructive mt-3 text-xs">{run.failReason}</p>
      ) : (
        <p className="text-muted-foreground mt-3 text-xs">
          失败时会自动采集截图、视频与 Trace（按系统配置策略）。
        </p>
      )}
    </Panel>
  );
}
