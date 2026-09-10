const { test } = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { loadModule } = require("./helpers.cjs");

function fixture(save) {
  const messages = [],
    navigations = [];
  const widget = () => null;
  const components = new Proxy({}, { get: () => widget });
  const modules = Object.fromEntries(
    [
      "lucide-react",
      "@/components/platform-shell",
      "@/components/block-editor",
      "@/components/step-flow",
      "@/components/case-versions",
      "@/components/param-preview",
      "@/components/ui-bits",
      "@/components/ui/button",
      "@/components/ui/input",
      "@/components/ui/label",
      "@/components/ui/select",
    ].map((name) => [name, components]),
  );
  Object.assign(modules, {
    react: { ...React, useState: (value) => [value, () => {}], useEffect() {} },
    "@tanstack/react-router": {
      createFileRoute: () => (opts) => ({ ...opts, useParams: () => ({ caseId: "case-test" }) }),
      useNavigate: () => async (args) => navigations.push(args),
      Link: widget,
    },
    sonner: {
      toast: {
        success: (text) => messages.push(["success", text]),
        error: (text) => messages.push(["error", text]),
      },
    },
    "@/components/case-params": { CaseParamsEditor: widget, extractParamNames: () => [] },
    "@/lib/keywords": { generatePlaywrightCode: () => "" },
    "@/lib/store": {
      useAppStore: () => ({ cases: [{ id: "case-test", name: "test", steps: [] }], loaded: true }),
      upsertCase: save,
    },
  });
  const { Route } = loadModule("src/routes/cases.$caseId.tsx", { modules });
  const tree = Route.component();
  function findSave(node) {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) return node.map(findSave).find(Boolean);
    if (node.props?.onClick && React.Children.toArray(node.props.children).includes("保存用例"))
      return node;
    return findSave(node.props?.action) || findSave(node.props?.children);
  }
  return { saveButton: findSave(tree), messages, navigations };
}

test("saving only reports success and navigates after persistence completes", async () => {
  let complete;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const f = fixture(() => pending);
  const clicked = f.saveButton.props.onClick();
  assert.deepEqual(f.messages, []);
  assert.deepEqual(f.navigations, []);
  complete();
  await clicked;
  assert.equal(f.messages[0][0], "success");
  assert.equal(f.navigations.length, 1);
});

test("failed saves show an error and keep the editor open", async () => {
  const f = fixture(async () => {
    throw new Error("database unavailable");
  });
  await f.saveButton.props.onClick();
  assert.deepEqual(f.messages, [["error", "database unavailable"]]);
  assert.deepEqual(f.navigations, []);
});
