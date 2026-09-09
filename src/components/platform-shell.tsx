import { useEffect, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  FileCode2,
  Gauge,
  ListChecks,
  MonitorDown,
  MonitorSmartphone,
  Server,
  Settings,
  SquareStack,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatusChip } from "@/components/ui-bits";
import { tickHeartbeats, useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "概览看板", icon: Gauge },
  { to: "/cases", label: "用例管理", icon: FileCode2 },
  { to: "/tasks", label: "任务编排与下发", icon: SquareStack },
  { to: "/board", label: "任务进度看板", icon: ListChecks },
  { to: "/reports", label: "测试报告分析", icon: Activity },
  { to: "/agents", label: "执行节点管理", icon: Server },
  { to: "/live", label: "真实节点与用例", icon: MonitorSmartphone },
  { to: "/download", label: "客户端下载更新", icon: MonitorDown },
  { to: "/settings", label: "系统配置", icon: Settings },
] as const;

export function PlatformShell({ children }: { children: ReactNode }) {
  const state = useAppStore();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    tickHeartbeats();
    const id = setInterval(() => tickHeartbeats(), 3000);
    return () => clearInterval(id);
  }, []);

  const online = state.agents.filter((a) => a.status !== "离线").length;
  const running = state.tasks.filter((t) => t.status === "运行中" || t.status === "下发中").length;

  return (
    <div className="bg-background text-foreground flex min-h-screen">
      <aside className="bg-sidebar sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r lg:flex">
        <div className="flex h-16 items-center gap-2.5 border-b px-5">
          <div className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg font-bold">
            P
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">PlayFlow</div>
            <div className="text-muted-foreground text-[11px]">Playwright 自动化平台</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary-soft text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
          <div className="pt-3">
            <div className="text-muted-foreground px-3 pb-1 text-[11px] font-medium">桌面端</div>
            <Link
              to="/desktop"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                pathname.startsWith("/desktop")
                  ? "bg-primary-soft text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <MonitorSmartphone className="size-4" />
              Agent 客户端
            </Link>
          </div>
        </nav>
        <div className="text-muted-foreground border-t p-3 text-xs">
          <div className="flex items-center justify-between">
            <span>可用执行节点</span>
            <span className="text-success font-medium">{online}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>执行中任务</span>
            <span className="text-primary font-medium">{running}</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card/85 sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3 overflow-x-auto lg:hidden">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-muted-foreground [&.active]:text-primary text-xs whitespace-nowrap"
                activeProps={{ className: "active font-medium" }}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="hidden text-sm font-medium lg:block">{state.settings.platformName}</div>
          <div className="flex items-center gap-2">
            <StatusChip status={running > 0 ? "运行中" : "在线"} className="hidden sm:inline-flex" />
            <ThemeToggle />
            <div className="bg-primary-soft text-primary grid size-8 place-items-center rounded-full text-xs font-semibold">
              QA
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
