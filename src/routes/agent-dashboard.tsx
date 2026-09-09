import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Cpu, HardDrive, RefreshCw } from "lucide-react";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader, Panel, ProgressBar, StatCard, StatusChip } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { fetchAgentStats, type AgentStat } from "@/lib/platform.functions";
import { tickHeartbeats, useAppStore, versionOutdated } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/agent-dashboard")({
  head: () => ({
    meta: [
      { title: "Agent 仪表盘 | PlayFlow" },
      {
        name: "description",
        content: "按设备查看在线状态、任务领取数与执行成功率，并与平台任务队列联动排查瓶颈节点。",
      },
      { property: "og:title", content: "Agent 仪表盘 | PlayFlow" },
      { property: "og:description", content: "设备在线状态、任务领取数、执行成功率与任务队列联动。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgentDashboard,
});

type Stat = AgentStat & { taskCount: number };

function AgentDashboard() {
  const { agents, tasks, settings } = useAppStore();
  const [stats, setStats] = useState<Stat[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchAgentStats();
      setStats(res.stats as Stat[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      tickHeartbeats();
      void load();
    }, 8000);
    return () => clearInterval(t);
  }, []);

  const online = agents.filter((a) => a.status !== "离线");
  const queued = tasks.filter((t) => t.status === "排队中" || t.status === "下发中");
  const totalClaimed = stats.reduce((s, x) => s + x.claimed, 0);
  const totalPassed = stats.reduce((s, x) => s + x.passed, 0);
  const totalFailed = stats.reduce((s, x) => s + x.failed, 0);
  const overallRate = totalPassed + totalFailed ? Math.round((totalPassed / (totalPassed + totalFailed)) * 100) : 0;

  return (
    <PlatformShell>
      <PageHeader
        title="Agent 仪表盘"
        desc="每台设备的在线状态、任务领取数与执行成功率，实时与任务队列联动"
        action={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("mr-1 size-4", loading && "animate-spin")} />
            刷新
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="在线设备" value={`${online.length}/${agents.length}`} unit="台" tone="success" />
        <StatCard label="累计领取执行" value={totalClaimed} unit="次" tone="primary" />
        <StatCard
          label="整体成功率"
          value={overallRate}
          unit="%"
          tone={overallRate >= 90 ? "success" : overallRate >= 70 ? "warning" : "danger"}
          hint={`通过 ${totalPassed} · 失败 ${totalFailed}`}
        />
        <StatCard
          label="待下发任务"
          value={queued.length}
          unit="个"
          tone={queued.length ? "warning" : "default"}
          hint={queued.length ? queued.map((t) => t.name).slice(0, 2).join("、") : "队列已清空"}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {agents.length === 0 ? (
          <Panel title="暂无设备">
            <p className="text-muted-foreground text-sm">
              还没有设备注册。在
              <Link to="/download" className="text-primary mx-1 underline">
                客户端下载更新
              </Link>
              页安装 Agent，首次启动会自动注册。
            </p>
          </Panel>
        ) : (
          agents.map((a) => {
            const s = stats.find((x) => x.agentId === a.id);
            const agentTasks = tasks.filter((t) => t.agentId === a.id);
            const activeTask = agentTasks.find((t) => t.status === "运行中" || t.status === "下发中");
            const rate = s?.passRate ?? 0;
            return (
              <Panel
                key={a.id}
                title={a.name}
                action={<StatusChip status={versionOutdated(a, settings.minAgentVersion) ? "维护中" : a.status} />}
              >
                <div className="grid gap-3 text-xs sm:grid-cols-3">
                  <Metric label="任务领取数" value={`${s?.claimed ?? 0} 次`} />
                  <Metric label="关联任务" value={`${s?.taskCount ?? 0} 个`} />
                  <Metric
                    label="执行成功率"
                    value={`${rate}%`}
                    tone={rate >= 90 ? "success" : rate >= 70 ? "warning" : s?.claimed ? "danger" : "default"}
                  />
                  <Metric label="平均耗时" value={`${Math.round((s?.avgDurationMs ?? 0) / 100) / 10}s`} />
                  <Metric label="通过 / 失败" value={`${s?.passed ?? 0} / ${s?.failed ?? 0}`} />
                  <Metric label="版本" value={`v${a.version}`} />
                </div>

                <div className="mt-3 space-y-2">
                  <ProgressBar value={rate} tone={rate >= 70 ? "success" : "danger"} />
                  <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
                    <span className="flex items-center gap-1">
                      <Cpu className="size-3.5" /> CPU {a.cpu}%
                    </span>
                    <span className="flex items-center gap-1">
                      <HardDrive className="size-3.5" /> 内存 {a.memory}%
                    </span>
                    <span className="flex items-center gap-1">
                      <Activity className="size-3.5" /> 心跳 {a.heartbeatAgoSec}s 前
                    </span>
                    <span>并发 {a.concurrency}</span>
                  </div>
                </div>

                <div className="border-border/60 mt-3 border-t pt-3 text-xs">
                  {activeTask ? (
                    <p>
                      正在执行：
                      <Link to="/tasks/$taskId" params={{ taskId: activeTask.id }} className="text-primary underline">
                        {activeTask.name}
                      </Link>
                      （{activeTask.stage}）
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      当前空闲{s?.lastCaseName ? ` · 最近执行「${s.lastCaseName}」${s.lastStatus}` : ""}
                    </p>
                  )}
                  <p className="text-muted-foreground mt-1">
                    队列中指向本设备的任务：
                    {queued.filter((t) => t.agentId === a.id).length} 个
                  </p>
                </div>
              </Panel>
            );
          })
        )}
      </div>
    </PlatformShell>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const tones = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
  };
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm font-medium", tones[tone])}>{value}</p>
    </div>
  );
}
