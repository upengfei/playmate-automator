import { z } from "zod";

/** Bound stored diagnostics without rejecting the terminal result of a long loop.
 * The Agent also keeps the full execution log on its local disk.
 */
export const agentReportSchema = z
  .object({
    agentId: z.string().min(2).max(64),
    token: z.string().min(8).max(128),
    runId: z.string().uuid().optional(),
    caseId: z.string().uuid().optional(),
    caseName: z.string().max(120).default(""),
    status: z.enum(["执行中", "通过", "失败"]),
    durationMs: z.number().nonnegative().optional(),
    error: z
      .string()
      .optional()
      .transform((v) => v?.slice(0, 2000)),
    steps: z.array(z.record(z.unknown())).default([]),
    logs: z
      .array(
        z.object({
          level: z.string().max(16).default("info"),
          message: z.string().transform((m) => m.slice(0, 1000)),
        }),
      )
      .default([]),
  })
  .transform((data) => {
    const truncated = data.steps.length > 300 || data.logs.length > 500;
    return {
      ...data,
      steps: data.steps.slice(-300),
      logs: truncated
        ? [
            {
              level: "warn",
              message: `本次共 ${data.steps.length} 条步骤结果、${data.logs.length} 条日志；平台保留最后 300 条步骤结果和最后 499 条日志，完整日志保存在 Agent 本机。`,
            },
            ...data.logs.slice(-499),
          ]
        : data.logs,
    };
  });
