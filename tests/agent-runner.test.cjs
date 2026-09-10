const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers.cjs");

function fixture({ installError } = {}) {
  const calls = [];
  const scope = (path = []) => ({
    locator: (target) => ({
      press: async (value) => calls.push(["press", ...(path.length ? [path] : []), target, value]),
      click: async () => calls.push(["click", ...(path.length ? [path] : []), target]),
      dblclick: async () => calls.push(["dblclick", ...(path.length ? [path] : []), target]),
      check: async () => calls.push(["check", ...(path.length ? [path] : []), target]),
      uncheck: async () => calls.push(["uncheck", ...(path.length ? [path] : []), target]),
      fill: async (value) => calls.push(["fill", ...(path.length ? [path] : []), target, value]),
      selectOption: async (value) => calls.push(["select", ...(path.length ? [path] : []), target, value]),
      hover: async () => calls.push(["hover", ...(path.length ? [path] : []), target]),
      focus: async () => calls.push(["focus", ...(path.length ? [path] : []), target]),
      scrollIntoViewIfNeeded: async () => calls.push(["scrollIntoView", ...(path.length ? [path] : []), target]),
      setInputFiles: async (value) => calls.push(["setInputFiles", ...(path.length ? [path] : []), target, value]),
      dragTo: async (other) => calls.push(["dragTo", ...(path.length ? [path] : []), target, other.__target]),
      first() {
        return this;
      },
      isVisible: async () => true,
      innerText: async () => "visible text",
      textContent: async () => "visible text",
      waitFor: async () => {
        if (target === "#missing") throw new Error("Frame not found");
        calls.push(["waitFor", path, target]);
      },
      isChecked: async () => true,
      isEnabled: async () => true,
      inputValue: async () => "saved value",
      __target: target,
    }),
    frameLocator: (target) => scope([...path, target]),
  });
  const page = {
    setDefaultTimeout() {},
    goto: async (url) => calls.push(["goto", url]),
    keyboard: { press: async (value) => calls.push(["keyboard", value]) },
    locator: (target) => scope().locator(target),
    frameLocator: (target) => scope([target]),
    waitForURL: async (value) => calls.push(["waitForURL", value]),
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
        // 与 agent-app/browsers.cjs 的 resolve 行为保持一致
        resolve: (id = "chromium") => {
          const options = [
            { id: "chromium", label: "Chromium", engine: "chromium", channel: "", download: true },
            { id: "chrome", label: "Google Chrome", engine: "chromium", channel: "chrome", download: false },
            { id: "msedge", label: "Microsoft Edge", engine: "chromium", channel: "msedge", download: false },
            { id: "webkit", label: "WebKit", engine: "webkit", channel: "", download: true },
            { id: "firefox", label: "Firefox", engine: "firefox", channel: "", download: true },
          ];
          const key = String(id || "chromium").toLowerCase();
          return options.find((o) => o.id === key) || options[0];
        },
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

test("Frame context scopes interactions and supports common recorded operations", async () => {
  const { runner, calls } = fixture();
  const result = await runner.runCase({
    steps: [
      { keyword: "switchFrame", target: "#outer" },
      { keyword: "switchFrame", target: "iframe[name=inner]" },
      { keyword: "dblclick", target: "#card" },
      { keyword: "check", target: "#terms" },
      { keyword: "setInputFiles", target: "input[type=file]", value: "proof.pdf" },
      { keyword: "dragTo", target: "#source", value: "#target" },
      { keyword: "parentFrame" },
      { keyword: "focus", target: "#search" },
      { keyword: "scrollIntoView", target: "#footer" },
      { keyword: "expectChecked", target: "#terms" },
      { keyword: "expectEnabled", target: "#submit" },
      { keyword: "expectValue", target: "#search", value: "saved value" },
      { keyword: "mainFrame" },
      { keyword: "waitForUrl", value: "/done" },
    ],
  });

  assert.equal(result.status, "passed");
  assert.deepEqual(
    JSON.parse(JSON.stringify(calls.filter(([kind]) => !["launch", "closed"].includes(kind)))),
    [
      ["waitFor", [], "#outer"],
      ["waitFor", ["#outer"], "iframe[name=inner]"],
      ["dblclick", ["#outer", "iframe[name=inner]"], "#card"],
      ["check", ["#outer", "iframe[name=inner]"], "#terms"],
      ["setInputFiles", ["#outer", "iframe[name=inner]"], "input[type=file]", ["proof.pdf"]],
      ["dragTo", ["#outer", "iframe[name=inner]"], "#source", "#target"],
      ["focus", ["#outer"], "#search"],
      ["scrollIntoView", ["#outer"], "#footer"],
      ["waitForURL", "/done"],
    ],
  );
});

test("an unavailable Frame stops later steps and reports the active Frame context", async () => {
  const { runner, calls } = fixture();
  const events = [];
  const result = await runner.runCase(
    { steps: [{ keyword: "switchFrame", target: "#missing" }, { keyword: "click", target: "#never" }] },
    (event) => events.push(event),
  );
  assert.equal(result.status, "failed");
  assert.equal(calls.some((call) => call.includes("#never")), false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.steps[0].framePath)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(events.find((event) => event.type === "step-end").framePath)), []);
});
