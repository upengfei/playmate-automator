import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader, Panel } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme-toggle";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteParamBinding, updateSettings, upsertParamBinding, useAppStore } from "@/lib/store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "系统配置 | PlayFlow" },
      {
        name: "description",
        content: "配置执行策略、Agent 最低版本、心跳超时、报告保留周期与失败通知方式。",
      },
      { property: "og:title", content: "系统配置 | PlayFlow" },
      { property: "og:description", content: "执行策略、节点校验与通知配置集中管理。" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { settings } = useAppStore();

  return (
    <PlatformShell>
      <PageHeader
        title="系统配置"
        desc="平台执行策略、节点校验规则与通知设置"
        action={
          <Button onClick={() => toast.success("配置已保存并生效")}>保存配置</Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="基础信息">
          <div className="space-y-4">
            <Row label="平台名称">
              <Input
                value={settings.platformName}
                onChange={(e) => updateSettings({ platformName: e.target.value })}
              />
            </Row>
            <Row label="报告保留天数">
              <Input
                type="number"
                value={settings.keepReportDays}
                onChange={(e) => updateSettings({ keepReportDays: Number(e.target.value) })}
              />
            </Row>
            <Row label="界面主题">
              <div className="flex items-center gap-2 text-sm">
                <ThemeToggle className="border" />
                <span className="text-muted-foreground">一键切换浅色 / 深色</span>
              </div>
            </Row>
          </div>
        </Panel>

        <Panel title="Agent 与节点校验">
          <div className="space-y-4">
            <Row label="最低 Agent 版本" hint="低于该版本的节点将拒绝接收任务">
              <Input
                value={settings.minAgentVersion}
                onChange={(e) => updateSettings({ minAgentVersion: e.target.value })}
              />
            </Row>
            <Row label="心跳超时（秒）" hint="超过该时长未上报心跳则判定为离线">
              <Input
                type="number"
                value={settings.heartbeatTimeoutSec}
                onChange={(e) => updateSettings({ heartbeatTimeoutSec: Number(e.target.value) })}
              />
            </Row>
            <Row label="自动下发" hint="任务创建后自动分配到空闲节点">
              <Switch
                checked={settings.autoDispatch}
                onCheckedChange={(v) => updateSettings({ autoDispatch: v })}
              />
            </Row>
            <Row label="版本拦截自动推送升级包" hint="版本校验未通过时自动推送升级，升级成功后自动续跑任务">
              <Switch
                checked={settings.autoUpgrade}
                onCheckedChange={(v) => updateSettings({ autoUpgrade: v })}
              />
            </Row>
            <Row label="更新通道" hint="灰度版会提前收到新功能">
              <div className="flex gap-1.5">
                {(["稳定版", "灰度版"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => updateSettings({ updateChannel: c })}
                    className={
                      settings.updateChannel === c
                        ? "bg-primary text-primary-foreground rounded-md px-2.5 py-1 text-xs"
                        : "bg-secondary text-muted-foreground rounded-md px-2.5 py-1 text-xs"
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            </Row>

          </div>
        </Panel>

        <Panel title="执行策略">
          <div className="space-y-4">
            <Row label="默认失败重试次数">
              <Input
                type="number"
                value={settings.defaultRetry}
                onChange={(e) => updateSettings({ defaultRetry: Number(e.target.value) })}
              />
            </Row>
            <Row label="默认并发数">
              <Input
                type="number"
                value={settings.defaultConcurrency}
                onChange={(e) => updateSettings({ defaultConcurrency: Number(e.target.value) })}
              />
            </Row>
            <Row label="Trace 采集">
              <Select
                value={settings.traceMode}
                onValueChange={(v) =>
                  updateSettings({ traceMode: v as typeof settings.traceMode })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["关闭", "仅失败", "始终"].map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label="失败时录制视频">
              <Switch
                checked={settings.videoOnFailure}
                onCheckedChange={(v) => updateSettings({ videoOnFailure: v })}
              />
            </Row>
          </div>
        </Panel>

        <Panel title="通知">
          <div className="space-y-4">
            <Row label="接收邮箱">
              <Input
                value={settings.notifyEmail}
                onChange={(e) => updateSettings({ notifyEmail: e.target.value })}
              />
            </Row>
            <Row label="失败时通知">
              <Switch
                checked={settings.notifyOnFailure}
                onCheckedChange={(v) => updateSettings({ notifyOnFailure: v })}
              />
            </Row>
            <p className="text-muted-foreground text-xs">
              演示环境不会真实发送邮件；接入通知渠道后可推送到邮箱、企业微信或钉钉。
            </p>
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <ParamBindings />
      </div>
    </PlatformShell>
  );
}

/** 环境 / 设备维度的参数绑定：下发任务时覆盖模板用例的默认取值 */
function ParamBindings() {
  const { paramBindings, agents, tasks } = useAppStore();
  const [scope, setScope] = useState<"环境" | "设备">("环境");
  const [scopeKey, setScopeKey] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const envs = Array.from(new Set(["测试环境", "预发环境", "生产环境", ...tasks.map((t) => t.env)]));

  const submit = async () => {
    if (!scopeKey.trim() || !name.trim()) {
      toast.error("请填写环境 / 设备与参数名");
      return;
    }
    await upsertParamBinding({ scope, scopeKey: scopeKey.trim(), name: name.trim(), value });
    setName("");
    setValue("");
    toast.success("参数绑定已保存，下次下发即生效");
  };

  return (
    <Panel title="参数绑定（同一模板用例在不同环境 / 设备自动替换取值）">
      <div className="grid gap-2 lg:grid-cols-[7rem_12rem_1fr_1fr_auto]">
        <Select value={scope} onValueChange={(v) => setScope(v as "环境" | "设备")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["环境", "设备"] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {scope === "设备" ? (
          <Select value={scopeKey} onValueChange={setScopeKey}>
            <SelectTrigger>
              <SelectValue placeholder="选择设备" />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select value={scopeKey} onValueChange={setScopeKey}>
            <SelectTrigger>
              <SelectValue placeholder="选择环境" />
            </SelectTrigger>
            <SelectContent>
              {envs.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="参数名，如 BASE_URL" />
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="取值" />
        <Button onClick={submit}>保存绑定</Button>
      </div>

      <div className="mt-3 divide-y rounded-lg border text-sm">
        {paramBindings.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-xs">
            还没有参数绑定。用例里写 {"${BASE_URL}"} 之类的占位符，再在这里为不同环境或设备配置取值。
          </p>
        ) : (
          paramBindings.map((b) => (
            <div key={b.id} className="flex items-center gap-3 px-3 py-2">
              <span className="bg-secondary rounded px-1.5 py-0.5 text-[11px]">{b.scope}</span>
              <span className="text-muted-foreground w-40 truncate text-xs">{b.scopeKey}</span>
              <span className="w-40 truncate font-mono text-xs">{b.name}</span>
              <span className="flex-1 truncate text-xs">{b.value}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="删除绑定"
                onClick={async () => {
                  await deleteParamBinding(b.id);
                  toast.info("绑定已删除");
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        取值优先级：设备绑定 &gt; 环境绑定 &gt; 用例默认值。
      </p>
    </Panel>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[9rem_1fr] sm:items-center">
      <div>
        <Label className="text-sm">{label}</Label>
        {hint ? <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}
