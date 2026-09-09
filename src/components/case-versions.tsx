import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchCaseVersions, rollbackCase, type CaseVersion } from "@/lib/platform.functions";
import { cn } from "@/lib/utils";

function when(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 用例版本历史：点任意版本可回滚，回滚后作为新版本继续记录 */
export function CaseVersions({
  caseId,
  onRolledBack,
}: {
  caseId: string;
  onRolledBack?: () => void;
}) {
  const [versions, setVersions] = useState<CaseVersion[]>([]);
  const [current, setCurrent] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchCaseVersions({ data: { caseId } });
    setVersions(res.versions);
    setCurrent(res.currentVersion);
    setSelected((s) => s ?? res.versions[0]?.version ?? null);
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = versions.find((v) => v.version === selected) ?? versions[0];

  const rollback = async (version: number) => {
    setBusy(true);
    try {
      const res = await rollbackCase({ data: { caseId, version } });
      toast.success(`已回滚到 v${version}，生成新版本 v${res.version}`);
      setSelected(res.version);
      await load();
      onRolledBack?.();
    } catch (e) {
      toast.error(`回滚失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!versions.length) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        暂无版本记录，保存一次用例后即会生成版本快照。
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <History className="size-3.5" />
            当前版本 v{current}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        <div className="max-h-72 space-y-1.5 overflow-auto pr-1">
          {versions.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelected(v.version)}
              className={cn(
                "w-full rounded-lg border p-2.5 text-left text-xs transition",
                v.version === active?.version
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/60 border-border",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">v{v.version}</span>
                {v.version === current && (
                  <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[10px]">
                    当前
                  </span>
                )}
              </div>
              <div className="text-muted-foreground mt-1">
                {v.note || "—"} · {v.steps.length} 步
              </div>
              <div className="text-muted-foreground mt-0.5">
                {when(v.createdAt)} · {v.author}
              </div>
            </button>
          ))}
        </div>
      </div>

      {active && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-medium">
                v{active.version} · {active.name}
              </span>
              <span className="text-muted-foreground ml-2 text-xs">
                {active.module} · {active.priority} · {active.source}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || active.version === current}
              onClick={() => void rollback(active.version)}
            >
              <RotateCcw className="mr-1 size-3.5" />
              {active.version === current ? "已是当前版本" : `回滚到 v${active.version}`}
            </Button>
          </div>
          <ol className="space-y-1 text-xs">
            {active.steps.map((s, i) => (
              <li key={s.id ?? i} className="bg-muted/50 flex gap-2 rounded px-2 py-1.5">
                <span className="text-muted-foreground w-6 shrink-0">{i + 1}</span>
                <span className="font-medium">{s.keyword}</span>
                <span className="text-muted-foreground truncate">
                  {s.target} {s.value}
                </span>
              </li>
            ))}
          </ol>
          {active.script && (
            <pre className="bg-muted max-h-56 overflow-auto rounded-lg p-3 text-[11px] leading-relaxed">
              <code>{active.script}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
