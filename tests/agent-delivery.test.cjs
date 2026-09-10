const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { execFileSync } = require("node:child_process");
const { loadModule } = require("./helpers.cjs");

function fixture({ openError = "", choice = 0, version = "1.8.3", versionStatus = 200 } = {}) {
  const reports = [],
    executed = [];
  let quitCount = 0,
    dialogCount = 0;
  const main = loadModule("agent-app/main.cjs", {
    modules: {
      electron: {
        app: {
          getPath: () => "/tmp/playflow-test",
          getVersion: () => "1.8.2",
          requestSingleInstanceLock: () => true,
          on() {},
          whenReady: () => ({ then() {} }),
          quit: () => quitCount++,
        },
        ipcMain: { handle() {} },
        dialog: {
          showMessageBox: async () => {
            dialogCount++;
            return { response: choice };
          },
          showErrorBox() {},
        },
        shell: { openPath: async () => openError },
      },
      fs: { mkdirSync() {}, writeFileSync() {} },
      "./platform.cjs": {
        getConfig: () => ({
          platformUrl: "https://platform.test",
          agentId: "node-test",
          token: "test-token",
        }),
        claimJobs: async () => [
          {
            runId: "run-test",
            caseId: "case-test",
            name: "test",
            steps: [],
            browser: "webkit",
            startUrl: "https://example.test",
          },
        ],
        report: async () => ({ ok: true }),
      },
      "./runner.cjs": {
        runCase: async (testCase) => {
          executed.push(testCase);
          return { status: "passed", steps: [] };
        },
      },
      "./recorder.cjs": {},
      "./browsers.cjs": {},
    },
    globals: {
      setInterval() {},
      clearTimeout() {},
      // Execute any attempted exit timer, so the regression test catches it.
      setTimeout: (fn) => fn(),
      fetch: async (url, options) => {
        if (url.includes("/version?"))
          return {
            ok: versionStatus === 200,
            status: versionStatus,
            json: async () => ({
              version,
              artifact: {
                file: "agent.zip",
                url: "https://download.test/agent.zip",
                sha256: require("node:crypto").createHash("sha256").update("").digest("hex"),
              },
            }),
          };
        if (url.includes("upgrade-report")) {
          reports.push(JSON.parse(options.body));
          return { ok: true };
        }
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
      },
    },
    expose: "module.exports = { checkForUpdates, pollJobs };",
  });
  return { main, reports, executed, quitCount: () => quitCount, dialogCount: () => dialogCount };
}

test("opening an update stays pending, keeps current version running and suppresses repeat prompts", async () => {
  const f = fixture();
  await f.main.checkForUpdates({ manual: true });
  assert.equal(f.reports.at(-1).stage, "等待手动安装");
  assert.equal(f.reports.at(-1).installedVersion, "1.8.2");
  assert.equal(f.reports.at(-1).ok, undefined);
  assert.equal(f.quitCount(), 0);
  await f.main.checkForUpdates();
  assert.equal(f.dialogCount(), 1);
});

test("deferring installation stays pending; failure to open never reports success", async () => {
  const deferred = fixture({ choice: 1 });
  await deferred.main.checkForUpdates();
  assert.equal(deferred.reports.at(-1).ok, undefined);
  assert.equal(deferred.reports.at(-1).stage, "等待手动安装");
  const failed = fixture({ openError: "cannot open archive" });
  await failed.main.checkForUpdates({ manual: true });
  assert.equal(failed.reports.at(-1).ok, false);
  assert.equal(failed.reports.at(-1).installedVersion, "1.8.2");
  assert.equal(failed.quitCount(), 0);
});

test("version confirmation reports the actual running version", async () => {
  const f = fixture({ version: "1.8.2" });
  await f.main.checkForUpdates();
  assert.equal(f.reports.at(-1).ok, true);
  assert.equal(f.reports.at(-1).installedVersion, "1.8.2");
});

test("an unavailable published release does not download or report an installed update", async () => {
  const f = fixture({ versionStatus: 503 });
  await f.main.checkForUpdates();
  assert.equal(f.reports.at(-1).ok, false);
  assert.equal(f.reports.at(-1).installedVersion, "1.8.2");
  assert.match(f.reports.at(-1).message, /HTTP 503/);
  assert.equal(f.dialogCount(), 0);
  assert.equal(f.quitCount(), 0);
});

test("the Agent forwards the assigned browser and start URL to its runner", async () => {
  const f = fixture();
  await f.main.pollJobs();
  assert.equal(f.executed.length, 1);
  assert.equal(f.executed[0].browser, "webkit");
  assert.equal(f.executed[0].startUrl, "https://example.test");
});

test("release workflow classifies darwin separately from Windows", () => {
  const workflow = readFileSync(
    resolve(__dirname, "../.github/workflows/agent-release.yml"),
    "utf8",
  );
  const script = workflow.match(/case "\$name" in[\s\S]*?esac/)[0];
  for (const [name, platform] of [
    ["PlayFlowAgent-1.8.2-darwin-arm64.zip", "darwin"],
    ["PlayFlowAgent-1.8.2-win-x64.zip", "win"],
    ["PlayFlowAgent-1.8.2-linux-x64.tar.gz", "linux"],
  ]) {
    assert.equal(
      execFileSync("/bin/sh", ["-c", `${script}\nprintf '%s' "$platform"`], {
        env: { name },
        encoding: "utf8",
      }),
      platform,
    );
  }
});

test("legacy mislabelled archives are selected by their actual platform and architecture", () => {
  const { selectArtifact } = loadModule("src/lib/agent-artifacts.ts");
  const artifacts = [
    { platform: "win", file: "PlayFlowAgent-1.8.2-darwin-arm64.zip" },
    { platform: "win", file: "PlayFlowAgent-1.8.2-win-x64.zip" },
  ];
  assert.equal(selectArtifact(artifacts, "win", "x64"), artifacts[1]);
  assert.equal(selectArtifact(artifacts, "darwin", "arm64"), artifacts[0]);
  assert.equal(selectArtifact(artifacts, "darwin", "x64"), null);
  assert.equal(selectArtifact(artifacts, "linux"), null);
});
