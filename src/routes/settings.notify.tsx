import { createFileRoute } from "@tanstack/react-router";
import { SettingsPageShell, SettingsRow } from "@/components/settings-shell";
import { Panel } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { updateSettings, useAppStore } from "@/lib/store";

export const Route = createFileRoute("/settings/notify")({
  head: () => ({
    meta: [
      { title: "通知 | 系统配置 | PlayFlow" },
      { name: "description", content: "配置失败通知开关与接收邮箱，执行失败时及时提醒。" },
      { property: "og:title", content: "通知 | 系统配置 | PlayFlow" },
      { property: "og:description", content: "执行失败通知方式与接收邮箱设置。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NotifySettings,
});

function NotifySettings() {
  const { settings } = useAppStore();
  return (
    <SettingsPageShell title="通知" desc="执行失败时的提醒方式与接收人">
      <Panel title="通知">
        <div className="space-y-4">
          <SettingsRow label="接收邮箱">
            <Input
              value={settings.notifyEmail}
              onChange={(e) => updateSettings({ notifyEmail: e.target.value })}
            />
          </SettingsRow>
          <SettingsRow label="失败时通知">
            <Switch
              checked={settings.notifyOnFailure}
              onCheckedChange={(v) => updateSettings({ notifyOnFailure: v })}
            />
          </SettingsRow>
          <p className="text-muted-foreground text-xs">
            演示环境不会真实发送邮件；接入通知渠道后可推送到邮箱、企业微信或钉钉。
          </p>
        </div>
      </Panel>
    </SettingsPageShell>
  );
}
