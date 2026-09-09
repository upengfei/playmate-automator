import { createFileRoute } from "@tanstack/react-router";
import { SettingsPageShell, SettingsRow } from "@/components/settings-shell";
import { Panel } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { updateSettings, useAppStore } from "@/lib/store";

export const Route = createFileRoute("/settings/agents")({
  head: () => ({
    meta: [
      { title: "Agent 与节点校验 | 系统配置 | PlayFlow" },
      { name: "description", content: "设置最低 Agent 版本、心跳超时、自动下发与自动升级策略。" },
      { property: "og:title", content: "Agent 与节点校验 | 系统配置 | PlayFlow" },
      { property: "og:description", content: "节点版本校验、心跳超时与升级推送配置。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgentSettings,
});

function AgentSettings() {
  const { settings } = useAppStore();
  return (
    <SettingsPageShell title="Agent 与节点校验" desc="节点版本校验、心跳超时与升级推送规则">
      <Panel title="Agent 与节点校验">
        <div className="space-y-4">
          <SettingsRow label="最低 Agent 版本" hint="低于该版本的节点将拒绝接收任务">
            <Input
              value={settings.minAgentVersion}
              onChange={(e) => updateSettings({ minAgentVersion: e.target.value })}
            />
          </SettingsRow>
          <SettingsRow label="心跳超时（秒）" hint="超过该时长未上报心跳则判定为离线">
            <Input
              type="number"
              value={settings.heartbeatTimeoutSec}
              onChange={(e) => updateSettings({ heartbeatTimeoutSec: Number(e.target.value) })}
            />
          </SettingsRow>
          <SettingsRow label="自动下发" hint="任务创建后自动分配到空闲节点">
            <Switch
              checked={settings.autoDispatch}
              onCheckedChange={(v) => updateSettings({ autoDispatch: v })}
            />
          </SettingsRow>
          <SettingsRow
            label="版本拦截自动推送升级包"
            hint="版本校验未通过时自动推送升级，升级成功后自动续跑任务"
          >
            <Switch
              checked={settings.autoUpgrade}
              onCheckedChange={(v) => updateSettings({ autoUpgrade: v })}
            />
          </SettingsRow>
          <SettingsRow label="更新通道" hint="灰度版会提前收到新功能">
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
          </SettingsRow>
        </div>
      </Panel>
    </SettingsPageShell>
  );
}
