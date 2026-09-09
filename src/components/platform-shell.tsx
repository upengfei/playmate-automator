import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  ChevronDown,
  FileCode2,
  Gauge,
  ListChecks,
  MonitorDown,
  MonitorSmartphone,
  Server,
  LogOut,
  Settings,
  SquareStack,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatusChip } from "@/components/ui-bits";
import { tickHeartbeats, useAppStore } from "@/lib/store";
import { signOut, useAuth } from "@/lib/use-auth";
import { cn } from "@/lib/utils";

type NavLeaf = { to: string; label: string; icon: typeof Gauge };
type NavGroup = { key: string; label: string; icon: typeof Gauge; children: NavLeaf[] };
type NavItem = NavLeaf | NavGroup;

const NAV: NavItem[] = [
  { to: "/", label: "概览看板", icon: Gauge },
  { to: "/cases", label: "用例管理", icon: FileCode2 },
  {
    key: "tasks",
    label: "任务管理",
    icon: SquareStack,
    children: [
      { to: "/tasks", label: "任务编排与下发", icon: SquareStack },
      { to: "/board", label: "任务进度看板", icon: ListChecks },
    ],
  },
  { to: "/reports", label: "测试报告分析", icon: Activity },
  {
    key: "agents",
    label: "Agent 管理",
    icon: Server,
    children: [
      { to: "/agents", label: "执行节点管理", icon: Server },
      { to: "/agent-dashboard", label: "Agent 仪表盘", icon: Gauge },
      { to: "/live", label: "真实节点与用例", icon: MonitorSmartphone },
      { to: "/download", label: "客户端下载更新", icon: MonitorDown },
    ],
  },
  { to: "/settings", label: "系统配置", icon: Settings },
];

const FLAT_NAV: NavLeaf[] = NAV.flatMap((item) => ("children" in item ? item.children : [item]));

const isLeafActive = (to: string, pathname: string) =>
  to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);


export function PlatformShell({ children }: { children: ReactNode }) {
  const state = useAppStore();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { session, loading, email } = useAuth();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

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
          {NAV.map((item) =>
            "children" in item ? (
              <NavGroupBlock key={item.key} group={item} pathname={pathname} />
            ) : (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isLeafActive(item.to, pathname)
                    ? "bg-primary-soft text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ),
          )}
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
            {FLAT_NAV.map((item) => (
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
              {(email || "QA").slice(0, 2).toUpperCase()}
            </div>
            <span className="text-muted-foreground hidden max-w-40 truncate text-xs sm:inline">
              {email}
            </span>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth" });
              }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs"
            >
              <LogOut className="size-3.5" />
              退出登录
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function NavGroupBlock({ group, pathname }: { group: NavGroup; pathname: string }) {
  const groupActive = group.children.some((c) => isLeafActive(c.to, pathname));
  const [open, setOpen] = useState(groupActive);

  useEffect(() => {
    if (groupActive) setOpen(true);
  }, [groupActive]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          groupActive
            ? "bg-primary-soft text-primary font-medium"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <group.icon className="size-4" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-border/60 mt-1 ml-5 space-y-1 border-l pl-2">
          {group.children.map((child) => (
            <Link
              key={child.to}
              to={child.to}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                isLeafActive(child.to, pathname)
                  ? "bg-primary-soft text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <child.icon className="size-4" />
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

