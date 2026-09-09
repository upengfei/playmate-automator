import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Play, RefreshCcw, Server } from "lucide-react";
import { toast } from "sonner";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader, Panel, StatusChip } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { dispatchToAgent, fetchLiveData, fetchRunLogs } from "@/lib/live.functions";


export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "真实节点与用例同步 | PlayFlow" },
      {
        name: "description",
        content:
          "查看真实安装的 PlayFlow Agent 节点、客户端上传的 Playwright 用例，以及真实浏览器执行记录与日志。",
      },
      { property: "og:title", content: "真实节点与用例同步 | PlayFlow" },
      {
        property: "og:description",
        content: "真实客户端注册、用例上传、真实浏览器执行结果与实时日志。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LivePage,
});

interface AgentRow {
  id: string;
  name: string;
  host: string;
  os: string;
  version: string;
  status: string;
  last_heartbeat: string;
  capabilities: string[];
}
interface CaseRow {
  id: string;
  name: string;
  module: string;
  start_url: string;
  source: string;
  priority: string;
  steps: unknown[];
  updated_at: string;
}
interface RunRow {
  id: string;
  case_name: string;
  agent_id: string | null;
  status: string;
  duration_ms: number | null;
  error: string | null;
  started_at: string;
}
interface LogRow {
  id: string;
  run_id: string | null;
  level: string;
  message: string;
  at: string;
}


function LivePage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const res = await fetchLiveData();
    setAgents(res.agents as AgentRow[]);
    setCases(res.cases as CaseRow[]);
    setRuns(res.runs as RunRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!activeRun) return;
    const loadLogs = async () => {
      const res = await fetchRunLogs({ data: { runId: activeRun } });
      setLogs(res.logs as LogRow[]);
    };
    void loadLogs();
    const id = setInterval(() => void loadLogs(), 3000);
    return () => clearInterval(id);
  }, [activeRun]);


  const online = agents.filter(
    (a) => a.status === "在线" && Date.now() - new Date(a.last_heartbeat).getTime() < 90_000,
  );

  const dispatch = async (caseId: string) => {
    const agent = online[0] ?? agents[0];
    if (!agent) {
      toast.error("暂无已注册的真实节点");
      return;
    }
    try {
      const res = await dispatchToAgent({ data: { caseId, agentId: agent.id } });
      setActiveRun(res.runId);
      toast.success(`已下发到 ${agent.id}，客户端将用真实浏览器执行`);
      void load();
    } catch (err) {
      toast.error(`下发失败：${String(err)}`);
    }
  };

  return (
    <PlatformShell>
      <PageHeader
        title="真实节点与用例同步"
        desc="这里展示真实安装的 Agent 客户端注册结果、客户端上传的用例，以及真实 Playwright 浏览器的执行记录与日志。"
        action={
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCcw className="mr-1.5 size-4" />
            刷新
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title={`已注册真实节点（${agents.length}）`}
          action={<StatusChip status={online.length ? "在线" : "离线"} />}
        >
          {loading ? (
            <p className="text-muted-foreground text-xs">加载中…</p>
          ) : agents.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              还没有真实节点注册。在电脑上安装 Agent 客户端并启动，它会自动注册到这里。
            </p>
          ) : (
            <ul className="space-y-2.5">
              {agents.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium">
                      <Server className="text-primary size-3.5" />
                      {a.name}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {a.host} · {a.os} · v{a.version}
                    </p>
                    <p className="text-muted-foreground text-[11px]">
                      最近心跳 {new Date(a.last_heartbeat).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <StatusChip
                    status={
                      Date.now() - new Date(a.last_heartbeat).getTime() < 90_000 ? "在线" : "离线"
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`客户端上传的用例（${cases.length}）`}>
          {cases.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              还没有用例上传。在客户端录制后点击上传，用例会自动出现在这里。
            </p>
          ) : (
            <ul className="space-y-2.5">
              {cases.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {c.module} · {c.priority} · {c.steps.length} 步 · {c.source}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => void dispatch(c.id)}>
                    <Play className="mr-1 size-3.5" />
                    下发执行
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="真实执行记录">
          {runs.length === 0 ? (
            <p className="text-muted-foreground text-xs">暂无真实执行记录。</p>
          ) : (
            <ul className="space-y-2">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    className={`hover:bg-muted/60 flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm ${activeRun === r.id ? "bg-muted" : ""}`}
                    onClick={() => setActiveRun(r.id)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.case_name || "未命名用例"}</span>
                      <span className="text-muted-foreground text-xs">
                        {r.agent_id ?? "未指派"} ·{" "}
                        {new Date(r.started_at).toLocaleTimeString("zh-CN")}
                        {r.duration_ms ? ` · ${(r.duration_ms / 1000).toFixed(1)}s` : ""}
                      </span>
                    </span>
                    <StatusChip status={r.status} />
                  </button>
                  {r.error ? (
                    <p className="text-destructive px-2 text-[11px]">{r.error}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="执行日志">
          {!activeRun ? (
            <p className="text-muted-foreground text-xs">选择一条执行记录查看客户端回传的真实日志。</p>
          ) : logs.length === 0 ? (
            <p className="text-muted-foreground text-xs">等待客户端回传日志…</p>
          ) : (
            <pre className="bg-muted/60 max-h-80 overflow-auto rounded-lg p-3 font-mono text-[11px] leading-relaxed">
              {logs
                .map((l) => `[${new Date(l.at).toLocaleTimeString("zh-CN")}] ${l.level} ${l.message}`)
                .join("\n")}
            </pre>
          )}
        </Panel>
      </div>
    </PlatformShell>
  );
}
