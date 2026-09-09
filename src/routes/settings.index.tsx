import { createFileRoute } from "@tanstack/react-router";
import { SettingsPageShell, SettingsRow } from "@/components/settings-shell";
import { Panel } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import { updateSettings, useAppStore } from "@/lib/store";

export const Route = createFileRoute("/settings/")({
  head: () => ({
    meta: [
      { title: "基础信息 | 系统配置 | PlayFlow" },
      { name: "description", content: "配置平台名称、报告保留天数与界面主题。" },
      { property: "og:title", content: "基础信息 | 系统配置 | PlayFlow" },
      { property: "og:description", content: "平台名称、报告保留周期与浅色 / 深色主题设置。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BasicSettings,
});

function BasicSettings() {
  const { settings } = useAppStore();
  return (
    <SettingsPageShell title="基础信息" desc="平台名称、报告保留周期与界面主题">
      <Panel title="基础信息">
        <div className="space-y-4">
          <SettingsRow label="平台名称">
            <Input
              value={settings.platformName}
              onChange={(e) => updateSettings({ platformName: e.target.value })}
            />
          </SettingsRow>
          <SettingsRow label="报告保留天数">
            <Input
              type="number"
              value={settings.keepReportDays}
              onChange={(e) => updateSettings({ keepReportDays: Number(e.target.value) })}
            />
          </SettingsRow>
          <SettingsRow label="界面主题">
            <div className="flex items-center gap-2 text-sm">
              <ThemeToggle className="border" />
              <span className="text-muted-foreground">一键切换浅色 / 深色</span>
            </div>
          </SettingsRow>
        </div>
      </Panel>
    </SettingsPageShell>
  );
}
