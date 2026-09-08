import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, CheckCircle2, Server, SquareStack, XCircle } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader, Panel, ProgressBar, StatCard, StatusChip } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { msToText, useAppStore } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "概览看板 | PlayFlow 自动化测试平台" },
      {
        name: "description",
        content:
          "PlayFlow 自动化测试平台概览：用例总量、任务执行情况、通过率趋势与执行节点在线状态一屏掌握。",
      },
      { property: "og:title", content: "概览看板 | PlayFlow 自动化测试平台" },
      {
        property: "og:description",
        content: "Playwright 用例管理、任务下发、实时进度与报告分析的一体化平台。",
      },
    ],
  }),
  component: Overview,
});

function Overview() {
  const { cases, tasks, reports, agents, trend } = useAppStore();
  const latest = reports[0];
  const passRate = latest ? Math.round((latest.passed / Math.max(1, latest.total)) * 100) : 0;
  const online = agents.filter((a) => a.status !== "离线");
  const failDistribution = [
    { name: "元素定位失败", value: 42 },
    { name: "断言不通过", value: 27 },
    { name: "环境/网络", value: 18 },
    { name: "脚本异常", value: 13 },
  ];
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

  return (
    <PlatformShell>
      <PageHeader
        title="概览看板"
        desc="平台整体运行状况、最近一次回归结果与可用执行节点"
        action={
          <Button asChild>
            <Link to="/tasks">新建执行任务</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="用例总数"
          value={cases.length}
          unit="个"
          hint={`就绪 ${cases.filter((c) => c.status === "就绪").length} · 草稿 ${cases.filter((c) => c.status === "草稿").length}`}
          icon={<Activity className="size-4" />}
        />
        <StatCard
          label="最近回归通过率"
          value={`${passRate}%`}
          tone={passRate >= 90 ? "success" : "warning"}
          hint={latest ? `${latest.taskName} · ${latest.finishedAt}` : "暂无报告"}
          icon={<CheckCircle2 className="size-4" />}
        />
        <StatCard
          label="待执行 / 执行中任务"
          value={
            tasks.filter((t) => ["排队中", "下发中", "运行中"].includes(t.status)).length
          }
          unit="个"
          tone="primary"
          hint={`累计任务 ${tasks.length} 个`}
          icon={<SquareStack className="size-4" />}
        />
        <StatCard
          label="可用执行节点"
          value={`${online.length}/${agents.length}`}
          tone="success"
          hint={`空闲并发 ${online.reduce((s, a) => s + a.concurrency, 0)} 路`}
          icon={<Server className="size-4" />}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel title="近 7 天执行通过 / 失败趋势" className="xl:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="gPass" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gFail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--popover-foreground)",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="passed"
                  name="通过"
                  stroke="var(--chart-2)"
                  fill="url(#gPass)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="failed"
                  name="失败"
                  stroke="var(--chart-4)"
                  fill="url(#gFail)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="失败原因分布">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={failDistribution} dataKey="value" innerRadius={45} outerRadius={70}>
                  {failDistribution.map((_, i) => (
                    <Cell key={i} fill={colors[i]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--popover-foreground)",
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-1.5 text-xs">
            {failDistribution.map((f, i) => (
              <li key={f.name} className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ background: colors[i] }}
                  aria-hidden
                />
                <span className="flex-1">{f.name}</span>
                <span className="text-muted-foreground tabular-nums">{f.value}%</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel
          title="任务队列"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/board">查看进度看板</Link>
            </Button>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y">
            {tasks.slice(0, 5).map((t) => {
              const done = t.caseRuns.filter((r) => r.status !== "等待中" && r.status !== "运行中")
                .length;
              return (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      to="/tasks/$taskId"
                      params={{ taskId: t.id }}
                      className="hover:text-primary truncate text-sm font-medium"
                    >
                      {t.name}
                    </Link>
                    <StatusChip status={t.status} />
                  </div>
                  <div className="text-muted-foreground mt-1.5 flex items-center gap-2 text-xs">
                    <span>{t.id}</span>
                    <span>·</span>
                    <span>{t.stage}</span>
                  </div>
                  <ProgressBar
                    className="mt-2"
                    value={(done / Math.max(1, t.caseRuns.length)) * 100}
                    tone={t.status === "失败" ? "danger" : "primary"}
                  />
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel
          title="最近报告"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/reports">全部报告</Link>
            </Button>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y">
            {reports.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.taskName}</div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {r.finishedAt} · {r.env} · {r.browser} · {msToText(r.durationMs)}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-success flex items-center gap-1">
                    <CheckCircle2 className="size-3.5" />
                    {r.passed}
                  </span>
                  <span className="text-destructive flex items-center gap-1">
                    <XCircle className="size-3.5" />
                    {r.failed}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </PlatformShell>
  );
}
