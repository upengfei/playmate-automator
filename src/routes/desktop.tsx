import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bug,
  Download,
  Circle,
  CloudUpload,
  Cog,
  ExternalLink,
  Layers,
  Minus,
  MonitorPlay,
  Play,
  Radio,
  RefreshCcw,
  Server,
  Square,
  StepForward,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { KeywordPalette, StepBlocks, newStep } from "@/components/block-editor";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatusChip } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generatePlaywrightCode, describeStep, type CaseStep } from "@/lib/keywords";
import { dispatchTask, pushUpgrade, uploadCaseFromAgent, useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/desktop")({
  head: () => ({
    meta: [
      { title: "PlayFlow Agent 桌面客户端" },
      {
        name: "description",
        content:
          "桌面 Agent 客户端：本地录制、积木式编写、执行调试 Playwright 用例，并一键上传到平台、接收平台下发任务。",
      },
      { property: "og:title", content: "PlayFlow Agent 桌面客户端" },
      {
        property: "og:description",
        content: "Electron 桌面工作流：录制、编写、执行、调试、上传，托盘菜单随时呼出。",
      },
    ],
  }),
  component: DesktopAgent,
});

type Tab = "record" | "compose" | "run" | "debug" | "upload" | "queue" | "update";

const TABS: { id: Tab; label: string; icon: typeof Video }[] = [
  { id: "record", label: "用例录制", icon: Video },
  { id: "compose", label: "积木编写", icon: Layers },
  { id: "run", label: "本地执行", icon: Play },
  { id: "debug", label: "断点调试", icon: Bug },
  { id: "upload", label: "上传平台", icon: CloudUpload },
  { id: "queue", label: "平台任务", icon: Server },
  { id: "update", label: "版本与更新", icon: RefreshCcw },
];

const RECORD_SCRIPT: CaseStep[] = [
  { id: "r1", keyword: "goto", target: "", value: "https://demo.shop.com/login" },
  { id: "r2", keyword: "fill", target: "#username", value: "qa_user" },
  { id: "r3", keyword: "fill", target: "#password", value: "Qa@123456" },
  { id: "r4", keyword: "click", target: "button[type=submit]" as string, value: "" },
  { id: "r5", keyword: "waitFor", target: ".dashboard-header", value: "" },
  { id: "r6", keyword: "expectText", target: ".user-name", value: "qa_user" },
];

