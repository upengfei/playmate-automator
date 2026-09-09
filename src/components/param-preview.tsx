import { useMemo, useState } from "react";
import { Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { applyParams, paramMap, resolveParams, type ResolvedParam } from "@/lib/case-params";
import { generatePlaywrightCode, type CaseStep } from "@/lib/keywords";
import { useAppStore, type CaseParam } from "@/lib/store";
import { cn } from "@/lib/utils";

const ENVS = ["测试环境", "预发环境", "生产环境"];

/** 参数绑定实时预览：切换环境 / 设备即可看到下发后真实的步骤与脚本 */
export function ParamPreview({
  caseName,
  startUrl,
  steps,
  params,
  usedNames,
}: {
  caseName: string;
  startUrl: string;
  steps: CaseStep[];
  params: CaseParam[];
  usedNames: string[];
}) {
  const { paramBindings, agents } = useAppStore();
  const [env, setEnv] = useState(ENVS[0] as string);
  const [agentId, setAgentId] = useState<string>("");

  const resolved = useMemo(
    () => resolveParams(params, paramBindings, env, agentId, usedNames),
    [params, paramBindings, env, agentId, usedNames],
  );
  const map = useMemo(() => paramMap(resolved), [resolved]);
  const previewSteps = useMemo(
    () =>
      steps.map((s) => ({
        ...s,
        target: applyParams(s.target ?? "", map),
        value: applyParams(s.value ?? "", map),
      })),
    [steps, map],
  );
  const previewUrl = applyParams(startUrl ?? "", map);
  const previewCode = useMemo(
    () => generatePlaywrightCode(caseName, previewSteps as CaseStep[]),
    [caseName, previewSteps],
  );
  const missing = resolved.filter((r) => r.source === "未定义" && usedNames.includes(r.name));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs">环境</p>
          <Select value={env} onValueChange={setEnv}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENVS.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs">执行设备</p>
          <Select value={agentId || "none"} onValueChange={(v) => setAgentId(v === "none" ? "" : v)}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="不指定设备" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不指定设备</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}（{a.status}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-muted-foreground pb-2 text-xs">
          取值优先级：设备绑定 &gt; 环境绑定 &gt; 用例默认值
        </p>
      </div>

      {resolved.length === 0 ? (
        <p className="text-muted-foreground text-xs">该用例还没有用到参数占位符。</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {resolved.map((r) => (
            <ParamChip key={r.name} item={r} env={env} agentId={agentId} />
          ))}
        </div>
      )}

      {missing.length > 0 && (
        <p className="text-warning text-xs">
          以下参数还没有取值，下发时会保留原始占位符：{missing.map((m) => m.name).join("、")}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium">替换后的步骤</p>
          <div className="divide-border/60 border-border/60 divide-y rounded-lg border text-xs">
            {previewUrl ? (
              <div className="p-2">
                <span className="text-muted-foreground">起始地址：</span>
                <span className="font-mono">{previewUrl}</span>
              </div>
            ) : null}
            {previewSteps.length === 0 ? (
              <div className="text-muted-foreground p-2">暂无步骤</div>
            ) : (
              previewSteps.map((s, i) => (
                <div key={s.id ?? i} className="flex gap-2 p-2">
                  <span className="text-muted-foreground w-6 shrink-0 text-right">{i + 1}</span>
                  <span className="w-24 shrink-0">{s.keyword}</span>
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {[s.target, s.value].filter(Boolean).join("  →  ")}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium">替换后的脚本</p>
          <pre className="bg-muted text-foreground max-h-72 overflow-auto rounded-lg p-3 text-[11px] leading-relaxed">
            <code>{previewCode}</code>
          </pre>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void navigator.clipboard?.writeText(previewCode)}
          >
            复制替换后的脚本
          </Button>
        </div>
      </div>
    </div>
  );
}

function ParamChip({ item, env, agentId }: { item: ResolvedParam; env: string; agentId: string }) {
  const undefinedParam = item.source === "未定义";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "rounded-full border px-2.5 py-1 font-mono text-xs transition-colors",
            undefinedParam
              ? "border-warning/50 text-warning hover:bg-warning/10"
              : "border-border/70 hover:bg-muted",
          )}
        >
          {"${"}
          {item.name}
          {"}"}
          <span className="text-muted-foreground ml-1 font-sans">
            {undefinedParam ? "未定义" : item.value || "（空）"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-xs">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Info className="size-3.5" />
          {item.name}
        </p>
        {item.note ? <p className="text-muted-foreground mt-1">{item.note}</p> : null}
        <ul className="mt-3 space-y-1.5">
          <SourceRow
            label={`设备绑定${agentId ? `（${agentId}）` : ""}`}
            value={item.agentValue}
            active={item.source === "设备绑定"}
          />
          <SourceRow
            label={`环境绑定（${env}）`}
            value={item.envValue}
            active={item.source === "环境绑定"}
          />
          <SourceRow
            label="用例默认值"
            value={item.caseValue}
            active={item.source === "用例默认值"}
          />
        </ul>
        <p className="text-muted-foreground mt-3">
          最终取值来自：{item.source}
          {undefinedParam ? "，请在系统配置 · 参数绑定里补齐" : ""}
        </p>
      </PopoverContent>
    </Popover>
  );
}

function SourceRow({
  label,
  value,
  active,
}: {
  label: string;
  value: string | undefined;
  active: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      {active ? (
        <Check className="text-success mt-0.5 size-3.5 shrink-0" />
      ) : (
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current opacity-25" />
      )}
      <span className="text-muted-foreground w-32 shrink-0">{label}</span>
      <span className={cn("min-w-0 flex-1 font-mono break-all", !active && "opacity-60")}>
        {value === undefined ? "—" : value || "（空）"}
      </span>
    </li>
  );
}
