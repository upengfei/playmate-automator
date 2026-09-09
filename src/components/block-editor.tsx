import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  KEYWORDS,
  getKeyword,
  stepDepths,
  type CaseStep,
  type KeywordCategory,
} from "@/lib/keywords";
import { cn } from "@/lib/utils";

let blockSeq = 0;

export function newStep(keyword: CaseStep["keyword"]): CaseStep {
  const kw = getKeyword(keyword);
  return {
    id: `bs-${++blockSeq}-${keyword}`,
    keyword,
    target: kw.needsTarget ? "" : "",
    value: kw.needsValue ? "" : "",
  };
}

const CATEGORIES: KeywordCategory[] = ["导航", "交互", "等待", "断言", "逻辑", "其他"];

/** 关键字积木面板：点击积木即追加为一个步骤 */
export function KeywordPalette({ onPick }: { onPick: (id: CaseStep["keyword"]) => void }) {
  return (
    <div className="space-y-4">
      {CATEGORIES.map((cat) => {
        const items = KEYWORDS.filter((k) => k.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat}>
            <div className="text-muted-foreground mb-2 text-xs font-medium">{cat}</div>
            <div className="flex flex-wrap gap-2">
              {items.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => onPick(k.id)}
                  className="hover:border-primary hover:text-primary group flex items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-xs transition-colors"
                  style={{ borderLeft: `3px solid var(--${k.color})` }}
                >
                  <Plus className="size-3 opacity-50 group-hover:opacity-100" />
                  {k.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 积木式步骤编排列表 */
export function StepBlocks({
  steps,
  onChange,
  activeIndex,
  stepStatus,
  readOnly,
}: {
  steps: CaseStep[];
  onChange?: ((steps: CaseStep[]) => void) | undefined;
  activeIndex?: number | undefined;
  stepStatus?: ((i: number) => "pending" | "running" | "passed" | "failed") | undefined;
  readOnly?: boolean | undefined;
}) {
  const update = (i: number, patch: Partial<CaseStep>) =>
    onChange?.(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
    onChange?.(next);
  };

  if (steps.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
        还没有步骤，从左侧关键字积木中点击添加
      </div>
    );
  }

  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const kw = getKeyword(s.keyword);
        const st = stepStatus?.(i);
        return (
          <li
            key={s.id}
            className={cn(
              "bg-card flex flex-wrap items-center gap-2 rounded-lg border p-2.5 transition-colors",
              activeIndex === i && "border-primary bg-primary-soft/50",
              st === "passed" && "border-success/40",
              st === "failed" && "border-destructive/60 bg-destructive/5",
            )}
            style={{ borderLeft: `3px solid var(--${kw.color})` }}
          >
            <GripVertical className="text-muted-foreground size-4 shrink-0" />
            <span className="text-muted-foreground w-6 shrink-0 text-center text-xs tabular-nums">
              {i + 1}
            </span>
            <span className="bg-secondary shrink-0 rounded-md px-2 py-1 text-xs font-medium">
              {kw.label}
            </span>
            {kw.needsTarget && (
              <Input
                value={s.target}
                readOnly={readOnly}
                onChange={(e) => update(i, { target: e.target.value })}
                placeholder={kw.targetLabel}
                className="h-8 min-w-40 flex-1 font-mono text-xs"
              />
            )}
            {kw.needsValue && (
              <Input
                value={s.value}
                readOnly={readOnly}
                onChange={(e) => update(i, { value: e.target.value })}
                placeholder={kw.valueLabel}
                className="h-8 min-w-32 flex-1 text-xs"
              />
            )}
            {st === "failed" && (
              <span className="text-destructive text-xs whitespace-nowrap">执行失败</span>
            )}
            {st === "passed" && (
              <span className="text-success text-xs whitespace-nowrap">已通过</span>
            )}
            {st === "running" && (
              <span className="text-primary animate-pulse text-xs whitespace-nowrap">执行中</span>
            )}
            {!readOnly && (
              <div className="ml-auto flex shrink-0">
                <Button size="icon" variant="ghost" aria-label="上移" onClick={() => move(i, -1)}>
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button size="icon" variant="ghost" aria-label="下移" onClick={() => move(i, 1)}>
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="删除步骤"
                  onClick={() => onChange?.(steps.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
