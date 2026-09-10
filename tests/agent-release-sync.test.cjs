const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { loadModule } = require("./helpers.cjs");

function fixture({ timeoutMs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "playflow-release-test-"));
  const database = loadModule("src/lib/local-db.server.ts", {
    globals: { process: { env: { CASE_DB_FILE: join(dir, "cases.db") } } },
  });
  const fleet = loadModule("src/lib/agent-fleet.server.ts", {
    modules: {
      "./local-db.server": database,
      "./agent-artifacts": loadModule("src/lib/agent-artifacts.ts"),
    },
    globals: {
      fetch,
      AbortSignal: timeoutMs ? { timeout: () => AbortSignal.timeout(timeoutMs) } : AbortSignal,
    },
  });
  return { fleet, database, dir };
}

function published(version = "1.8.3") {
  const base = `https://github.com/upengfei/playmate-automator/releases/download/agent-v${version}`;
  const targets = [
    ["win", "x64", "zip"],
    ["darwin", "arm64", "zip"],
    ["linux", "x64", "tar.gz"],
  ];
  const artifacts = targets.map(([platform, arch, ext]) => ({
    platform,
    file: `PlayFlowAgent-${version}-${platform}-${arch}.${ext}`,
    sizeMB: 99,
    sha256: "a".repeat(64),
    url: `${base}/PlayFlowAgent-${version}-${platform}-${arch}.${ext}`,
  }));
  const manifest = { version, artifacts };
  const metadata = {
    tag_name: `agent-v${version}`,
    draft: false,
    prerelease: false,
    published_at: "2026-09-10T05:07:07Z",
    body: "修复客户端交付",
    assets: [
      ...artifacts.map((a) => ({
        name: a.file,
        browser_download_url: a.url,
        size: 104857600,
        state: "uploaded",
        digest: `sha256:${a.sha256}`,
      })),
      {
        name: "agent-release.json",
        browser_download_url: `${base}/agent-release.json`,
        size: 920,
        state: "uploaded",
      },
    ],
  };
  return {
    metadata,
    manifest,
    fetch: async (url) =>
      Response.json(String(url).endsWith("agent-release.json") ? manifest : metadata),
  };
}

test("an empty platform with no GitHub connection has no fabricated Agent release", async () => {
  const { fleet } = fixture();
  const service = fleet.createReleaseService({
    fetch: async () => {
      throw new Error("offline");
    },
  });
  const state = await service.read();
  assert.equal(state.release, null);
  assert.equal(state.sync.status, "failed");
  assert.ok(state.sync.lastAttemptAt);
});

test("a complete published release supplies pinned downloads and survives a service restart", async () => {
  const { fleet } = fixture();
  const upstream = published();
  const service = fleet.createReleaseService({ fetch: upstream.fetch });
  const state = await service.read();
  assert.equal(state.release.version, "1.8.3");
  assert.equal(
    state.release.artifacts[1].url,
    "https://github.com/upengfei/playmate-automator/releases/download/agent-v1.8.3/PlayFlowAgent-1.8.3-darwin-arm64.zip",
  );
  assert.equal(state.release.artifacts[1].sizeMB, 100);
  assert.equal(state.release.publishedAt, "2026-09-10T05:07:07Z");
  assert.equal(state.release.notes[0], "修复客户端交付");
  assert.equal(state.sync.status, "synced");
  const restarted = fleet.createReleaseService({
    fetch: async () => {
      throw new Error("offline");
    },
  });
  assert.equal((await restarted.read()).release.version, "1.8.3");
});

test("the version API reports unavailable instead of offering an upgrade from an empty store", async () => {
  const { fleet } = fixture();
  const service = fleet.createReleaseService({
    fetch: async () => {
      throw new Error("offline");
    },
  });
  const { Route } = loadModule("src/routes/api/public/agent/version.ts", {
    modules: {
      "@tanstack/react-router": { createFileRoute: () => (options) => options },
      "@/lib/agent-artifacts": loadModule("src/lib/agent-artifacts.ts"),
      "@/lib/agent-fleet.server": { ...fleet, readRelease: service.read },
    },
  });
  const response = await Route.server.handlers.GET({
    request: new Request(
      "https://platform.test/api/public/agent/version?platform=darwin&arch=arm64",
    ),
  });
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.error, "release_unavailable");
  assert.equal(data.version, undefined);
});

