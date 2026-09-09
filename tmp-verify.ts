import { caseRepo } from "./src/lib/case-repo.server";
import { localClient } from "./src/lib/local-db.server";

const repo = await caseRepo();
const db = localClient();

const v1Steps = [
  { keyword: "打开页面", target: "${BASE_URL}", value: "" },
  { keyword: "断言可见", target: "h1", value: "" },
];
const v2Steps = [...v1Steps, { keyword: "截图", target: "", value: "home.png" }];

const created = await repo.insertCase({
  name: "本地库验收用例",
  module: "验收",
  priority: "P0",
  tags: ["local"],
  author: "平台",
  status: "就绪",
  source: "平台编写",
  start_url: "${BASE_URL}",
  steps: v1Steps,
  script: "// v1",
  params: [{ name: "BASE_URL", value: "https://default.invalid", note: "默认值" }],
  is_template: false,
  version: 1,
  updated_at: new Date().toISOString(),
});
await repo.insertVersion({
  case_id: created.id,
  version: 1,
  name: created.name,
  module: "验收",
  priority: "P0",
  start_url: "${BASE_URL}",
  steps: v1Steps,
  script: "// v1",
  params: [{ name: "BASE_URL", value: "https://default.invalid" }],
  note: "初始版本",
  author: "平台",
  source: "平台编写",
});
await repo.updateCase(created.id, { steps: v2Steps, script: "// v2", version: 2, updated_at: new Date().toISOString() });
await repo.insertVersion({
  case_id: created.id,
  version: 2,
  name: created.name,
  module: "验收",
  priority: "P0",
  start_url: "${BASE_URL}",
  steps: v2Steps,
  script: "// v2",
  params: [{ name: "BASE_URL", value: "https://default.invalid" }],
  note: "追加截图步骤",
  author: "平台",
  source: "平台编写",
});

await db.from("param_bindings").upsert(
  [
    { scope: "环境", scope_key: "测试环境", name: "BASE_URL", value: "https://env.example.com", note: "" },
    { scope: "设备", scope_key: "AG-LOCAL-01", name: "BASE_URL", value: "https://device.example.org", note: "" },
  ],
  { onConflict: "scope,scope_key,name" },
);

const { data: task, error } = await db
  .from("tasks")
  .insert({
    name: "本地库验收任务",
    env: "测试环境",
    browser: "Chromium",
    agent_id: "AG-LOCAL-01",
    concurrency: 1,
    retry: 0,
    status: "下发中",
    stage: "等待节点领取",
    trigger: "手动",
  })
  .select("id")
  .single();
if (error) throw new Error(error.message);

const { data: run } = await db
  .from("case_runs")
  .insert({
    task_id: task.id,
    case_id: created.id,
    case_name: created.name,
    case_version: 1,
    agent_id: "AG-LOCAL-01",
    status: "排队中",
    step_total: v1Steps.length,
  })
  .select("id")
  .single();

console.log(JSON.stringify({ caseId: created.id, taskId: task.id, runId: run.id }));
