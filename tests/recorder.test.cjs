const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers.cjs");

function recorder() {
  return loadModule("agent-app/recorder.cjs", {
    modules: { "./browsers.cjs": {} },
  });
}

test("recording codegen preserves nested Frame transitions and common operations", () => {
  const steps = recorder().parse(`
    await page.goto('https://example.test');
    await page.frameLocator('#outer').getByRole('button', { name: 'Open' }).dblclick();
    await page.frameLocator('#outer').frameLocator('iframe[name=inner]').getByLabel('Terms').check();
    await page.frameLocator('#outer').frameLocator('iframe[name=inner]').locator('input[type=file]').setInputFiles('proof.pdf');
    await page.frameLocator('#outer').frameLocator('iframe[name=inner]').locator('input[type=file]').setInputFiles(['front.png', 'back.png']);
    await page.frameLocator('#outer').locator('#source').dragTo(page.frameLocator('#outer').locator('#target'));
    await page.frameLocator('#outer').getByText('Back').click();
    await page.getByRole('button', { name: 'Save' }).click();
  `);

  assert.deepEqual(
    JSON.parse(JSON.stringify(steps.map(({ keyword, target, value }) => ({ keyword, target, value })))),
    [
      { keyword: "goto", target: "", value: "https://example.test" },
      { keyword: "switchFrame", target: "#outer", value: "" },
      { keyword: "dblclick", target: 'role=button[name="Open"]', value: "" },
      { keyword: "switchFrame", target: "iframe[name=inner]", value: "" },
      { keyword: "check", target: "label=Terms", value: "" },
      { keyword: "setInputFiles", target: "input[type=file]", value: "proof.pdf" },
      { keyword: "setInputFiles", target: "input[type=file]", value: "front.png\nback.png" },
      { keyword: "parentFrame", target: "", value: "" },
      { keyword: "dragTo", target: "#source", value: "#target" },
      { keyword: "click", target: "text=Back", value: "" },
      { keyword: "parentFrame", target: "", value: "" },
      { keyword: "click", target: 'role=button[name="Save"]', value: "" },
    ],
  );
});

test("recording exposes unsupported Playwright statements instead of dropping them", () => {
  const steps = recorder().parse("await page.getByRole('dialog').waitFor({ state: 'hidden' });");
  assert.deepEqual(JSON.parse(JSON.stringify(steps.map(({ keyword, value }) => ({ keyword, value })))), [
    { keyword: "unsupported", value: "await page.getByRole('dialog').waitFor({ state: 'hidden' });" },
  ]);
});

test("recording exposes non-awaited unsupported Playwright statements", () => {
  const steps = recorder().parse("const download = page.waitForEvent('download');");
  assert.deepEqual(JSON.parse(JSON.stringify(steps.map(({ keyword, value }) => ({ keyword, value })))), [
    { keyword: "unsupported", value: "const download = page.waitForEvent('download');" },
  ]);
});

test("recording ignores normal JavaScript codegen scaffolding", () => {
  const steps = recorder().parse(`
    const { test, expect } = require('@playwright/test');
    test('recording', async ({ page }) => {
      await page.goto('https://example.test');
      await page.getByRole('button', { name: 'Save' }).click();
    });
  `);
  assert.deepEqual(JSON.parse(JSON.stringify(steps.map(({ keyword }) => keyword))), ["goto", "click"]);
});
