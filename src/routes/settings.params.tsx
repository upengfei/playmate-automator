import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { SettingsPageShell } from "@/components/settings-shell";
import { Panel } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deleteParamBinding, upsertParamBinding, useAppStore } from "@/lib/store";

export const Route = createFileRoute("/settings/params")({
  head: () => ({
    meta: [
      { title: "参数绑定 | 系统配置 | PlayFlow" },
      {
        name: "description",
        content: "为不同环境与设备配置参数取值，同一模板用例下发时自动替换占位符。",
      },
      { property: "og:title", content: "参数绑定 | 系统配置 | PlayFlow" },
      { property: "og:description", content: "环境 / 设备维度的参数取值管理与优先级说明。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ParamSettings,
});

function ParamSettings() {
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
    <SettingsPageShell
      title="参数绑定"
      desc="同一模板用例在不同环境 / 设备自动替换取值"
      showSave={false}
    >
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
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="参数名，如 BASE_URL"
          />
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
    </SettingsPageShell>
  );
}
