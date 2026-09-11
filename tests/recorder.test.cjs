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

test("recording keeps element locators when codegen uses contentFrame()", () => {
  const steps = recorder().parse(`
    await page.goto('https://example.test');
    await page.locator('#outer').contentFrame().getByRole('button', { name: 'Open' }).click();
    await page.locator('#outer').contentFrame().locator('iframe[name=inner]').contentFrame().getByLabel('Terms').check();
    await page.locator('#outer').contentFrame().frameLocator('iframe[name=inner]').locator('#name').fill('张三');
    await expect(page.locator('#outer').contentFrame().locator('iframe[name=inner]').contentFrame().locator('#name')).toHaveValue('张三');
    await page.locator('#outer').contentFrame().locator('#source').dragTo(page.locator('#outer').contentFrame().locator('#target'));
    await page.getByRole('button', { name: 'Save' }).click();
  `);

  assert.deepEqual(
    JSON.parse(JSON.stringify(steps.map(({ keyword, target, value }) => ({ keyword, target, value })))),
    [
      { keyword: "goto", target: "", value: "https://example.test" },
      { keyword: "switchFrame", target: "#outer", value: "" },
      { keyword: "click", target: 'role=button[name="Open"]', value: "" },
      { keyword: "switchFrame", target: "iframe[name=inner]", value: "" },
      { keyword: "check", target: "label=Terms", value: "" },
      { keyword: "fill", target: "#name", value: "张三" },
      { keyword: "expectValue", target: "#name", value: "张三" },
      { keyword: "parentFrame", target: "", value: "" },
      { keyword: "dragTo", target: "#source", value: "#target" },
      { keyword: "parentFrame", target: "", value: "" },
      { keyword: "click", target: 'role=button[name="Save"]', value: "" },
    ],
  );
});

test("recording maps a role-based iframe into the Frame context", () => {
  const steps = recorder().parse(
    "await page.getByTestId('editor').contentFrame().getByPlaceholder('内容').fill('hello');",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(steps.map(({ keyword, target, value }) => ({ keyword, target, value })))),
    [
      { keyword: "switchFrame", target: '[data-testid="editor"]', value: "" },
      { keyword: "fill", target: "placeholder=内容", value: "hello" },
    ],
  );
});

test("recording keeps a page-level keyboard press without a locator", () => {
  const steps = recorder().parse("await page.keyboard.press('Enter');");
  assert.deepEqual(
    JSON.parse(JSON.stringify(steps.map(({ keyword, target, value }) => ({ keyword, target, value })))),
    [{ keyword: "press", target: "", value: "Enter" }],
  );
});



test("recording exposes unsupported Playwright statements instead of dropping them", () => {
  const steps = recorder().parse("await page.getByRole('dialog').waitFor({ state: 'hidden' });");
  assert.deepEqual(JSON.parse(JSON.stringify(steps.map(({ keyword, value }) => ({ keyword, value })))), [
    { keyword: "unsupported", value: "await page.getByRole('dialog').waitFor({ state: 'hidden' });" },
  ]);
});

test("recording keeps every Playwright assertion offered by the codegen toolbar", () => {
  const steps = recorder().parse(`
    await expect(page.getByRole('heading', { name: '标题' })).toBeVisible();
    await expect(page.getByTestId('box')).not.toBeVisible();
    await expect(page.locator('#tip')).toBeHidden();
    await expect(page.getByRole('cell')).toContainText('你好');
    await expect(page.locator('#label')).toHaveText('完全相等');
    await expect(page.locator('#name')).toHaveValue('张三');
    await expect(page.locator('#agree')).not.toBeChecked();
    await expect(page.locator('#submit')).toBeDisabled();
    await expect(page.locator('li')).toHaveCount(3);
    await expect(page.locator('a')).toHaveAttribute('href', '/x');
    await expect(page).toHaveURL('https://example.test/done');
  `);

  assert.deepEqual(
    JSON.parse(JSON.stringify(steps.map(({ keyword, target, value }) => ({ keyword, target, value })))),
    [
      { keyword: "expectVisible", target: 'role=heading[name="标题"]', value: "" },
      { keyword: "expectHidden", target: '[data-testid="box"]', value: "" },
      { keyword: "expectHidden", target: "#tip", value: "" },
      { keyword: "expectText", target: "role=cell", value: "你好" },
      { keyword: "expectExactText", target: "#label", value: "完全相等" },
      { keyword: "expectValue", target: "#name", value: "张三" },
      { keyword: "expectUnchecked", target: "#agree", value: "" },
      { keyword: "expectDisabled", target: "#submit", value: "" },
      { keyword: "expectCount", target: "li", value: "3" },
      { keyword: "expectAttribute", target: "a", value: "href=/x" },
      { keyword: "expectUrl", target: "", value: "https://example.test/done" },
    ],
  );
});

test("recording merges a multiline ARIA snapshot assertion into one step", () => {
  const steps = recorder().parse(`
    await expect(page.frameLocator('#f').getByRole('main')).toMatchAriaSnapshot(\`
      - heading "标题" [level=1]
      - link "去 x"
    \`);
  `);
  assert.deepEqual(
    JSON.parse(JSON.stringify(steps.map(({ keyword, target, value }) => ({ keyword, target, value })))),
    [
      { keyword: "switchFrame", target: "#f", value: "" },
      { keyword: "expectAriaSnapshot", target: "role=main", value: '      - heading "标题" [level=1]\n      - link "去 x"' },
    ],
  );
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
