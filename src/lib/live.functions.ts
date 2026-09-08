import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** 平台把真实用例下发给真实节点：创建一条排队中的执行记录，客户端会轮询领取 */
export const dispatchToAgent = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ caseId: z.string().uuid(), agentId: z.string().min(2).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { admin } = await import("@/lib/agent-db.server");
    const db = admin();
    const { data: c, error: cErr } = await db
      .from("test_cases")
      .select("id, name")
      .eq("id", data.caseId)
      .single();
    if (cErr) throw new Error(cErr.message);
    const { data: run, error } = await db
      .from("case_runs")
      .insert({
        case_id: c.id,
        case_name: c.name,
        agent_id: data.agentId,
        status: "排队中",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { runId: run.id as string };
  });
