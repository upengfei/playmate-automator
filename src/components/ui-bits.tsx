import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { AgentStatus, CaseStatus, RunStatus, TaskStatus } from "@/lib/store";

type AnyStatus = RunStatus | TaskStatus | AgentStatus | CaseStatus | string;

const STATUS_STYLES: Record<string, string> = {
  通过: "bg-success/12 text-success border-success/30",
  已完成: "bg-success/12 text-success border-success/30",
  在线: "bg-success/12 text-success border-success/30",
  就绪: "bg-success/12 text-success border-success/30",
  失败: "bg-destructive/12 text-destructive border-destructive/30",
  运行中: "bg-primary/12 text-primary border-primary/30",
  下发中: "bg-primary/12 text-primary border-primary/30",
  忙碌: "bg-primary/12 text-primary border-primary/30",
  排队中: "bg-warning/15 text-warning-foreground border-warning/40 dark:text-warning",
  等待中: "bg-muted text-muted-foreground border-border",
  维护中: "bg-warning/15 text-warning-foreground border-warning/40 dark:text-warning",
  草稿: "bg-muted text-muted-foreground border-border",
  已跳过: "bg-muted text-muted-foreground border-border",
  已取消: "bg-muted text-muted-foreground border-border",
  离线: "bg-muted text-muted-foreground border-border",
};

export function StatusChip({
  status,
  pulse,
  className,
}: {
  status: AnyStatus;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground border-border",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full bg-current",
          (pulse ?? (status === "运行中" || status === "下发中" || status === "忙碌")) &&
            "animate-pulse",
        )}
      />
      {status}
    </span>
  );
}

export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "success" | "danger" | "primary" | "warning";
}) {
  const tones = {
    default: "text-foreground",
    success: "text-success",
    danger: "text-destructive",
    primary: "text-primary",
    warning: "text-warning",
  };
  return (
    <div className="md-elevation-1 bg-card rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center justify-between text-sm">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className={cn("text-2xl font-semibold tabular-nums", tones[tone])}>{value}</span>
        {unit ? <span className="text-muted-foreground text-sm">{unit}</span> : null}
      </div>
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("md-elevation-1 bg-card rounded-xl border", className)}>
      <header className="flex min-h-14 items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {desc ? <p className="text-muted-foreground mt-1 text-sm">{desc}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "primary",
  className,
}: {
  value: number;
  tone?: "primary" | "success" | "danger";
  className?: string;
}) {
  const bg = { primary: "bg-primary", success: "bg-success", danger: "bg-destructive" }[tone];
  return (
    <div className={cn("bg-muted h-1.5 w-full overflow-hidden rounded-full", className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-500", bg)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
