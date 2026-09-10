const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { loadModule } = require("./helpers.cjs");

test("heartbeats preserve existing counters and creation dates while inserts get defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "playflow-db-test-"));
  const { localClient } = loadModule("src/lib/local-db.server.ts", {
    globals: { process: { env: { CASE_DB_FILE: join(dir, "cases.db") } } },
  });
  const db = localClient();
  const createdAt = "2020-01-01T00:00:00.000Z";
  assert.equal(
    (
      await db
        .from("agents")
        .insert({ id: "test-node", name: "before", total_runs: 42, created_at: createdAt })
    ).error,
    null,
  );
  assert.equal(
    (
      await db
        .from("agents")
        .upsert({ id: "test-node", name: "after", last_heartbeat: "2026-09-10T00:00:00Z" })
    ).error,
    null,
  );
  const { data: node } = await db.from("agents").select("*").eq("id", "test-node").single();
  assert.equal(node.total_runs, 42);
  assert.equal(node.created_at, createdAt);
  assert.equal(node.name, "after");
  const fresh = await db.from("agents").upsert({ id: "new-node" }).select("*").single();
  assert.equal(fresh.error, null);
  assert.equal(fresh.data.total_runs, 0);
  assert.ok(fresh.data.created_at);
  await db.from("agents").upsert({ id: "test-node", total_runs: 43 });
  assert.equal(
    (await db.from("agents").select("*").eq("id", "test-node").single()).data.total_runs,
    43,
  );
});

test("long-loop terminal reports remain valid and retain final diagnostics", () => {
  const { agentReportSchema } = loadModule("src/lib/agent-report-schema.ts");
  const parsed = agentReportSchema.parse({
    agentId: "test-node",
    token: "test-token",
    status: "失败",
    error: "last step failed",
    steps: Array.from({ length: 401 }, (_, index) => ({
      index,
      status: index === 400 ? "failed" : "passed",
    })),
    logs: Array.from({ length: 1000 }, (_, index) => ({ message: `log-${index}` })),
  });
  assert.equal(parsed.status, "失败");
  assert.equal(parsed.steps.length, 300);
  assert.equal(parsed.steps.at(-1).status, "failed");
  assert.equal(parsed.logs.length, 500);
  assert.equal(parsed.logs[0].level, "warn");
  assert.match(parsed.logs[0].message, /401.*1000/);
  assert.equal(parsed.logs.at(-1).message, "log-999");
  assert.equal(
    agentReportSchema.safeParse({ agentId: "x", token: "short", status: "通过" }).success,
    false,
  );
});

test("job API preserves the task browser and resolves default, environment and device parameters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "playflow-jobs-test-"));
  const { localClient } = loadModule("src/lib/local-db.server.ts", {
    globals: { process: { env: { CASE_DB_FILE: join(dir, "cases.db") } } },
  });
  const db = localClient();
  await db
    .from("tasks")
    .insert({ id: "task-test", name: "test", browser: "Firefox", env: "测试环境" });
  await db.from("case_runs").insert({
    id: "run-test",
    task_id: "task-test",
    case_id: "case-test",
    case_version: 1,
    case_name: "test",
    agent_id: "node-test",
    status: "排队中",
  });
  await db.from("param_bindings").insert([
    { scope: "环境", scope_key: "测试环境", name: "HOST", value: "env.test" },
    { scope: "设备", scope_key: "node-test", name: "HOST", value: "device.test" },
  ]);
  const params = loadModule("src/lib/case-params.server.ts", {
    modules: {
      "./keywords": loadModule("src/lib/keywords.ts"),
    },
  });
  const { Route } = loadModule("src/routes/api/public/agent/jobs.ts", {
    modules: {
      "@tanstack/react-router": { createFileRoute: () => (options) => options },
      "@/lib/agent-db.server": { admin: () => db, verifyAgent: async () => true },
      "@/lib/case-repo.server": {
        caseRepo: async () => ({
          getCase: async () => ({
            id: "case-test",
            version: 1,
            start_url: "https://${HOST}/",
            params: [{ name: "HOST", value: "default.test" }],
            steps: [{ keyword: "press", value: "Enter" }],
          }),
        }),
      },
      "@/lib/case-params.server": params,
    },
  });
  const response = await Route.server.handlers.GET({
    request: new Request(
      "https://platform.test/api/public/agent/jobs?agentId=node-test&token=test-token",
    ),
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.jobs.length, 1);
  assert.equal(data.jobs[0].browser, "firefox");
  assert.equal(data.jobs[0].startUrl, "https://device.test/");
  assert.equal(data.jobs[0].steps[0].value, "Enter");
});
