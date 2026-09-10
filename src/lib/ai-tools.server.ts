/**
 * AI 助手可调用的服务端工具（仅服务端）。
 *
 * - 生成用例：只产出结构化步骤 + 脚本，交给前端预览，AI 不直接写数据库
 * - 分析数据：只读本地 SQLite 的执行记录、任务与日志
 * - 页面元素定位：向在线 Agent 下发一次抓取指令，等待客户端回传元素清单
 */
import { tool } from "ai";
import { z } from "zod";
import { KEYWORDS, generatePlaywrightCode, type CaseStep } from "@/lib/keywords";

const KEYWORD_IDS = KEYWORDS.filter((k) => k.id !== "unsupported").map((k) => k.id);

export const KEYWORD_REFERENCE = KEYWORDS.map(
  (k) =>
    `${k.id}（${k.label}｜${k.category}${k.needsTarget ? `｜target=${k.targetLabel}` : ""}${
      k.needsValue ? `｜value=${k.valueLabel}` : ""
    }${k.opensBlock ? "｜开启代码块" : ""}${k.closesBlock ? "｜结束代码块" : ""}）`,
).join("\n");

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function buildAiTools() {
  return {
    generate_case_steps: tool({
      description:
        "根据用户的中文需求生成一条 Playwright 用例的关键字步骤。只能使用给定关键字，条件/循环必须成对闭合。生成结果会展示给用户预览，用户确认后才保存。",
      inputSchema: z.object({
        name: z.string().describe("用例名称"),
        module: z.string().nullable().describe("所属模块，未知填 null"),
        startUrl: z.string().nullable().describe("起始地址，未知填 null"),
        note: z.string().nullable().describe("生成说明或风险提示"),
        steps: z
          .array(
            z.object({
              keyword: z.string().describe("关键字 id"),
              target: z.string().nullable().describe("定位器，不需要时填 null"),
              value: z.string().nullable().describe("取值，不需要时填 null"),
            }),
          )
          .describe("按执行顺序排列的步骤"),
      }),
      execute: async (input) => {
        const invalid = input.steps.filter((s) => !KEYWORD_IDS.includes(s.keyword as never));
        const steps: CaseStep[] = input.steps
          .filter((s) => KEYWORD_IDS.includes(s.keyword as never))
          .map((s, i) => ({
            id: `ai-${Date.now()}-${i}`,
            keyword: s.keyword as CaseStep["keyword"],
            target: s.target ?? "",
            value: s.value ?? "",
          }));
        const name = input.name || "AI 生成用例";
        return {
          name,
          module: input.module || "AI 生成",
          startUrl: input.startUrl || "",
          note: input.note || "",
          steps,
          script: generatePlaywrightCode(name, steps),
          rejected: invalid.map((s) => s.keyword),
        };
      },
    }),

    query_case_stats: tool({
      description: "按用例统计执行次数、通过率、平均耗时与最近状态，用于分析质量与不稳定用例。",
      inputSchema: z.object({ limit: z.number().nullable().describe("返回条数，默认 20") }),
      execute: async (input) => {
        const { localClient } = await import("@/lib/local-db.server");
        const { data } = await localClient()
          .from("case_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(3000);
        const rows = (data ?? []) as Record<string, any>[];
        const map = new Map<string, any>();
        for (const r of rows) {
          const key = (r["case_id"] as string) || (r["case_name"] as string) || "未知用例";
          const s =
            map.get(key) ??
            map
              .set(key, {
                caseId: r["case_id"] ?? null,
                caseName: r["case_name"] ?? key,
                total: 0,
                passed: 0,
                failed: 0,
                durations: [] as number[],
                lastStatus: r["status"],
                lastAt: r["started_at"],
              })
              .get(key);
          s.total += 1;
          if (r["status"] === "通过") s.passed += 1;
          if (r["status"] === "失败") s.failed += 1;
          const d = Number(r["duration_ms"] ?? 0);
          if (d > 0) s.durations.push(d);
        }
        const list = [...map.values()]
          .map((s) => ({
            caseId: s.caseId,
            caseName: s.caseName,
            total: s.total,
            passed: s.passed,
            failed: s.failed,
            passRate: `${Math.round((s.passed / Math.max(1, s.total)) * 100)}%`,
            avgDurationMs: s.durations.length
              ? Math.round(s.durations.reduce((a: number, b: number) => a + b, 0) / s.durations.length)
              : 0,
            lastStatus: s.lastStatus,
            lastAt: s.lastAt,
          }))
          .sort((a, b) => b.failed - a.failed || b.total - a.total)
          .slice(0, num(input.limit, 20));
        return { totalRuns: rows.length, cases: list };
      },
    }),

    query_runs: tool({
      description: "查询最近的用例执行记录（含状态、耗时、失败原因、所属任务与设备）。",
      inputSchema: z.object({
        status: z.string().nullable().describe("按状态过滤：通过 / 失败 / 运行中 / 已跳过，不过滤填 null"),
        agentId: z.string().nullable().describe("按设备过滤，不过滤填 null"),
        limit: z.number().nullable().describe("返回条数，默认 20"),
      }),
      execute: async (input) => {
        const { localClient } = await import("@/lib/local-db.server");
        let q = localClient().from("case_runs").select("*");
        if (input.status) q = q.eq("status", input.status);
        if (input.agentId) q = q.eq("agent_id", input.agentId);
        const { data } = await q.order("started_at", { ascending: false }).limit(num(input.limit, 20));
        return {
          runs: ((data ?? []) as Record<string, any>[]).map((r) => ({
            runId: r["id"],
            taskId: r["task_id"],
            caseId: r["case_id"],
            caseName: r["case_name"],
            caseVersion: r["case_version"],
            agentId: r["agent_id"],
            status: r["status"],
            durationMs: r["duration_ms"],
            error: r["error"],
            startedAt: r["started_at"],
          })),
        };
      },
    }),

    query_run_logs: tool({
      description: "查询某条执行记录的真实运行日志，用于定位失败原因。",
      inputSchema: z.object({ runId: z.string().describe("执行记录 id") }),
      execute: async (input) => {
        const { localClient } = await import("@/lib/local-db.server");
        const { data } = await localClient()
          .from("run_logs")
          .select("*")
          .eq("run_id", input.runId)
          .order("at", { ascending: true })
          .limit(300);
        return {
          logs: ((data ?? []) as Record<string, any>[]).map((l) => ({
            at: l["at"],
            level: l["level"],
            message: l["message"],
          })),
        };
      },
    }),

    list_agents: tool({
      description: "列出执行节点及其在线状态、版本与累计执行次数。",
      inputSchema: z.object({ onlineOnly: z.boolean().nullable().describe("只看在线设备") }),
      execute: async (input) => {
        const { localClient } = await import("@/lib/local-db.server");
        const { data } = await localClient()
          .from("agents")
          .select("*")
          .order("last_heartbeat", { ascending: false })
          .limit(50);
        const nowMs = Date.now();
        const list = ((data ?? []) as Record<string, any>[]).map((a) => {
          const agoSec = Math.round((nowMs - new Date(a["last_heartbeat"]).getTime()) / 1000);
          return {
            agentId: a["id"],
            name: a["name"],
            version: a["version"],
            online: agoSec <= 60 && a["status"] !== "离线",
            heartbeatAgoSec: agoSec,
            totalRuns: a["total_runs"] ?? 0,
          };
        });
        return { agents: input.onlineOnly ? list.filter((a) => a.online) : list };
      },
    }),

    inspect_page: tool({
      description:
        "让一台在线 Agent 用本机 Playwright 打开页面，回传可交互元素清单、候选定位器与页面截图，用于挑选最稳定的定位方式。近期抓过的同一页面会直接命中平台缓存；需要最新页面时把 refresh 设为 true。",
      inputSchema: z.object({
        agentId: z.string().describe("执行节点 id"),
        url: z.string().describe("要打开的页面地址"),
        description: z.string().nullable().describe("要找的元素描述，例如“登录按钮”"),
        refresh: z.boolean().nullable().describe("是否忽略缓存强制重新抓取，默认 false"),
      }),
      execute: async (input) => {
        const { localClient } = await import("@/lib/local-db.server");
        const { readAiSettings } = await import("@/lib/ai-settings.server");
        const client = localClient();
        const settings = await readAiSettings();
        const urlKey = normalizeUrl(input.url);

        // 命中缓存：有效期内的最近一次成功抓取直接复用，客户端无需再开浏览器
        if (!input.refresh && settings.inspectCacheMinutes > 0) {
          const { data: cachedRows } = await client
            .from("agent_inspects")
            .select("*")
            .eq("url_key", urlKey)
            .eq("status", "已完成")
            .order("finished_at", { ascending: false })
            .limit(1);
          const cached = ((cachedRows ?? []) as Record<string, any>[])[0];
          const at = cached?.["finished_at"] ? Date.parse(cached["finished_at"]) : 0;
          const ageMs = at ? Date.now() - at : Number.POSITIVE_INFINITY;
          if (cached && ageMs <= settings.inspectCacheMinutes * 60_000) {
            return {
              jobId: cached["id"],
              url: cached["url"],
              cached: true,
              capturedAt: cached["finished_at"],
              ageMinutes: Math.max(0, Math.round(ageMs / 60_000)),
              cacheMinutes: settings.inspectCacheMinutes,
              screenshotUrl: cached["screenshot"] ? `/api/inspect-shot/${cached["id"]}` : "",
              viewport: cached["viewport"] ?? null,
              elements: (cached["elements"] ?? []) as unknown[],
            };
          }
        }

        const { data: created } = await client
          .from("agent_inspects")
          .insert({
            agent_id: input.agentId,
            url: input.url,
            url_key: urlKey,
            description: input.description ?? "",
            status: "排队中",
          })
          .select("id")
          .single();
        const jobId = (created as Record<string, any> | null)?.["id"] as string | undefined;
        if (!jobId) return { error: "抓取指令创建失败" };

        // 等待客户端回传（客户端每 3 秒轮询一次）
        const deadline = Date.now() + 45_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const { data: row } = await client
            .from("agent_inspects")
            .select("*")
            .eq("id", jobId)
            .maybeSingle();
          const r = row as Record<string, any> | null;
          if (!r) continue;
          if (r["status"] === "已完成") {
            return {
              jobId,
              url: input.url,
              cached: false,
              capturedAt: r["finished_at"],
              screenshotUrl: r["screenshot"] ? `/api/inspect-shot/${jobId}` : "",
              viewport: r["viewport"] ?? null,
              elements: (r["elements"] ?? []) as unknown[],
            };
          }
          if (r["status"] === "失败") {
            const kind = (r["fail_kind"] as string) || "unknown";
            return {
              jobId,
              url: input.url,
              failKind: kind,
              /** 中文失败原因与建议，直接转述给用户，不要再猜别的原因 */
              reason: FAIL_REASON[kind] ?? FAIL_REASON["unknown"],
              detail: (r["fail_detail"] as string) || (r["error"] as string) || "",
              attempts: Number(r["attempt"] ?? 1),
              error: r["error"] || "抓取失败",
            };
          }
        }
        return {
          jobId,
          error: "等待超时：请确认该设备的客户端在线且已安装浏览器内核，稍后可再试一次",
        };
      },
    }),
  };
}

/** 抓取失败原因 → 中文说明与建议 */
const FAIL_REASON: Record<string, string> = {
  blocked: "页面被拦截或需要登录，抓取到的不是目标页面。建议先在客户端窗口里登录，再重新抓取。",
  captcha: "页面出现验证码或人机验证，需要人工在客户端完成验证后再抓取。",
  crash: "客户端浏览器崩溃，已重建浏览器重试仍失败。建议确认设备内存充足后重试。",
  timeout: "页面加载超时或网络不通，多次重试仍未打开页面。建议检查网络与页面地址。",
  structure: "页面结构异常，元素抓取脚本执行失败，可能页面仍在渲染。",
  launch: "客户端无法启动本机浏览器内核，请在客户端重新下载浏览器内核。",
  unknown: "抓取失败，原因未知，可稍后再试一次。",
};

/** 归一化页面地址：去掉 hash 与常见追踪参数，让缓存能命中同一页面 */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|_ga)/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}
