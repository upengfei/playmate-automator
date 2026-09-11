const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function repo() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "playflow-local-")), "local-cases.json");
  process.env["PLAYFLOW_LOCAL_CASE_FILE"] = file;
  delete require.cache[require.resolve("../agent-app/local-cases.cjs")];
  return require("../agent-app/local-cases.cjs");
}

test("local repository saves, reads, renames and deletes recorded cases", () => {
  const store = repo();
  assert.deepEqual(store.list(), []);

  const saved = store.save({
    name: "登录流程",
    startUrl: "https://example.test",
    steps: [{ keyword: "goto", target: "", value: "https://example.test" }],
    script: "// script",
  });
  assert.ok(saved.id);
  assert.equal(saved.source, "本地录制");
  assert.equal(store.list().length, 1);
  assert.equal(store.get(saved.id).name, "登录流程");

  const updated = store.save({ ...saved, name: "登录流程 v2", steps: [] });
  assert.equal(store.list().length, 1);
  assert.equal(updated.name, "登录流程 v2");

  assert.equal(store.rename(saved.id, "改名后").name, "改名后");
  assert.deepEqual(store.remove(saved.id), { removed: 1 });
  assert.deepEqual(store.list(), []);
  assert.equal(store.get(saved.id), null);
});

test("local repository falls back to an empty list when the file is broken", () => {
  const store = repo();
  fs.mkdirSync(path.dirname(store.repoFile()), { recursive: true });
  fs.writeFileSync(store.repoFile(), "not json", "utf8");
  assert.deepEqual(store.list(), []);
  assert.ok(store.save({ name: "恢复用例" }).id);
  assert.equal(store.list().length, 1);
});