test("cached release reads share refresh work, respect cooldowns, and retain valid data offline", async () => {
  const { fleet } = fixture();
  let now = Date.parse("2026-09-10T06:00:00Z");
  let upstream = published();
  let requests = 0;
  const service = fleet.createReleaseService({
    now: () => now,
    fetch: async (...args) => {
      requests++;
      return upstream.fetch(...args);
    },
  });
  await Promise.all([service.read(), service.read(), service.read()]);
  assert.equal(
    requests,
    2,
    "one GitHub metadata request and one manifest request for concurrent readers",
  );
  upstream = published("1.8.4");
  assert.equal((await service.read()).release.version, "1.8.3");
  assert.equal((await service.read({ force: true })).release.version, "1.8.3");
  now += 61000;
  assert.equal((await service.read({ force: true })).release.version, "1.8.4");
  now += 301000;
  upstream = {
    fetch: async () => {
      throw new Error("offline");
    },
  };
  const cached = await service.read();
  assert.equal(cached.release.version, "1.8.4");
  const failed = await service.read({ force: true });
  assert.equal(failed.release.version, "1.8.4");
  assert.equal(failed.sync.status, "failed");
  const before = requests;
  await service.read({ force: true });
  assert.equal(requests, before);
});

test("an incomplete new release never replaces the last valid three-platform release", async () => {
  const { fleet } = fixture();
  let upstream = published();
  let now = Date.now();
  const service = fleet.createReleaseService({
    now: () => now,
    fetch: (...args) => upstream.fetch(...args),
  });
  await service.read();
  upstream = published("1.8.4");
  upstream.manifest.artifacts.pop();
  now += 61000;
  const result = await service.read({ force: true });
  assert.equal(result.release.version, "1.8.3");
  assert.equal(result.sync.status, "failed");
});

test("CI and synchronization cannot downgrade or silently replace published binaries", async () => {
  const { fleet } = fixture();
  let upstream = published("1.8.4");
  let now = Date.now();
  const service = fleet.createReleaseService({
    now: () => now,
    fetch: (...args) => upstream.fetch(...args),
  });
  await service.read();
  upstream = published("1.8.3");
  assert.equal((await service.publish(upstream.manifest)).ok, false);
  assert.equal((await service.read()).release.version, "1.8.4");
  upstream = published("1.8.4");
  assert.equal((await service.publish(upstream.manifest)).ok, true);
  upstream.manifest.artifacts[0].sha256 = "b".repeat(64);
  upstream.metadata.assets[0].digest = `sha256:${"b".repeat(64)}`;
  now += 61000;
  const replaced = await service.read({ force: true });
  assert.equal(replaced.sync.status, "failed");
  assert.equal(replaced.release.artifacts[0].sha256, "a".repeat(64));
});

test("a non-Agent latest release falls back to a stable Agent release, skipping drafts and previews", async () => {
  const { fleet } = fixture();
  const upstream = published();
  const preview = { ...published("1.8.5").metadata, prerelease: true };
  const draft = { ...published("1.8.6").metadata, draft: true };
  const service = fleet.createReleaseService({
    fetch: async (url) => {
      if (String(url).endsWith("/latest"))
        return Response.json({ ...upstream.metadata, tag_name: "web-v2.0.0" });
      if (String(url).includes("?")) return Response.json([preview, draft, upstream.metadata]);
      return upstream.fetch(url);
    },
  });
  assert.equal((await service.read()).release.version, "1.8.3");
});

test("GitHub Retry-After also prevents manual refreshes until the server's retry time", async () => {
  const { fleet } = fixture();
  let now = Date.parse("2026-09-10T06:00:00Z");
  let requests = 0;
  const service = fleet.createReleaseService({
    now: () => now,
    fetch: async () => {
      requests++;
      return new Response("rate limited", { status: 429, headers: { "Retry-After": "120" } });
    },
  });
  const failed = await service.read();
  assert.equal(failed.sync.retryAt, "2026-09-10T06:02:00.000Z");
  now += 61000;
  await service.read({ force: true });
  assert.equal(requests, 1);
  now += 61000;
  await service.read({ force: true });
  assert.equal(requests, 2);
});

test("CI registration verifies the uploaded manifest instead of trusting a different payload", async () => {
  const { fleet } = fixture();
  const upstream = published();
  const service = fleet.createReleaseService({ fetch: upstream.fetch });
  const input = structuredClone(upstream.manifest);
  upstream.manifest.artifacts[0].sha256 = "b".repeat(64);
  // No GitHub digest available: the uploaded manifest still has to agree with CI.
  delete upstream.metadata.assets[0].digest;
  assert.equal((await service.publish(input)).ok, false);
});

