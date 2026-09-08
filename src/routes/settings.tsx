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
import { updateSettings, useAppStore } from "@/lib/store";

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

export default function noop() {}

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
    </PlatformShell>
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
