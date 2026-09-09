import { createFileRoute } from "@tanstack/react-router";
import { SettingsPageShell, SettingsRow } from "@/components/settings-shell";
import { Panel } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateSettings, useAppStore } from "@/lib/store";

export const Route = createFileRoute("/settings/execution")({
  head: () => ({
    meta: [
      { title: "执行策略 | 系统配置 | PlayFlow" },
      { name: "description", content: "设置默认重试次数、并发数、Trace 采集与失败录像策略。" },
      { property: "og:title", content: "执行策略 | 系统配置 | PlayFlow" },
      { property: "og:description", content: "重试、并发、Trace 与失败录像的默认执行策略。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExecutionSettings,
});

function ExecutionSettings() {
  const { settings } = useAppStore();
  return (
    <SettingsPageShell title="执行策略" desc="重试、并发、Trace 采集与失败录像的默认策略">
      <Panel title="执行策略">
        <div className="space-y-4">
          <SettingsRow label="默认失败重试次数">
            <Input
              type="number"
              value={settings.defaultRetry}
              onChange={(e) => updateSettings({ defaultRetry: Number(e.target.value) })}
            />
          </SettingsRow>
          <SettingsRow label="默认并发数">
            <Input
              type="number"
              value={settings.defaultConcurrency}
              onChange={(e) => updateSettings({ defaultConcurrency: Number(e.target.value) })}
            />
          </SettingsRow>
          <SettingsRow label="Trace 采集">
            <Select
              value={settings.traceMode}
              onValueChange={(v) => updateSettings({ traceMode: v as typeof settings.traceMode })}
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
          </SettingsRow>
          <SettingsRow label="失败时录制视频">
            <Switch
              checked={settings.videoOnFailure}
              onCheckedChange={(v) => updateSettings({ videoOnFailure: v })}
            />
          </SettingsRow>
        </div>
      </Panel>
    </SettingsPageShell>
  );
}