test("failed database switches preserve the previous published version even after restart", async () => {
  const { fleet, dir } = fixture();
  let upstream = published();
  let now = Date.now();
  const service = fleet.createReleaseService({
    now: () => now,
    fetch: (...args) => upstream.fetch(...args),
  });
  await service.read();
  const { DatabaseSync } = require("node:sqlite");
  const connection = new DatabaseSync(join(dir, "cases.db"));
  connection.exec(
    "CREATE TRIGGER reject_release BEFORE INSERT ON agent_releases BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;",
  );
  connection.close();
  upstream = published("1.8.4");
  now += 61000;
  assert.equal((await service.read({ force: true })).sync.status, "failed");
  const restarted = fleet.createReleaseService({
    fetch: async () => {
      throw new Error("offline");
    },
  });
  assert.equal((await restarted.read()).release.version, "1.8.3");
});

test("invalid manifests and asset metadata never become the published Agent version", async (t) => {
  const cases = {
    "version mismatch": (u) => {
      u.manifest.version = "1.8.8";
    },
    "duplicate target": (u) => {
      u.manifest.artifacts[2] = u.manifest.artifacts[0];
    },
    "wrong platform": (u) => {
      u.manifest.artifacts[1].platform = "win";
    },
    "invalid checksum": (u) => {
      u.manifest.artifacts[1].sha256 = "bad";
    },
    "checksum mismatch": (u) => {
      u.metadata.assets[0].digest = `sha256:${"b".repeat(64)}`;
    },
    "wrong URL": (u) => {
      u.manifest.artifacts[0].url = "https://other.test/agent.zip";
    },
    "missing asset": (u) => {
      u.metadata.assets.splice(0, 1);
    },
    "empty asset": (u) => {
      u.metadata.assets[0].size = 0;
    },
    "unfinished asset": (u) => {
      u.metadata.assets[0].state = "new";
    },
    "missing manifest": (u) => {
      u.metadata.assets.pop();
    },
    "wrong manifest URL": (u) => {
      u.metadata.assets.at(-1).browser_download_url = "https://other.test/agent-release.json";
    },
    "malformed JSON": (u) => {
      u.fetch = async (url) =>
        String(url).endsWith("agent-release.json") ? new Response("{") : Response.json(u.metadata);
    },
  };
  for (const [name, mutate] of Object.entries(cases))
    await t.test(name, async () => {
      const { fleet } = fixture();
      const upstream = published();
      mutate(upstream);
      const state = await fleet.createReleaseService({ fetch: upstream.fetch }).read();
      assert.equal(state.release, null);
      assert.equal(state.sync.status, "failed");
    });
});

test("published API downloads match the shared release, and unsupported architectures get no package", async () => {
  const { fleet } = fixture();
  const service = fleet.createReleaseService({ fetch: published().fetch });
  const publishedState = await service.read();
  const { Route } = loadModule("src/routes/api/public/agent/version.ts", {
    modules: {
      "@tanstack/react-router": { createFileRoute: () => (options) => options },
      "@/lib/agent-artifacts": loadModule("src/lib/agent-artifacts.ts"),
      "@/lib/agent-fleet.server": { ...fleet, readRelease: service.read },
    },
  });
  for (const [platform, arch, expected] of [
    ["darwin", "arm64", "PlayFlowAgent-1.8.3-darwin-arm64.zip"],
    ["darwin", "x64", null],
    ["win", "x64", "PlayFlowAgent-1.8.3-win-x64.zip"],
    ["linux", "x64", "PlayFlowAgent-1.8.3-linux-x64.tar.gz"],
  ]) {
    const response = await Route.server.handlers.GET({
      request: new Request(
        `https://platform.test/api/public/agent/version?platform=${platform}&arch=${arch}`,
      ),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.version, publishedState.release.version);
    assert.equal(data.artifact?.file ?? null, expected);
    assert.deepEqual(data.artifacts, JSON.parse(JSON.stringify(publishedState.release.artifacts)));
  }
});

test("invalid derived release notes cannot replace durable valid metadata", async () => {
  const { fleet } = fixture();
  let upstream = published();
  let now = Date.now();
  const service = fleet.createReleaseService({
    now: () => now,
    fetch: (...args) => upstream.fetch(...args),
  });
  await service.read();
  upstream = published("1.8.4");
  upstream.metadata.body = "x".repeat(10001);
  now += 61000;
  await service.read({ force: true });
  const restarted = fleet.createReleaseService({
    fetch: async () => {
      throw new Error("offline");
    },
  });
  assert.equal((await restarted.read({ force: true })).release.version, "1.8.3");
});

test("metadata and manifest requests share one deadline and a timeout leaves no fabricated release", async () => {
  const { fleet } = fixture({ timeoutMs: 40 });
  const upstream = published();
  const seenSignals = [];
  const service = fleet.createReleaseService({
    fetch: async (url, { signal }) => {
      seenSignals.push(signal);
      if (String(url).endsWith("/latest")) return upstream.fetch(url);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve(upstream.fetch(url)), 200);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    },
  });
  const state = await service.read();
  assert.equal(state.release, null);
  assert.equal(state.sync.status, "failed");
  assert.equal(seenSignals.length, 2);
  assert.equal(seenSignals[0], seenSignals[1]);
  assert.equal(seenSignals[0].aborted, true);
});

