const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers.cjs");

test("platform and Agent expose the same executable keyword contract", () => {
  const platform = loadModule("src/lib/keywords.ts");
  const agent = require("../agent-app/keywords.cjs");
  const projectable = ({ id, label, category, needsTarget, needsValue, targetLabel, valueLabel }) => ({
    id,
    label,
    category,
    needsTarget,
    needsValue,
    targetLabel,
    valueLabel,
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(platform.KEYWORDS.filter((keyword) => keyword.id !== "unsupported").map(projectable))),
    agent.KEYWORDS.filter((keyword) => keyword.id !== "unsupported").map(projectable),
  );
  const script = platform.generatePlaywrightCode("frame case", [
    { id: "1", keyword: "switchFrame", target: "iframe", value: "" },
    { id: "2", keyword: "click", target: "#save", value: "" },
  ]);
  assert.match(script, /framePath/);
  assert.match(script, /activeLocator/);
});

test("case validation rejects incomplete and pending-conversion steps before persistence", () => {
  const { validateCaseSteps } = loadModule("src/lib/keywords.ts");
  assert.match(validateCaseSteps([{ keyword: "switchFrame", target: "" }]), /缺少iframe 定位器/);
  assert.match(validateCaseSteps([{ keyword: "expectValue", target: "#name", value: "" }]), /缺少期望值/);
  assert.match(validateCaseSteps([{ keyword: "unsupported", value: "page.waitForEvent('download')" }]), /待转换步骤/);
  assert.equal(validateCaseSteps([{ keyword: "setInputFiles", target: "input", value: "a.txt\nb.txt" }]), null);
});
