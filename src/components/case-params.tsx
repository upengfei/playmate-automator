import { Plus, Trash2, Variable } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { CaseParam } from "@/lib/store";
import { isLoopVar } from "@/lib/case-params";

/** 用例参数（模板变量）编辑器：步骤与起始地址里用 ${参数名} 引用 */
export function CaseParamsEditor({
  params,
  isTemplate,
  onChange,
  onTemplateChange,
  usedNames,
}: {
  params: CaseParam[];
  isTemplate: boolean;
  onChange: (next: CaseParam[]) => void;
  onTemplateChange: (v: boolean) => void;
  usedNames: string[];
}) {
  const defined = new Set(params.map((p) => p.name));
  // 循环变量（${当前循环} 等）由执行时的循环上下文提供，不需要在这里定义默认值
  const missing = usedNames.filter((n) => !defined.has(n) && !isLoopVar(n));

  const update = (i: number, patch: Partial<CaseParam>) =>
    onChange(params.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-sm">设为模板用例</Label>
          <p className="text-muted-foreground mt-0.5 text-xs">
            模板可在用例列表一键派生新用例，参数默认值会一起复制
          </p>
        </div>
        <Switch checked={isTemplate} onCheckedChange={onTemplateChange} />
      </div>

      {params.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          还没有参数。在步骤里写 <code className="font-mono">{"${BASE_URL}"}</code> 之类的占位符，
          再在这里定义默认值；不同环境或设备的取值在「系统配置 · 参数绑定」里覆盖。
        </p>
      ) : null}

      <div className="space-y-2">
        {params.map((p, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr_9rem_auto]">
            <Input
              value={p.name}
              placeholder="参数名"
              onChange={(e) => update(i, { name: e.target.value.trim() })}
            />
            <Input
              value={p.value}
              placeholder="默认取值"
              onChange={(e) => update(i, { value: e.target.value })}
            />
            <Input
              value={p.note ?? ""}
              placeholder="说明"
              onChange={(e) => update(i, { note: e.target.value })}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="删除参数"
              onClick={() => onChange(params.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...params, { name: "", value: "", note: "" }])}
        >
          <Plus className="mr-1 size-3.5" />
          添加参数
        </Button>
        {missing.length ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onChange([...params, ...missing.map((n) => ({ name: n, value: "", note: "" }))])
            }
          >
            <Variable className="mr-1 size-3.5" />
            补齐步骤里用到的 {missing.length} 个参数
          </Button>
        ) : null}
      </div>

      {missing.length ? (
        <p className="text-warning text-xs">
          步骤中用到但未定义默认值：{missing.join("、")}
        </p>
      ) : null}
    </div>
  );
}

/** 从文本里提取 ${参数名} / {{参数名}} */
export function extractParamNames(texts: string[]): string[] {
  const re = /\$\{\s*([A-Za-z0-9_\-.\u4e00-\u9fa5]+)\s*\}|\{\{\s*([A-Za-z0-9_\-.\u4e00-\u9fa5]+)\s*\}\}/g;
  const out = new Set<string>();
  for (const t of texts) for (const m of (t ?? "").matchAll(re)) out.add((m[1] ?? m[2] ?? "").trim());
  out.delete("");
  return [...out];
}
