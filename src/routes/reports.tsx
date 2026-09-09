import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, Clapperboard, Download, FileSearch } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader, Panel, ProgressBar, StatCard, StatusChip } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { msToText, useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "测试报告分析 | PlayFlow" },
      {
        name: "description",
        content: "分析每次执行的通过率、耗时分布与失败用例明细，定位不稳定用例并追溯失败原因。",
      },
      { property: "og:title", content: "测试报告分析 | PlayFlow" },
      { property: "og:description", content: "通过率、耗时分布与失败明细的报告分析视图。" },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { reports } = useAppStore();
  const [activeId, setActiveId] = useState(reports[0]?.id ?? "");
  const report = reports.find((r) => r.id === activeId) ?? reports[0];

  const rateData = reports
    .slice(0, 8)
    .reverse()
    .map((r) => ({
      name: r.id,
      通过率: Math.round((r.passed / Math.max(1, r.total)) * 100),
    }));

  return (
    <PlatformShell>
      <PageHeader
        title="测试报告分析"
        desc="每次任务执行都会生成报告，可下钻到用例级失败原因与执行产物"
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link
                to="/ai"
                search={{
                  q: report
                    ? `分析任务「${report.taskName}」的执行结果：通过 ${report.passed} / 共 ${report.total}，失败 ${report.failed}，总耗时 ${msToText(report.durationMs)}。请查询真实执行记录和日志，给出失败原因归类和改进建议。`
                    : "分析最近的测试执行数据，指出失败最多和最不稳定的用例，并给出改进建议",
                }}
              >
                <Bot className="mr-1 size-4" />
                AI 摘要分析
              </Link>
            </Button>
            <Button variant="outline" onClick={() => toast.success("报告已导出（演示）")}>
              <Download className="mr-1 size-4" />
              导出报告
            </Button>
          </div>
        }

      />

      {report && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="本次通过率"
            value={`${Math.round((report.passed / Math.max(1, report.total)) * 100)}%`}
            tone="success"
            hint={`${report.passed} 通过 / ${report.total} 总数`}
          />
          <StatCard label="失败用例" value={report.failed} unit="个" tone="danger" />
          <StatCard label="总耗时" value={msToText(report.durationMs)} tone="primary" />
          <StatCard
            label="执行环境"
            value={report.env}
            hint={`${report.browser} · ${report.agentName}`}
          />
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[20rem_1fr]">
        <Panel title="报告列表" bodyClassName="p-0">
          <ul className="divide-y">
            {reports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(r.id)}
                  className={cn(
                    "hover:bg-accent/50 w-full px-4 py-3 text-left",
                    r.id === report?.id && "bg-accent/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{r.taskName}</span>
                    <StatusChip status={r.failed > 0 ? "失败" : "通过"} />
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {r.id} · {r.finishedAt} · {msToText(r.durationMs)}
                  </div>
                  <ProgressBar
                    className="mt-2"
                    value={(r.passed / Math.max(1, r.total)) * 100}
                    tone={r.failed > 0 ? "danger" : "success"}
                  />
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel title="历史通过率对比">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rateData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      color: "var(--popover-foreground)",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="通过率" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {report && (
            <Panel
              title={`用例执行明细 · ${report.taskName}`}
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/tasks/$taskId" params={{ taskId: report.taskId }}>
                    <FileSearch className="mr-1 size-3.5" />
                    查看任务日志
                  </Link>
                </Button>
              }
              bodyClassName="p-0"
            >
              <ul className="divide-y">
                {report.cases.map((c) => (
                  <li key={c.caseId} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-muted-foreground w-20 font-mono text-xs">
                        {c.caseId}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{c.caseName}</span>
                      <span className="text-muted-foreground text-xs">{msToText(c.durationMs)}</span>
                      <StatusChip status={c.status} />
                    </div>
                    {c.status === "失败" && (
                      <div className="border-destructive/30 bg-destructive/5 mt-2 rounded-lg border p-3 text-xs">
                        <p className="text-destructive font-medium">{c.failReason}</p>
                        <p className="text-muted-foreground mt-1">失败步骤：{c.failedStep}</p>
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => toast.info("演示环境未包含真实截图")}>
                            <Camera className="mr-1 size-3.5" />
                            失败截图
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => toast.info("演示环境未包含真实录像")}>
                            <Clapperboard className="mr-1 size-3.5" />
                            执行录像
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </PlatformShell>
  );
}
