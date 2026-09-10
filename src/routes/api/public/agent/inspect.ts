import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/** AI 页面元素定位：客户端轮询抓取指令（GET）并回传元素清单（POST），均校验节点令牌 */
export const Route = createFileRoute("/api/public/agent/inspect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const agentId = url.searchParams.get("agentId") ?? "";
        const token = url.searchParams.get("token") ?? "";
        const { verifyAgent } = await import("@/lib/agent-db.server");
        if (!(await verifyAgent(agentId, token))) {
          return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
        }
        const { localClient } = await import("@/lib/local-db.server");
        const client = localClient();
        const { data } = await client
          .from("agent_inspects")
          .select("*")
          .eq("agent_id", agentId)
          .eq("status", "排队中")
          .order("created_at", { ascending: true })
          .limit(1);
        const job = ((data ?? []) as Record<string, any>[])[0];
        if (!job) return Response.json({ jobs: [] });
        await client
          .from("agent_inspects")
          .update({ status: "抓取中", attempt: 0, fail_kind: "", fail_detail: "" })
          .eq("id", job["id"]);
        const { readAiSettings } = await import("@/lib/ai-settings.server");
        const settings = await readAiSettings();
        return Response.json({
          jobs: [
            {
              id: job["id"],
              url: job["url"],
              description: job["description"] ?? "",
              screenshot: settings.inspectScreenshot,
              /** 抓取失败时的重试策略，由平台统一下发 */
              retry: { maxAttempts: 3, delaysMs: [2000, 5000, 10_000] },
            },
          ],
        });
      },


      POST: async ({ request }) => {
        const parsed = z
          .object({
            agentId: z.string().min(1),
            token: z.string().min(1),
            jobId: z.string().min(1),
            elements: z
              .array(
                z.object({
                  tag: z.string().max(40).default(""),
                  role: z.string().max(60).default(""),
                  text: z.string().max(200).default(""),
                  locator: z.string().max(400).default(""),
                  recommended: z.string().max(40).default(""),
                  unique: z.boolean().default(false),
                  disabled: z.boolean().default(false),
                  box: z
                    .object({
                      x: z.number().default(0),
                      y: z.number().default(0),
                      width: z.number().default(0),
                      height: z.number().default(0),
                    })
                    .partial()
                    .default({}),
                  candidates: z
                    .array(
                      z.object({
                        kind: z.string().max(40).default(""),
                        value: z.string().max(400).default(""),
                        unique: z.boolean().default(false),
                      }),
                    )
                    .max(12)
                    .default([]),
                  attributes: z.record(z.string(), z.string()).default({}),
                }),
              )
              .max(200)
              .default([]),
            /** 页面截图（JPEG base64，最大约 900KB 字符） */
            screenshot: z.string().max(900_000).optional(),
            viewport: z.object({ width: z.number(), height: z.number() }).optional(),
            error: z.string().max(2000).optional(),
            /** 已尝试次数与失败原因分类 */
            attempt: z.number().min(0).max(20).optional(),
            failKind: z.string().max(40).optional(),
            failDetail: z.string().max(2000).optional(),
          })
          .safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "参数不合法" }, { status: 400 });
        const { agentId, token, jobId, elements, screenshot, viewport, error, attempt, failKind, failDetail } =
          parsed.data;

        const { verifyAgent } = await import("@/lib/agent-db.server");
        if (!(await verifyAgent(agentId, token))) {
          return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
        }
        const { localClient } = await import("@/lib/local-db.server");
        await localClient()
          .from("agent_inspects")
          .update({
            status: error ? "失败" : "已完成",
            elements,
            screenshot: screenshot ?? "",
            viewport: viewport ?? null,
            error: error ?? "",
            attempt: attempt ?? 1,
            fail_kind: error ? (failKind ?? "unknown") : "",
            fail_detail: error ? (failDetail ?? error) : "",
            finished_at: new Date().toISOString(),
          })
          .eq("id", jobId)
          .eq("agent_id", agentId);
        return Response.json({ ok: true });
      },

    },
  },
});
