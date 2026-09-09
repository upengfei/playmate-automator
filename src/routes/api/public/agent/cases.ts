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
        const { verifyAgent } = await import("@/lib/agent-db.server");
        if (!(await verifyAgent(agentId, token))) {
          return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
        }
        const { caseRepo } = await import("@/lib/case-repo.server");
        const rows = await (await caseRepo()).listCases(200);
        const data = rows.map((c) => ({
          id: c.id,
          name: c.name,
          module: c.module,
          start_url: c.start_url,
          steps: c.steps,
          script: c.script,
          source: c.source,
          priority: c.priority,
          updated_at: c.updated_at,
        }));
        return Response.json({ cases: data ?? [] });
      },
      POST: async ({ request }) => {
        const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "参数不合法" }, { status: 400 });
        const { agentId, token, case: c } = parsed.data;
        const { verifyAgent } = await import("@/lib/agent-db.server");
        if (!(await verifyAgent(agentId, token))) {
          return Response.json({ error: "节点令牌校验失败" }, { status: 401 });
        }
        const { caseRepo } = await import("@/lib/case-repo.server");
        const repo = await caseRepo();
        // 同名同节点的用例视为同一个用例的新版本，避免重复录制上传时产生多条用例
        const exist = await repo.findCaseByNameAndAgent(c.name, agentId);

        const version = (exist?.version ?? 0) + 1;
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

        let caseId = exist?.id;
        if (caseId) await repo.updateCase(caseId, payload);
        else caseId = (await repo.insertCase(payload)).id;

        // 录制上传同样生成版本快照，平台侧可以回滚、下发历史版本
        await repo.insertVersion({
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
