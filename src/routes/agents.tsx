import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Cpu, HardDrive, Power, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader, Panel, ProgressBar, StatCard, StatusChip } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  toggleAgentOnline,
  upgradeAgent,
  useAppStore,
  versionOutdated,
  type Agent,
} from "@/lib/store";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "执行节点管理 | PlayFlow" },
      {
        name: "description",
        content: "查看桌面 Agent 设备信息、版本校验结果与在线离线心跳状态，管理平台可用执行节点。",
      },
      { property: "og:title", content: "执行节点管理 | PlayFlow" },
      {
        property: "og:description",
        content: "设备管理、版本校验与在线状态监控，实时掌握可用执行节点。",
      },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const { agents, settings, tasks } = useAppStore();
  const online = agents.filter((a) => a.status !== "离线");
  const outdated = agents.filter((a) => versionOutdated(a, settings.minAgentVersion));

  return (
    <PlatformShell>
      <PageHeader
        title="执行节点管理"
        desc={`心跳超时阈值 ${settings.heartbeatTimeoutSec} 秒 · 最低 Agent 版本要求 v${settings.minAgentVersion}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="注册设备" value={agents.length} unit="台" />
        <StatCard label="在线节点" value={online.length} unit="台" tone="success" />
        <StatCard
          label="忙碌节点"
          value={agents.filter((a) => a.status === "忙碌").length}
          unit="台"
          tone="primary"
        />
        <StatCard
          label="版本不合规"
          value={outdated.length}
          unit="台"
          tone={outdated.length ? "danger" : "success"}
          hint={outdated.length ? "低于最低版本，无法接收任务" : "全部通过版本校验"}
        />
      </div>

      {outdated.length > 0 && (
        <div className="border-warning/40 bg-warning/10 mt-4 flex items-start gap-3 rounded-xl border p-4 text-sm">
          <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">存在版本不合规的执行节点</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {outdated.map((a) => `${a.name}（v${a.version}）`).join("、")}
              低于最低要求 v{settings.minAgentVersion}，任务下发时会被拦截。可推送升级包后重试。
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            minVersion={settings.minAgentVersion}
            taskName={tasks.find((t) => t.id === a.runningTaskId)?.name}
          />
        ))}
      </div>

      <Panel title="心跳监控日志" className="mt-4" bodyClassName="p-0">
        <ul className="divide-y text-xs">
          {agents.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="font-mono">{a.id}</span>
              <span className="flex-1 truncate">
                {a.name} · {a.ip} · v{a.version}
              </span>
              <span className="text-muted-foreground">最后心跳 {a.lastHeartbeat}</span>
              <StatusChip status={a.status} />
            </li>
          ))}
        </ul>
      </Panel>
    </PlatformShell>
  );
}

function AgentCard({
  agent,
  minVersion,
  taskName,
}: {
  agent: Agent;
  minVersion: string;
  taskName?: string | undefined;
}) {
  const bad = versionOutdated(agent, minVersion);
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {agent.name}
          <StatusChip status={agent.status} />
        </span>
      }
      action={
        <div className="flex gap-1">
          {bad && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                pushUpgrade(agent.id);
                toast.info(`已向 ${agent.name} 推送升级包，等待回传结果`);
              }}
            >
              <RefreshCw className="mr-1 size-3.5" />
              推送升级包
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              toggleAgentOnline(agent.id);
              toast.info(`${agent.name} 已${agent.status === "离线" ? "上线" : "下线"}`);
            }}
          >
            <Power className="mr-1 size-3.5" />
            {agent.status === "离线" ? "模拟上线" : "模拟离线"}
          </Button>
        </div>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
        <Field label="节点 ID" value={agent.id} />
        <Field label="主机名" value={agent.host} />
        <Field label="内网 IP" value={agent.ip} />
        <Field label="操作系统" value={agent.os} />
        <Field
          label="Agent 版本"
          value={
            <span className={bad ? "text-destructive font-medium" : "text-success font-medium"}>
              v{agent.version}
              {bad ? " · 校验未通过" : " · 校验通过"}
            </span>
          }
        />
        <Field label="最大并发" value={`${agent.concurrency} 路`} />
        <Field label="累计执行" value={`${agent.totalRuns} 次`} />
        <Field label="最后心跳" value={agent.lastHeartbeat} />
      </dl>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {agent.browsers.map((b) => (
          <span key={b} className="bg-secondary rounded-md px-2 py-0.5 text-[11px]">
            {b}
          </span>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-muted-foreground mb-1.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1">
              <Cpu className="size-3.5" />
              CPU
            </span>
            <span className="tabular-nums">{agent.cpu}%</span>
          </div>
          <ProgressBar value={agent.cpu} tone={agent.cpu > 80 ? "danger" : "primary"} />
        </div>
        <div>
          <div className="text-muted-foreground mb-1.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1">
              <HardDrive className="size-3.5" />
              内存
            </span>
            <span className="tabular-nums">{agent.memory}%</span>
          </div>
          <ProgressBar value={agent.memory} tone={agent.memory > 80 ? "danger" : "success"} />
        </div>
      </div>

      <div className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
        <ShieldCheck className="size-3.5" />
        {agent.status === "忙碌" && taskName
          ? `正在执行任务：${taskName}`
          : agent.status === "在线"
            ? "空闲，可接收任务下发"
            : "离线，不参与任务调度"}
      </div>
    </Panel>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
