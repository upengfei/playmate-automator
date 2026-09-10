const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers.cjs");

function fixture({ installError } = {}) {
  const calls = [];
  const page = {
    setDefaultTimeout() {},
    goto: async (url) => calls.push(["goto", url]),
    keyboard: { press: async (value) => calls.push(["keyboard", value]) },
    locator: (target) => ({
      press: async (value) => calls.push(["press", target, value]),
      click: async () => calls.push(["click", target]),
    }),
    screenshot: async () => {},
  };
  const engines = Object.fromEntries(
    ["chromium", "firefox", "webkit"].map((engine) => [
      engine,
      {
        launch: async () => {
          calls.push(["launch", engine]);
          return {
            newContext: async () => ({ newPage: async () => page, close: async () => {} }),
            close: async () => calls.push(["closed"]),
          };
        },
      },
    ]),
  );
  const runner = loadModule("agent-app/runner.cjs", {
    modules: {
      electron: { app: { getPath: () => "/tmp/playflow-test" } },
      fs: { mkdirSync() {} },
      "./browsers.cjs": {
        BROWSERS_DIR: "/tmp/playflow-test",
        ensure: async () => {
          if (installError) throw new Error(installError);
        },
      },
      "playwright-core": engines,
    },
    globals: { process: { env: {} } },
  });
  return { runner, calls };
}

test("task browser and start URL reach the browser before its first action", async () => {
  for (const browser of ["Chromium", "Firefox", "WebKit"]) {
    const { runner, calls } = fixture();
    const result = await runner.runCase({
      browser,
      startUrl: "https://example.test/",
      steps: [{ keyword: "click", target: "#go" }],
    });
    assert.equal(result.status, "passed");
    assert.deepEqual(calls, [
      ["launch", browser.toLowerCase()],
      ["goto", "https://example.test/"],
      ["click", "#go"],
      ["closed"],
    ]);
  }
});

test("explicit goto takes precedence; optional press uses the page keyboard", async () => {
  const { runner, calls } = fixture();
  const result = await runner.runCase({
    startUrl: "https://unused.test/",
    steps: [
      { keyword: "goto", value: "https://example.test/" },
      { keyword: "press", target: "", value: "Shift+Tab" },
      { keyword: "press", target: "#search", value: "Enter" },
    ],
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(calls.slice(1, -1), [
    ["goto", "https://example.test/"],
    ["keyboard", "Shift+Tab"],
    ["press", "#search", "Enter"],
  ]);
});

test("invalid blocks and empty cases fail instead of silently reporting passed", async () => {
  for (const steps of [
    [],
    ["endIf", "click"],
    ["repeat", "click"],
    ["repeat", "endIf"],
    ["repeat", "elseBranch", "endLoop"],
    ["ifVisible", "elseBranch", "elseBranch", "endIf"],
  ]) {
    const { runner, calls } = fixture();
    const result = await runner.runCase({ steps: steps.map((keyword) => ({ keyword })) });
    assert.equal(result.status, "failed");
    assert.equal(calls.length, 0);
  }
});

test("nested loops retain runtime keyboard variables", async () => {
  const { runner, calls } = fixture();
  const result = await runner.runCase({
    steps: [
      { keyword: "repeat", value: "2" },
      { keyword: "press", value: "${当前循环}" },
      { keyword: "endLoop" },
    ],
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(
    calls.filter(([kind]) => kind === "keyboard"),
    [
      ["keyboard", "1"],
      ["keyboard", "2"],
    ],
  );
});

test("browser installation failures produce a terminal failure result", async () => {
  const { runner } = fixture({ installError: "download unavailable" });
  const result = await runner.runCase({ steps: [{ keyword: "press", value: "Enter" }] });
  assert.equal(result.status, "failed");
  assert.match(result.error, /download unavailable/);
});
