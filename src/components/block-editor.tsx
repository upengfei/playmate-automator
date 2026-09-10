import { Fragment, useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  KEYWORDS,
  getKeyword,
  stepDepths,
  type CaseStep,
  type KeywordCategory,
  type KeywordId,
} from "@/lib/keywords";
import { cn } from "@/lib/utils";

const CUSTOM = "__custom__";

/** 关键字取值下拉：提供常用候选，选「自定义」后可手填任意内容 */
function ValueSelect({
  value,
  options,
  label,
  readOnly,
  onChange,
}: {
  value: string;
  options: string[];
  label: string;
  readOnly?: boolean | undefined;
  onChange: (v: string) => void;
}) {
  const known = value === "" || options.includes(value);
  const [custom, setCustom] = useState(!known);
  const showCustom = custom || !known;

  return (
    <div className="flex min-w-40 flex-1 items-center gap-2">
      <Select
        disabled={readOnly === true}
        value={showCustom ? CUSTOM : value}
        onValueChange={(v) => {
          if (v === CUSTOM) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(v);
        }}
      >
        <SelectTrigger className="h-8 flex-1 text-xs">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="text-xs">
              {o}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM} className="text-xs">
            自定义…
          </SelectItem>
        </SelectContent>
      </Select>
      {showCustom && (
        <Input
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`自定义${label}`}
          className="h-8 min-w-28 flex-1 font-mono text-xs"
        />
      )}
    </div>
  );
}


let blockSeq = 0;

export function newStep(keyword: CaseStep["keyword"]): CaseStep {
  const kw = getKeyword(keyword);
  return {
    id: `bs-${++blockSeq}-${keyword}-${Date.now().toString(36)}`,
    keyword,
    target: "",
    value: kw.valueOptions?.[0] ?? "",

  };
}

const CATEGORIES: KeywordCategory[] = ["导航", "交互", "等待", "断言", "逻辑", "其他"];

const KEYWORD_MIME = "application/x-playflow-keyword";
const STEP_MIME = "application/x-playflow-step";

/** 关键字积木面板：点击或拖到右侧步骤区即可添加步骤 */
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
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(KEYWORD_MIME, k.id);
                    e.dataTransfer.setData("text/plain", k.label);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => onPick(k.id)}
                  className="hover:border-primary hover:text-primary group flex cursor-grab items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-xs transition-colors active:cursor-grabbing"
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

/** 积木式步骤编排列表：支持拖拽排序、拖入新积木、删除步骤 */
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
  const [dropAt, setDropAt] = useState<number | null>(null);

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

  /** 把某个步骤移动到目标插入位（插入位以移动前的下标计） */
  const reorder = (from: number, to: number) => {
    const next = [...steps];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(from < to ? to - 1 : to, 0, item);
    onChange?.(next);
  };

  const onDrop = (e: DragEvent, at: number) => {
    e.preventDefault();
    setDropAt(null);
    if (readOnly) return;
    const kw = e.dataTransfer.getData(KEYWORD_MIME);
    if (kw) {
      const next = [...steps];
      next.splice(at, 0, newStep(kw as KeywordId));
      onChange?.(next);
      return;
    }
    const raw = e.dataTransfer.getData(STEP_MIME);
    if (raw !== "") reorder(Number(raw), at);
  };

  const dragOver = (e: DragEvent, at: number) => {
    if (readOnly) return;
    e.preventDefault();
    setDropAt(at);
  };

  const Indicator = ({ at }: { at: number }) =>
    dropAt === at ? <li className="bg-primary my-1 h-1 rounded-full" aria-hidden /> : null;

  if (steps.length === 0) {
    return (
      <div
        onDragOver={(e) => dragOver(e, 0)}
        onDrop={(e) => onDrop(e, 0)}
        className={cn(
          "text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm transition-colors",
          dropAt === 0 && "border-primary text-primary",
        )}
      >
        还没有步骤，从左侧点击或把关键字积木拖到这里
      </div>
    );
  }

  const depths = stepDepths(steps);

  return (
    <ol className="space-y-2" onDragLeave={() => setDropAt(null)}>
      {steps.map((s, i) => {
        const kw = getKeyword(s.keyword);
        const st = stepStatus?.(i);
        const depth = depths[i] ?? 0;
        return (
          <Fragment key={s.id}>
            <Indicator at={i} />
            <li
              draggable={!readOnly}
              onDragStart={(e) => {
                e.dataTransfer.setData(STEP_MIME, String(i));
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                dragOver(e, e.clientY - box.top > box.height / 2 ? i + 1 : i);
              }}
              onDrop={(e) => {
                const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                onDrop(e, e.clientY - box.top > box.height / 2 ? i + 1 : i);
              }}
              className={cn(
                "bg-card flex flex-wrap items-center gap-2 rounded-lg border p-2.5 transition-colors",
                activeIndex === i && "border-primary bg-primary-soft/50",
                st === "passed" && "border-success/40",
                st === "failed" && "border-destructive/60 bg-destructive/5",
                !readOnly && "cursor-grab active:cursor-grabbing",
              )}
              style={{
                borderLeft: `3px solid var(--${kw.color})`,
                marginLeft: depth * 20,
              }}
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
              {kw.needsValue &&
                (kw.valueOptions ? (
                  <ValueSelect
                    value={s.value}
                    options={kw.valueOptions}
                    label={kw.valueLabel}
                    readOnly={readOnly}
                    onChange={(v) => update(i, { value: v })}
                  />
                ) : (
                  <Input
                    value={s.value}
                    readOnly={readOnly}
                    onChange={(e) => update(i, { value: e.target.value })}
                    placeholder={kw.valueLabel}
                    className="h-8 min-w-32 flex-1 text-xs"
                  />
                ))}

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
          </Fragment>
        );
      })}
      <Indicator at={steps.length} />
      {!readOnly && (
        <li
          onDragOver={(e) => dragOver(e, steps.length)}
          onDrop={(e) => onDrop(e, steps.length)}
          className={cn(
            "text-muted-foreground rounded-lg border border-dashed px-3 py-3 text-center text-xs transition-colors",
            dropAt === steps.length && "border-primary text-primary",
          )}
        >
          拖到这里追加到末尾
        </li>
      )}
    </ol>
  );
}
