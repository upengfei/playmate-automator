import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Apple,
  CheckCircle2,
  Download,
  MonitorDown,
  RefreshCcw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader, Panel, StatusChip } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerDevice, useAppStore } from "@/lib/store";

export const Route = createFileRoute("/download")({
  head: () => ({
    meta: [
      { title: "下载与安装 Agent 客户端 | PlayFlow" },
      {
        name: "description",
        content:
          "下载 PlayFlow Agent 桌面客户端安装包（Windows / macOS / Linux），查看安装步骤、静默安装参数与自动更新机制。",
      },
      { property: "og:title", content: "下载与安装 Agent 客户端 | PlayFlow" },
      {
        property: "og:description",
        content: "Electron 桌面客户端安装包下载、校验、静默部署与自动更新说明。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DownloadPage,
});

const ICONS = [MonitorDown, Apple, Terminal];

/** 设备注册：为一台真实设备签发节点令牌，客户端用它登录平台并回传执行 / 升级结果 */
function DeviceRegister() {
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (rotate: boolean) => {
    const id = agentId.trim();
    if (!/^[A-Za-z0-9_.-]{2,64}$/.test(id)) {
      toast.error("节点标识请使用 2-64 位字母、数字、下划线、点或短横线");
      return;
    }
    setBusy(true);
    try {
      const res = await registerDevice(id, name.trim() || id, rotate);
      setToken(res.token);
      toast.success(rotate ? "已重新签发节点令牌" : "设备注册成功，已签发节点令牌");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "注册失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="注册设备并获取节点令牌">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label>节点标识</Label>
          <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="QA-WIN-07" />
        </div>
        <div className="space-y-1.5">
          <Label>设备名称（可选）</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="回归测试机 07" />
        </div>
        <Button disabled={busy} onClick={() => submit(false)}>
          <ShieldCheck className="mr-1.5 size-4" />
          注册设备
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => submit(true)}>
          <RefreshCcw className="mr-1.5 size-4" />
          重置令牌
        </Button>
      </div>

      {token ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs">
            请把下面的节点令牌填入客户端「平台设置」，或写入环境变量后启动客户端。
            令牌只在此处展示一次，遗失后可点「重置令牌」重新签发（旧令牌立即失效）。
          </p>
          <pre className="bg-muted/60 overflow-x-auto rounded-lg p-3 font-mono text-[11px] leading-relaxed">
            {`PLAYFLOW_AGENT_ID=${agentId.trim()}
PLAYFLOW_AGENT_TOKEN=${token}`}
          </pre>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(token);
              toast.success("节点令牌已复制");
            }}
          >
            复制令牌
          </Button>
          <p className="text-muted-foreground text-xs">
            客户端注册 / 心跳、领取任务、回传执行结果与升级结果都会校验该令牌，校验不通过的请求会被平台直接拒绝。
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

function DownloadPage() {
  const { release, settings } = useAppStore();

  return (
    <PlatformShell>
      <PageHeader
        title="下载与安装 Agent 客户端"
        desc={`当前发布版本 v${release.version}（${release.channel}，发布于 ${release.publishedAt}）· 最低要求 v${settings.minAgentVersion}`}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {release.artifacts.map((a, i) => {
          const Icon = ICONS[i] ?? Download;
          return (
            <Panel key={a.file} title={a.platform}>
              <div className="flex items-start gap-3">
                <div className="bg-primary-soft text-primary grid size-10 shrink-0 place-items-center rounded-lg">
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{a.file}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {a.sizeMB} MB · 内置 Playwright 执行内核
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground mt-3 truncate font-mono text-[11px]">
                SHA256 {a.sha256}
              </p>
              <Button
                className="mt-3 w-full"
                onClick={() => toast.success(`开始下载 ${a.file}`)}
                asChild
              >
                <a href={a.url} download={a.file} target="_blank" rel="noreferrer">
                  <Download className="mr-1.5 size-4" />
                  下载安装包
                </a>
              </Button>
            </Panel>
          );
        })}
      </div>

      <div className="mt-4">
        <DeviceRegister />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="安装流程">
          <ol className="space-y-3 text-sm">
            {[
              {
                t: "1. 安装客户端",
                d: "Windows 解压后运行 PlayFlowAgent.exe；macOS 拖入「应用程序」；Linux 解压后执行 ./PlayFlowAgent。首次启动会自动安装浏览器内核。",
              },
              {
                t: "2. 绑定平台与节点",
                d: "首次启动填写平台地址与节点名称，也可用环境变量预置：PLAYFLOW_PLATFORM_URL、PLAYFLOW_AGENT_ID。",
              },
              {
                t: "3. 注册与版本校验",
                d: "客户端注册后上报设备信息与版本，低于最低版本会被平台拦截任务并自动推送升级包。",
              },
              {
                t: "4. 常驻托盘接单",
                d: "关闭窗口后 Agent 常驻系统托盘，可从托盘直接录制、执行、调试、上传，并持续接收平台下发任务。",
              },
            ].map((s) => (
              <li key={s.t} className="flex gap-2.5">
                <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">{s.t}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="space-y-4">
          <Panel title={`更新说明 v${release.version}`} action={<StatusChip status="在线" />}>
            <ul className="text-muted-foreground list-disc space-y-1.5 pl-4 text-xs">
              {release.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Panel>

          <Panel title="更新检查与手动安装">
            <ul className="space-y-2.5 text-xs">
              <li className="flex gap-2">
                <RefreshCcw className="text-primary mt-0.5 size-3.5 shrink-0" />
                客户端启动时以及每 5 分钟拉取一次版本清单，发现新版本即下载升级包。
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="text-success mt-0.5 size-3.5 shrink-0" />
                下载完成后校验 SHA256；校验失败时停止安装并回传失败原因。
              </li>
              <li className="flex gap-2">
                <MonitorDown className="text-primary mt-0.5 size-3.5 shrink-0" />
                点击「打开安装包」后手动解压、替换旧版应用并启动新版本。等待安装期间，当前 Agent 继续运行。
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="text-success mt-0.5 size-3.5 shrink-0" />
                下载后显示「等待手动安装」；新版本启动并检查版本后，才向平台确认升级成功。
              </li>
            </ul>
          </Panel>

          <Panel title="企业批量静默部署">
            <pre className="bg-muted/60 overflow-x-auto rounded-lg p-3 font-mono text-[11px] leading-relaxed">
              {`# Windows（静默安装并预置平台地址）
PlayFlowAgent-Setup.exe /S ^
  /PLATFORM=https://playflow.example.com ^
  /AGENT_ID=QA-WIN-07

# Linux / macOS
export PLAYFLOW_PLATFORM_URL=https://playflow.example.com
export PLAYFLOW_AGENT_ID=QA-LINUX-03
./PlayFlowAgent --silent --autostart`}
            </pre>
          </Panel>
        </div>
      </div>
    </PlatformShell>
  );
}
