import { createFileRoute } from "@tanstack/react-router";

/** 一次性迁移：把平台数据库里已有的用例与版本导入本地用例库 */
export const Route = createFileRoute("/api/public/import-cases")({
  server: {
    handlers: {
      POST: async () => {
        const { admin } = await import("@/lib/agent-db.server");
        const { caseRepo } = await import("@/lib/case-repo.server");
        const db = admin();
        const repo = await caseRepo();
        const { data: cases } = await db.from("test_cases").select("*");
        const { data: versions } = await db.from("case_versions").select("*");
        let imported = 0;
        for (const c of (cases ?? []) as Record<string, any>[]) {
          if (await repo.getCase(c["id"])) continue;
          await repo.insertCase(c as any);
          imported++;
        }
        let vs = 0;
        for (const v of (versions ?? []) as Record<string, any>[]) {
          if (await repo.getVersion(v["case_id"], v["version"])) continue;
          await repo.insertVersion(v as any);
          vs++;
        }
        return Response.json({ imported, versions: vs, driver: repo.driver });
      },
    },
  },
});
