const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const ai = require("../agent-app/ai.cjs");
const { loadModule } = require("./helpers.cjs");

function loadAiWithTemporarySettings(fetchImpl) {
  const userData = mkdtempSync(join(tmpdir(), "playflow-agent-ai-"));
  const electronPath = require.resolve("electron");
  const platformPath = require.resolve("../agent-app/platform.cjs");
  const aiPath = require.resolve("../agent-app/ai.cjs");
  const cached = new Map(
    [electronPath, platformPath, aiPath].map((id) => [id, require.cache[id]]),
  );
  const originalFetch = global.fetch;

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => userData } },
  };
  delete require.cache[platformPath];
  delete require.cache[aiPath];
  global.fetch = fetchImpl;

  return {
    ai: require("../agent-app/ai.cjs"),
    restore() {
      global.fetch = originalFetch;
      for (const [id, entry] of cached) {
        if (entry) require.cache[id] = entry;
        else delete require.cache[id];
      }
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

test("AI drafts use the Agent keyword allowlist for local and platform replies", () => {
  const draft = ai.sanitizeDraft({
    name: "登录",
    steps: [
      { keyword: "fill", target: "#email", value: "qa@example.com" },
      { keyword: "runShell", value: "rm -rf /" },
      { keyword: "expectVisible", target: "[data-testid=ok]" },
    ],
  });
  assert.deepEqual(draft.steps.map((step) => step.keyword), ["fill", "expectVisible"]);
  assert.deepEqual(draft.rejected, ["runShell"]);
});

test("element summaries preserve recommended and candidate locators", () => {
  const text = ai.describeElements([
    {
      role: "button",
      text: "提交",
      locator: "#submit",
      attributes: { name: "submit", "data-testid": "submit-button" },
      candidates: [
        { kind: "testid", value: '[data-testid="submit-button"]', unique: true },
        { kind: "id", value: "#submit", unique: true },
      ],
    },
  ]);
  assert.match(text, /推荐定位=#submit/);
  assert.match(text, /data-testid=submit-button/);
  assert.match(text, /testid:\[data-testid="submit-button"\]（唯一）/);
  assert.doesNotMatch(text, /\[object Object\]/);
});

test("report analysis groups failures, slow steps, and similar cases", () => {
  const { analyzeStepResults, findSimilarCases } = loadModule("src/lib/ai-analysis.ts");
  const report = analyzeStepResults([
    {
      id: "run-1",
      case_id: "case-1",
      case_name: "登录 A",
      steps: [
        { keyword: "goto", status: "passed", durationMs: 900 },
        { keyword: "click", target: "#submit", status: "failed", durationMs: 1200, error: "Timeout 15000ms at https://a.test" },
      ],
    },
    {
      id: "run-2",
      case_id: "case-2",
      case_name: "登录 B",
      steps: [{ keyword: "click", target: "#submit", status: "failed", durationMs: 800, error: "Timeout 30000ms at https://b.test" }],
    },
  ]);
  assert.equal(report.failures[0].count, 2);
  assert.equal(report.slowSteps[0].keyword, "click");

  const similar = findSimilarCases([
    { id: "a", name: "A", module: "登录", steps: [{ keyword: "goto", value: "/login" }, { keyword: "click", target: "#submit" }] },
    { id: "b", name: "B", module: "登录", steps: [{ keyword: "goto", value: "/login" }, { keyword: "click", target: "#submit" }] },
  ]);
  assert.equal(similar[0].similarity, 100);
});

test("connection test uses the settings currently entered in the workbench", async () => {
  const requests = [];
  const agent = loadAiWithTemporarySettings(async (url) => {
    requests.push(String(url));
    return Response.json({ choices: [{ message: { content: "连接正常" } }] });
  });

  try {
    const result = await agent.ai.test({
      aiMode: "local",
      aiBaseUrl: "https://model.example/v1",
      aiApiKey: "test-key",
      aiModel: "test-model",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(requests, ["https://model.example/v1/chat/completions"]);
  } finally {
    agent.restore();
  }
});

test("local model HTML response identifies an invalid API base URL", async () => {
  const agent = loadAiWithTemporarySettings(async () =>
    new Response("<!doctype html><title>AI Gateway</title>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );

  try {
    agent.ai.save({ aiMode: "local", aiBaseUrl: "https://model.example/v1", aiModel: "test-model" });
    await assert.rejects(
      () => agent.ai.chat([{ role: "user", content: "连接测试" }]),
      /HTML.*Base URL.*网页入口/,
    );
  } finally {
    agent.restore();
  }
});
