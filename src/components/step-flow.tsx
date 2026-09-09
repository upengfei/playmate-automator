import { useEffect, useMemo, useState } from "react";
import { ArrowDown, CircleCheck, CircleDashed, CircleX, Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { describeStep, getKeyword, type CaseStep } from "@/lib/keywords";
import { fetchCaseRuns } from "@/lib/platform.functions";
import { cn } from "@/lib/utils";

type StepStatus = "passed" | "failed" | "running" | "pending";

interface RunItem {
  id: string;
  agentId: string;
  status: string;
  durationMs: number;
  error: string;
  startedAt: string;
  steps: { index: number; keyword?: string; status?: string; durationMs?: number; error?: string }[];
}
interface LogItem {
  id: string;
  runId: string;
  level: string;
  message: string;
  at: string;
}

const STEP_RE = /步骤\s*(\d+)/;

function timeOf(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const ICONS: Record<StepStatus, typeof CircleCheck> = {
  passed: CircleCheck,
  failed: CircleX,
  running: Loader2,
  pending: CircleDashed,
};

const TONES: Record<StepStatus, string> = {
  passed: "border-success/50 bg-success/5 text-success",
  failed: "border-destructive/60 bg-destructive/5 text-destructive",
  running: "border-primary/60 bg-primary-soft/40 text-primary",
  pending: "text-muted-foreground border-dashed",
};

/** 用例步骤图形化流程图 + 点击步骤查看对应真实执行日志 */
export function StepFlow({ caseId, steps }: { caseId: string; steps: CaseStep[] }) {
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [runId, setRunId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  const load = () => {
    if (!/^[0-9a-f-]{36}$/i.test(caseId)) return;
    setLoading(true);
    fetchCaseRuns({ data: { caseId } })
      .then((res) => {
        setRuns(res.runs as RunItem[]);
        setLogs(res.logs as LogItem[]);
        setRunId((prev) => prev || (res.runs[0]?.id ?? ""));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(load, [caseId]);

  const run = runs.find((r) => r.id === runId);

  const statusOf = (i: number): StepStatus => {
    if (!run) return "pending";
    const s = run.steps.find((x) => Number(x.index) === i);
    if (s?.status === "passed") return "passed";
    if (s?.status === "failed") return "failed";
    if (run.status === "执行中" && run.steps.length === i) return "running";
    return "pending";
  };

  const logsByStep = useMemo(() => {
    const map = new Map<number, LogItem[]>();
    const general: LogItem[] = [];
    for (const l of logs.filter((l) => l.runId === runId)) {
      const m = l.message.match(STEP_RE);
      if (m) {
        const idx = Number(m[1]) - 1;
        const list = map.get(idx) ?? [];
        list.push(l);
        map.set(idx, list);
      } else {
        general.push(l);
      }
    }
    return { map, general };
  }, [logs, runId]);

  const activeStep = active === null ? undefined : steps[active];
  const activeResult =
    active === null ? undefined : run?.steps.find((x) => Number(x.index) === active);
  const activeLogs = active === null ? logsByStep.general : (logsByStep.map.get(active) ?? []);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={runId} onValueChange={setRunId}>
            <SelectTrigger className="h-9 w-64">
              <SelectValue placeholder={runs.length ? "选择执行记录" : "暂无执行记录"} />
            </SelectTrigger>
            <SelectContent>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {timeOf(r.startedAt)} · {r.status} · {r.agentId || "未知节点"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className={cn("mr-1 size-3.5", loading && "animate-spin")} />
            刷新
          </Button>
          <button
            type="button"
            onClick={() => setActive(null)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs",
              active === null ? "border-primary text-primary" : "text-muted-foreground",
            )}
          >
            整体日志
          </button>
        </div>

        {steps.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
            还没有步骤，添加步骤后即可看到流程图
          </div>
        ) : (
          <ol className="space-y-0">
            {steps.map((s, i) => {
              const st = statusOf(i);
              const Icon = ICONS[st];
              const kw = getKeyword(s.keyword);
              const stepLogs = logsByStep.map.get(i) ?? [];
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setActive(i)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      TONES[st],
                      active === i && "ring-primary/50 ring-2",
                    )}
                    style={{ borderLeft: `4px solid var(--${kw.color})` }}
                  >
                    <Icon className={cn("size-4 shrink-0", st === "running" && "animate-spin")} />
                    <span className="text-muted-foreground w-5 shrink-0 text-xs tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                      {describeStep(s)}
                    </span>
                    {typeof activeResultDuration(run, i) === "number" && (
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {activeResultDuration(run, i)}ms
                      </span>
                    )}
                    {stepLogs.length > 0 && (
                      <span className="bg-secondary shrink-0 rounded-full px-2 py-0.5 text-[11px]">
                        {stepLogs.length} 条日志
                      </span>
                    )}
                  </button>
                  {i < steps.length - 1 && (
                    <div className="flex justify-center py-1">
                      <ArrowDown className="text-muted-foreground/60 size-3.5" />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="bg-muted/40 rounded-xl border p-3">
        <div className="mb-2 text-sm font-medium">
          {active === null ? "整体执行日志" : `步骤 ${active + 1} 日志`}
        </div>
        {activeStep && (
          <div className="text-muted-foreground mb-2 text-xs break-all">
            {describeStep(activeStep)}
          </div>
        )}
        {activeResult?.error && (
          <div className="text-destructive bg-destructive/5 mb-2 rounded-md p-2 text-xs break-all">
            失败原因：{activeResult.error}
          </div>
        )}
        {!run && (
          <div className="text-muted-foreground text-xs">
            该用例还没有真实执行记录，下发任务执行后即可在此查看每一步日志。
          </div>
        )}
        <div className="max-h-[26rem] space-y-1.5 overflow-auto font-mono text-[11px] leading-relaxed">
          {activeLogs.map((l) => (
            <div key={l.id} className="flex gap-2">
              <span className="text-muted-foreground shrink-0">{timeOf(l.at).slice(6)}</span>
              <span
                className={cn(
                  "break-all",
                  l.level === "error" && "text-destructive",
                  l.level === "success" && "text-success",
                )}
              >
                {l.message}
              </span>
            </div>
          ))}
          {run && activeLogs.length === 0 && (
            <div className="text-muted-foreground">这一步没有产生日志</div>
          )}
        </div>
      </div>
    </div>
  );
}

function activeResultDuration(run: RunItem | undefined, i: number): number | undefined {
  const s = run?.steps.find((x) => Number(x.index) === i);
  return typeof s?.durationMs === "number" ? s.durationMs : undefined;
}
