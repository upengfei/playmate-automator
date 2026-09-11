const { test } = require("node:test");
const assert = require("node:assert/strict");
const ai = require("../agent-app/ai.cjs");
const { loadModule } = require("./helpers.cjs");

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