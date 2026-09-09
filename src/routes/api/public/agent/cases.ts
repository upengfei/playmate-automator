import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const stepSchema = z.object({
  id: z.string().max(64).optional(),
  keyword: z.string().max(32),
  target: z.string().max(500).default(""),
  value: z.string().max(1000).default(""),
});

const uploadSchema = z.object({
  agentId: z.string().min(2).max(64),
  token: z.string().min(8).max(128),
  case: z.object({
    name: z.string().min(1).max(120),
    module: z.string().max(40).default("未分类"),
    startUrl: z.string().max(500).default(""),
    priority: z.string().max(8).default("P1"),
    steps: z.array(stepSchema).max(200),
    script: z.string().max(20000).default(""),
    source: z.string().max(20).default("Agent 录制"),
  }),
});

/**
 * GET  拉取平台用例到本机
 * POST 把本机录制的用例上传到平台
 */
export const Route = createFileRoute("/api/public/agent/cases")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const agentId = url.searchParams.get("agentId") ?? "";
        const token = url.searchParams.get("token") ?? "";
        const { admin, verifyAgent } = await import("@/lib/agent-db.server");
        if (!(await verifyAgent(agentId, token))) {
          return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
        }
        const { data, error } = await admin()
          .from("test_cases")
          .select("id, name, module, start_url, steps, script, source, priority, updated_at")
          .order("updated_at", { ascending: false })
          .limit(200);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ cases: data ?? [] });
      },
      POST: async ({ request }) => {
        const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "参数不合法" }, { status: 400 });
        const { agentId, token, case: c } = parsed.data;
        const { admin, verifyAgent } = await import("@/lib/agent-db.server");
        if (!(await verifyAgent(agentId, token))) {
          return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
        }
        const client = admin();
        // 同名同节点的用例视为同一个用例的新版本，避免重复录制上传时产生多条用例
        const { data: exist } = await client
          .from("test_cases")
          .select("id, version")
          .eq("name", c.name)
          .eq("agent_id", agentId)
          .maybeSingle();

        const version = ((exist?.version as number | undefined) ?? 0) + 1;
        const payload = {
          name: c.name,
          module: c.module,
          start_url: c.startUrl,
          priority: c.priority,
          steps: c.steps,
          script: c.script,
          source: c.source,
          agent_id: agentId,
          version,
          updated_at: new Date().toISOString(),
        };

        let caseId = exist?.id as string | undefined;
        if (caseId) {
          const { error } = await client.from("test_cases").update(payload).eq("id", caseId);
          if (error) return Response.json({ error: error.message }, { status: 500 });
        } else {
          const { data, error } = await client.from("test_cases").insert(payload).select("id").single();
          if (error) return Response.json({ error: error.message }, { status: 500 });
          caseId = data.id as string;
        }

        // 录制上传同样生成版本快照，平台侧可以回滚、下发历史版本
        await client.from("case_versions").insert({
          case_id: caseId,
          version,
          name: c.name,
          module: c.module,
          priority: c.priority,
          start_url: c.startUrl,
          steps: c.steps,
          script: c.script,
          note: "客户端录制上传",
          author: agentId,
          source: c.source,
        });

        return Response.json({ ok: true, id: caseId, version });
      },
    },
  },
});