function DesktopAgent() {
  const { agents, tasks, upgrades, release, settings } = useAppStore();
  const [nativeInfo, setNativeInfo] = useState<{ version: string; host: string } | null>(null);
  const [tab, setTab] = useState<Tab>("record");
  const [tray, setTray] = useState(false);
  const [agentId, setAgentId] = useState("AG-01");
  const agent = agents.find((a) => a.id === agentId) ?? agents[0]!;

  const [caseName, setCaseName] = useState("用户名密码登录成功（本地录制）");
  const [module, setModule] = useState("登录鉴权");
  const [url, setUrl] = useState("https://demo.shop.com/login");
  const [steps, setSteps] = useState<CaseStep[]>([]);
  const [recording, setRecording] = useState(false);
  const [logs, setLogs] = useState<{ id: number; text: string; tone: string }[]>([]);
  const [runIndex, setRunIndex] = useState(-1);
  const [runStatus, setRunStatus] = useState<Record<number, "passed" | "failed">>({});
  const [running, setRunning] = useState(false);
  const [breakpoints, setBreakpoints] = useState<number[]>([2]);
  const [paused, setPaused] = useState(false);
  const logSeq = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // 运行在真实 Electron 客户端时，通过预加载桥接调用真实浏览器与平台接口
  const nativeBridge = () =>
    (
      window as unknown as {
        playflowAgent?: {
          getInfo: () => Promise<{ version: string; host: string }>;
          onTrayAction: (cb: (d: { tab: Tab }) => void) => void;
          onLog?: (cb: (d: { level: string; text: string }) => void) => void;
          onRunEvent?: (cb: (d: Record<string, unknown>) => void) => void;
          startRecording?: (url: string) => Promise<unknown>;
          stopRecording?: () => Promise<{ script: string; steps: CaseStep[] }>;
          runCase?: (c: {
            name: string;
            steps: CaseStep[];
            headed?: boolean;
          }) => Promise<{ status: string; error?: string; steps: unknown[] }>;
          uploadCase?: (c: Record<string, unknown>) => Promise<{ id: string }>;
        };
      }
    ).playflowAgent;

  useEffect(() => {
    const bridge = nativeBridge();
    if (!bridge) return;
    void bridge.getInfo().then(setNativeInfo);
    bridge.onTrayAction((d) => setTab(d.tab));
    bridge.onLog?.((d) =>
      setLogs((l) => [
        ...l,
        { id: ++logSeq.current, text: d.text, tone: d.level === "error" ? "error" : d.level },
      ]),
    );
    bridge.onRunEvent?.((e) => {
      const idx = typeof e["index"] === "number" ? (e["index"] as number) : -1;
      if (e["type"] === "step-start") setRunIndex(idx);
      if (e["type"] === "step-end" && idx >= 0) {
        setRunStatus((m) => ({ ...m, [idx]: e["status"] === "passed" ? "passed" : "failed" }));
      }
    });
  }, []);

  const addLog = (text: string, tone = "info") =>
    setLogs((l) => [...l, { id: ++logSeq.current, text, tone }]);

  const after = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };

  /* ------------------------------ 录制 ------------------------------ */
  const startRecording = async () => {
    const bridge = nativeBridge();
    if (bridge?.startRecording) {
      setRecording(true);
      setSteps([]);
      setRunStatus({});
      setTab("record");
      try {
        await bridge.startRecording(url);
        addLog("已打开真实浏览器录制窗口，操作完成后点击「结束录制」生成步骤", "info");
      } catch (err) {
        setRecording(false);
        addLog(`录制启动失败：${String(err)}`, "error");
      }
      return;
    }
    setRecording(true);
    setSteps([]);
    setRunStatus({});
    setTab("record");
    addLog(`启动 Chromium 录制会话，打开 ${url}`, "info");
    RECORD_SCRIPT.forEach((s, i) => {
      after(700 * (i + 1), () => {
        const step = i === 0 ? { ...s, value: url } : s;
        setSteps((prev) => [...prev, { ...step, id: `rec-${i}-${Date.now()}` }]);
        addLog(`捕获操作：${describeStep(step)}`, "info");
        if (i === RECORD_SCRIPT.length - 1) {
          setRecording(false);
          addLog("录制结束，共捕获 6 个操作，可切换到积木编写继续调整", "success");
        }
      });
    });
  };

  /** 结束真实录制：解析 codegen 脚本为积木步骤 */
  const finishRecording = async () => {
    const bridge = nativeBridge();
    if (!bridge?.stopRecording) return false;
    const res = await bridge.stopRecording();
    setRecording(false);
    setSteps(res.steps ?? []);
    addLog(`录制结束，已解析 ${(res.steps ?? []).length} 个真实操作`, "success");
    return true;
  };

  /* --------------------------- 执行 / 调试 --------------------------- */
  const runLocal = async (debug = false) => {
    if (steps.length === 0) {
      toast.error("请先录制或编写用例步骤");
      return;
    }
    setTab(debug ? "debug" : "run");
    setRunning(true);
    setPaused(false);
    setRunStatus({});
    setRunIndex(-1);

    const bridge = nativeBridge();
    if (bridge?.runCase) {
      addLog(
        debug ? "以真实浏览器（可见窗口）执行用例" : "以真实浏览器（无头模式）执行用例",
        "info",
      );
      try {
        const res = await bridge.runCase({ name: caseName, steps, headed: debug });
        addLog(
          res.status === "passed" ? "真实执行完成：全部步骤通过" : `真实执行失败：${res.error}`,
          res.status === "passed" ? "success" : "error",
        );
      } catch (err) {
        addLog(`执行失败：${String(err)}`, "error");
      } finally {
        setRunning(false);
        setRunIndex(-1);
      }
      return;
    }

    addLog(debug ? "以调试模式启动（headed + inspector）" : "以无头模式启动本地执行", "info");
    let delay = 500;
    steps.forEach((s, i) => {
      delay += 650;
      after(delay, () => {
        if (debug && breakpoints.includes(i)) {
          setPaused(true);
          setRunIndex(i);
          addLog(`⏸ 命中断点，暂停在步骤 ${i + 1}：${describeStep(s)}`, "warn");
          return;
        }
        setRunIndex(i);
        setRunStatus((m) => ({ ...m, [i]: "passed" }));
        addLog(`✓ [${i + 1}/${steps.length}] ${describeStep(s)}`, "success");
        if (i === steps.length - 1) {
          setRunning(false);
          setRunIndex(-1);
          addLog("本地执行完成：全部步骤通过，可上传到平台", "success");
        }
      });
    });
  };

  const stepOver = () => {
    const i = runIndex;
    setPaused(false);
    setRunStatus((m) => ({ ...m, [i]: "passed" }));
    addLog(`▶ 单步执行通过：步骤 ${i + 1}`, "info");
    const rest = steps.slice(i + 1);
    let delay = 0;
    rest.forEach((s, k) => {
      const idx = i + 1 + k;
      delay += 650;
      after(delay, () => {
        setRunIndex(idx);
        setRunStatus((m) => ({ ...m, [idx]: "passed" }));
        addLog(`✓ [${idx + 1}/${steps.length}] ${describeStep(s)}`, "success");
        if (idx === steps.length - 1) {
          setRunning(false);
          setRunIndex(-1);
          addLog("调试结束：全部步骤通过", "success");
        }
      });
    });
  };

  const stopRun = async () => {
    if (recording && (await finishRecording())) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setRunning(false);
    setRecording(false);
    setPaused(false);
    setRunIndex(-1);
    addLog("已手动停止", "warn");
  };

  /* ------------------------------ 上传 ------------------------------ */
  const upload = async () => {
    if (steps.length === 0) {
      toast.error("没有可上传的步骤");
      return;
    }
    const bridge = nativeBridge();
    if (bridge?.uploadCase) {
      try {
        const res = await bridge.uploadCase({
          name: caseName,
          module,
          startUrl: url,
          priority: "P1",
          steps,
          script: generatePlaywrightCode(caseName, steps),
          source: "Agent 录制",
        });
        addLog(`上传成功：平台已生成用例 ${res.id}`, "success");
        toast.success("已上传到平台，可在「真实节点与用例」中查看并下发执行");
        setTab("upload");
        return;
      } catch (err) {
        addLog(`上传失败：${String(err)}`, "error");
        toast.error("上传平台失败，请检查平台地址与节点注册状态");
        return;
      }
    }
    const created = uploadCaseFromAgent({ name: caseName, module, steps, agentName: agent.name });
    addLog(`上传成功：平台已生成用例 ${created.id}`, "success");
    toast.success(`已上传到平台，用例编号 ${created.id}`);
    setTab("upload");
  };

  const myTasks = tasks.filter((t) => t.agentId === agent.id);

  return (
    <div className="bg-muted/60 flex min-h-screen items-center justify-center p-2 sm:p-6">
      <div className="md-elevation-3 bg-card flex h-[85vh] max-h-[860px] w-full max-w-6xl flex-col overflow-hidden rounded-xl border">
        {/* 窗口标题栏 */}
        <div className="bg-secondary flex h-10 shrink-0 items-center gap-3 border-b px-3">
          <div className="flex gap-1.5">
            <span className="bg-destructive size-3 rounded-full" />
            <span className="bg-warning size-3 rounded-full" />
            <span className="bg-success size-3 rounded-full" />
          </div>
          <span className="text-xs font-medium">PlayFlow Agent — {agent.name}</span>
          <span className="text-muted-foreground ml-auto text-[11px]">v{agent.version}</span>
          <div className="text-muted-foreground flex items-center gap-2">
            <Minus className="size-3.5" />
            <Square className="size-3" />
            <X className="size-3.5" />
          </div>
        </div>

        {/* 菜单栏 */}
        <div className="text-muted-foreground flex h-9 shrink-0 items-center gap-4 border-b px-3 text-xs">
          {["文件", "录制", "执行", "调试", "帮助"].map((m) => (
            <span key={m} className="hover:text-foreground cursor-default">
              {m}
            </span>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <StatusChip status={agent.status} />
            <ThemeToggle className="size-7" />
            <Link
              to="/"
              className="hover:text-foreground flex items-center gap-1 text-[11px]"
              title="返回平台端"
            >
              <ExternalLink className="size-3.5" />
              平台端
            </Link>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 侧边导航 */}
          <nav className="bg-sidebar w-40 shrink-0 space-y-1 border-r p-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors",
                  tab === t.id
                    ? "bg-primary-soft text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                <t.icon className="size-4" />
                {t.label}
                {t.id === "queue" && myTasks.length > 0 && (
                  <span className="bg-primary text-primary-foreground ml-auto rounded-full px-1.5 text-[10px]">
                    {myTasks.length}
                  </span>
                )}
              </button>
            ))}
            <div className="pt-3">
              <Label className="text-muted-foreground px-1 text-[11px]">当前设备</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </nav>

          {/* 主体 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tab === "record" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-64 flex-1 space-y-1.5">
                      <Label className="text-xs">起始地址</Label>
                      <Input value={url} onChange={(e) => setUrl(e.target.value)} className="h-9" />
                    </div>
                    <Button onClick={startRecording} disabled={recording}>
                      <Circle className="mr-1 size-3.5 fill-current" />
                      {recording ? "录制中…" : "开始录制"}
                    </Button>
                    <Button variant="outline" onClick={stopRun} disabled={!recording}>
                      <Square className="mr-1 size-3.5" />
                      停止
                    </Button>
                  </div>
                  <div className="bg-muted/50 grid place-items-center rounded-lg border border-dashed p-6">
                    <div className="text-center">
                      <MonitorPlay
                        className={cn(
                          "text-muted-foreground mx-auto size-10",
                          recording && "text-destructive animate-pulse",
                        )}
                      />
                      <p className="mt-2 text-sm font-medium">
                        {recording ? "正在录制浏览器操作…" : "浏览器录制窗口"}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        录制期间在真实浏览器中操作，Agent 会自动生成关键字步骤
                      </p>
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-semibold">
                      已捕获步骤（{steps.length}）
                    </h3>
                    <StepBlocks steps={steps} readOnly />
                  </div>
                </div>
              )}

              {tab === "compose" && (
                <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
                  <div className="rounded-lg border p-3">
                    <h3 className="mb-3 text-xs font-semibold">关键字积木</h3>
                    <KeywordPalette onPick={(id) => setSteps((s) => [...s, newStep(id)])} />
                  </div>
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">用例名称</Label>
                        <Input
                          className="h-9"
                          value={caseName}
                          onChange={(e) => setCaseName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">所属模块</Label>
                        <Input
                          className="h-9"
                          value={module}
                          onChange={(e) => setModule(e.target.value)}
                        />
                      </div>
                    </div>
                    <StepBlocks steps={steps} onChange={setSteps} />
                    <div>
                      <h3 className="mb-2 text-xs font-semibold">生成脚本</h3>
                      <pre className="bg-muted max-h-56 overflow-auto rounded-lg p-3 text-[11px]">
                        <code>{generatePlaywrightCode(caseName, steps)}</code>
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {(tab === "run" || tab === "debug") && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {tab === "run" ? (
                      <Button onClick={() => runLocal(false)} disabled={running}>
                        <Play className="mr-1 size-3.5" />
                        本地执行
                      </Button>
                    ) : (
                      <Button onClick={() => runLocal(true)} disabled={running}>
                        <Bug className="mr-1 size-3.5" />
                        启动调试
                      </Button>
                    )}
                    {paused && (
                      <Button variant="outline" onClick={stepOver}>
                        <StepForward className="mr-1 size-3.5" />
                        继续 / 单步
                      </Button>
                    )}
                    <Button variant="outline" onClick={stopRun} disabled={!running}>
                      <Square className="mr-1 size-3.5" />
                      停止
                    </Button>
                    <span className="text-muted-foreground text-xs">
                      {tab === "debug"
                        ? `断点：${breakpoints.map((b) => `第 ${b + 1} 步`).join("、") || "无"}`
                        : "执行结果仅保存在本地，通过后可上传平台"}
                    </span>
                  </div>

                  {tab === "debug" && (
                    <div className="flex flex-wrap gap-2">
                      {steps.map((s, i) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            setBreakpoints((b) =>
                              b.includes(i) ? b.filter((x) => x !== i) : [...b, i],
                            )
                          }
                          className={cn(
                            "rounded-md border px-2 py-1 text-[11px]",
                            breakpoints.includes(i)
                              ? "border-destructive text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          ● 第 {i + 1} 步
                        </button>
                      ))}
                    </div>
                  )}

                  <StepBlocks
                    steps={steps}
                    readOnly
                    activeIndex={runIndex >= 0 ? runIndex : undefined}
                    stepStatus={(i) =>
                      runStatus[i] ?? (runIndex === i ? (paused ? "pending" : "running") : "pending")
                    }
                  />
                </div>
              )}

              {tab === "upload" && (
                <div className="space-y-4">
                  <div className="rounded-lg border p-4">
                    <h3 className="text-sm font-semibold">上传到平台</h3>
                    <p className="text-muted-foreground mt-1 text-xs">
                      本地校验通过后上传，平台会生成新的用例编号并标记来源为「Agent 录制」。
                    </p>
                    <dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs">
                      <dt className="text-muted-foreground">用例名称</dt>
                      <dd>{caseName}</dd>
                      <dt className="text-muted-foreground">所属模块</dt>
                      <dd>{module}</dd>
                      <dt className="text-muted-foreground">步骤数</dt>
                      <dd>{steps.length}</dd>
                      <dt className="text-muted-foreground">上传设备</dt>
                      <dd>
                        {agent.name} · v{agent.version}
                      </dd>
                    </dl>
                    <div className="mt-4 flex gap-2">
                      <Button onClick={upload}>
                        <CloudUpload className="mr-1 size-4" />
                        上传到平台
                      </Button>
                      <Button variant="outline" asChild>
                        <Link to="/cases">在平台查看用例库</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {tab === "queue" && (
                <div className="space-y-3">
                  <p className="text-muted-foreground text-xs">
                    平台下发到本设备的任务；接收后本地执行并实时回传进度与日志。
                  </p>
                  {myTasks.map((t) => {
                    const done = t.caseRuns.filter(
                      (r) => r.status !== "等待中" && r.status !== "运行中",
                    ).length;
                    return (
                      <div key={t.id} className="rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{t.name}</span>
                          <StatusChip status={t.status} />
                          <span className="text-muted-foreground ml-auto text-xs">
                            {done}/{t.caseRuns.length}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {t.id} · {t.env} · {t.browser} · {t.stage}
                        </p>
                        <div className="mt-2 flex gap-2">
                          {t.status === "排队中" && (
                            <Button
                              size="sm"
                              onClick={() => {
                                dispatchTask(t.id);
                                addLog(`接收平台任务 ${t.id}，开始本地执行`, "info");
                                toast.success("已接收任务并开始执行");
                              }}
                            >
                              接收并执行
                            </Button>
                          )}
                          <Button size="sm" variant="outline" asChild>
                            <Link to="/tasks/$taskId" params={{ taskId: t.id }}>
                              平台端查看进度
                            </Link>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {myTasks.length === 0 && (
                    <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-8 text-center text-xs">
                      暂无下发任务
                    </p>
                  )}
                </div>
              )}

              {tab === "update" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                    <div className="min-w-48 flex-1">
                      <p className="text-sm font-medium">
                        本机版本 v{nativeInfo?.version ?? agent.version}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {nativeInfo
                          ? `Electron 客户端 · ${nativeInfo.host}`
                          : "浏览器预览模式（安装客户端后此处显示本机真实版本）"}{" "}
                        · 平台最新 v{release.version}（{settings.updateChannel}）
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        const bridge = (
                          window as unknown as { playflowAgent?: { checkForUpdates: () => void } }
                        ).playflowAgent;
                        if (bridge) bridge.checkForUpdates();
                        pushUpgrade(agent.id);
                        addLog("向平台拉取版本清单，开始下载升级包…", "info");
                        toast.info("正在检查更新");
                      }}
                    >
                      <RefreshCcw className="mr-1 size-3.5" />
                      检查更新
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/download">
                        <Download className="mr-1 size-3.5" />
                        安装包下载页
                      </Link>
                    </Button>
                  </div>

                  <div>
                    <p className="mb-1.5 text-xs font-medium">更新说明 v{release.version}</p>
                    <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-xs">
                      {release.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="mb-1.5 text-xs font-medium">升级记录（含回传结果）</p>
                    <div className="space-y-2">
                      {upgrades
                        .filter((j) => j.agentId === agent.id)
                        .map((j) => (
                          <div key={j.id} className="rounded-lg border p-2.5 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-mono">
                                v{j.fromVersion} → v{j.toVersion}
                              </span>
                              <span className="text-muted-foreground">{j.stage}</span>
                              <span
                                className={cn(
                                  "ml-auto font-medium",
                                  j.status === "成功" && "text-success",
                                  j.status === "失败" && "text-destructive",
                                  j.status === "进行中" && "text-primary",
                                )}
                              >
                                {j.status} {j.progress}%
                              </span>
                            </div>
                            {j.report && (
                              <p className="text-muted-foreground mt-1">
                                已回传平台：{j.report.message}
                              </p>
                            )}
                          </div>
                        ))}
                      {upgrades.filter((j) => j.agentId === agent.id).length === 0 && (
                        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center">
                          暂无升级记录
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 本地日志 */}
            <div className="h-40 shrink-0 border-t">
              <div className="text-muted-foreground flex h-8 items-center justify-between border-b px-3 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <Radio className="size-3.5" />
                  本地控制台
                </span>
                <button type="button" onClick={() => setLogs([])} className="hover:text-foreground">
                  清空
                </button>
              </div>
              <div className="bg-muted/40 h-32 overflow-y-auto p-2 font-mono text-[11px]">
                {logs.map((l) => (
                  <div
                    key={l.id}
                    className={cn(
                      l.tone === "success" && "text-success",
                      l.tone === "warn" && "text-warning",
                      l.tone === "error" && "text-destructive",
                      l.tone === "info" && "text-muted-foreground",
                    )}
                  >
                    {l.text}
                  </div>
                ))}
                {logs.length === 0 && (
                  <div className="text-muted-foreground">等待操作…</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 系统托盘 */}
        <div className="bg-secondary relative flex h-9 shrink-0 items-center justify-end gap-3 border-t px-3 text-[11px]">
          <span className="text-muted-foreground mr-auto">
            {agent.host} · CPU {agent.cpu}% · 内存 {agent.memory}% · 心跳 {agent.lastHeartbeat}
          </span>
          {tray && (
            <div className="md-elevation-3 bg-popover absolute right-3 bottom-10 w-48 overflow-hidden rounded-lg border py-1 text-xs">
              <div className="text-muted-foreground px-3 py-1.5 text-[10px]">PlayFlow Agent 托盘</div>
              {[
                { label: "开始录制用例", icon: Video, run: startRecording },
                { label: "执行当前用例", icon: Play, run: () => runLocal(false) },
                { label: "调试当前用例", icon: Bug, run: () => runLocal(true) },
                { label: "上传到平台", icon: CloudUpload, run: upload },
                { label: "打开平台任务", icon: Server, run: () => setTab("queue") },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left"
                  onClick={() => {
                    setTray(false);
                    item.run();
                  }}
                >
                  <item.icon className="size-3.5" />
                  {item.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setTray((v) => !v)}
            className="hover:bg-accent flex items-center gap-1.5 rounded-md px-2 py-1"
            title="托盘菜单"
          >
            <Cog className="size-3.5" />
            托盘菜单
          </button>
        </div>
      </div>
    </div>
  );
}