test("CI registration accepts the same valid metadata as GitHub sync and still requires its token", async () => {
  const { fleet } = fixture();
  const upstream = published();
  upstream.manifest.notes = ["n".repeat(301)];
  upstream.manifest.publishedAt = "2026-09-10T05:07:07.000Z";
  const service = fleet.createReleaseService({ fetch: upstream.fetch });
  const { Route } = loadModule("src/routes/api/public/agent/release.ts", {
    modules: {
      "@tanstack/react-router": { createFileRoute: () => (options) => options },
      "@/lib/agent-fleet.server": { ...fleet, publishRelease: service.publish },
    },
    globals: { process: { env: { AGENT_RELEASE_TOKEN: "test-release-token" } } },
  });
  const post = (token) =>
    Route.server.handlers.POST({
      request: new Request("https://platform.test/api/public/agent/release", {
        method: "POST",
        headers: { "x-release-token": token, "content-type": "application/json" },
        body: JSON.stringify(upstream.manifest),
      }),
    });
  assert.equal((await post("wrong-token")).status, 401);
  assert.equal((await post("test-release-token")).status, 200);
});

test("a slow old synchronization observes the newer version committed by another service", async () => {
  const { fleet } = fixture();
  const old = published();
  let releaseManifest;
  const manifestReady = new Promise((resolve) => {
    releaseManifest = resolve;
  });
  let started;
  const manifestStarted = new Promise((resolve) => {
    started = resolve;
  });
  const slow = fleet.createReleaseService({
    fetch: async (url) => {
      if (String(url).endsWith("agent-release.json")) {
        started();
        await manifestReady;
      }
      return old.fetch(url);
    },
  });
  const pending = slow.read();
  await manifestStarted;
  const newer = fleet.createReleaseService({ fetch: published("1.8.4").fetch });
  assert.equal((await newer.read()).release.version, "1.8.4");
  releaseManifest();
  const result = await pending;
  assert.equal(result.release.version, "1.8.4");
  assert.equal(result.sync.status, "failed");
  assert.equal((await newer.read()).release.version, "1.8.4");
});

test("the platform snapshot shares the version API's nullable release and published assets", async () => {
  const { fleet, database, dir } = fixture();
  let now = Date.now();
  let upstream = {
    fetch: async () => {
      throw new Error("offline");
    },
  };
  const service = fleet.createReleaseService({
    now: () => now,
    fetch: (...args) => upstream.fetch(...args),
  });
  const globals = {
    process: { env: { CASE_DB_DRIVER: "sqlite", CASE_DB_FILE: join(dir, "cases.db") } },
  };
  const repoModules = {};
  const repo = loadModule("src/lib/case-repo.server.ts", { modules: repoModules, globals });
  repoModules["./case-repo-sqlite.server"] = loadModule("src/lib/case-repo-sqlite.server.ts", {
    modules: { "./case-repo.server": repo },
    globals,
  });
  const platform = loadModule("src/lib/platform.server.ts", {
    modules: {
      "./local-db.server": database,
      "./agent-fleet.server": { ...fleet, readRelease: service.read },
      "./case-repo.server": repo,
      "./case-params.server": loadModule("src/lib/case-params.server.ts", {
        modules: { "./keywords": loadModule("src/lib/keywords.ts") },
      }),
    },
  });
  const empty = await platform.loadSnapshot();
  assert.equal(empty.release, null);
  assert.equal(empty.releaseSync.status, "failed");
  assert.equal(empty.cases.length, 0);
  now += 61000;
  upstream = published();
  const snapshot = await platform.loadSnapshot();
  const shared = await service.read();
  assert.equal(snapshot.release.version, "1.8.3");
  assert.equal(snapshot.releaseSync.status, shared.sync.status);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        snapshot.release.artifacts.map((a) => ({ file: a.file, sha256: a.sha256, url: a.url })),
      ),
    ),
    JSON.parse(
      JSON.stringify(
        shared.release.artifacts.map((a) => ({ file: a.file, sha256: a.sha256, url: a.url })),
      ),
    ),
  );
});
