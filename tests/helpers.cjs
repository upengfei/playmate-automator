const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { createRequire } = require("node:module");
const { runInNewContext } = require("node:vm");
const ts = require("typescript");

// Execute actual modules with only process/IO boundaries replaced. TS is
// transpiled for Node's test runner; the project typecheck is run separately.
function loadModule(relative, { modules = {}, globals = {}, expose = "" } = {}) {
  const filename = resolve(__dirname, "..", relative);
  const localRequire = createRequire(filename);
  let source = readFileSync(filename, "utf8");
  if (/\.tsx?$/.test(filename)) {
    source = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText;
  }
  const module = { exports: {} };
  runInNewContext(
    source + "\n" + expose,
    {
      module,
      exports: module.exports,
      require: (name) => (Object.hasOwn(modules, name) ? modules[name] : localRequire(name)),
      __dirname: dirname(filename),
      __filename: filename,
      process,
      console,
      Buffer,
      URL,
      Request,
      Response,
      Error,
      crypto: require("node:crypto").webcrypto,
      ...globals,
    },
    { filename },
  );
  return module.exports;
}

module.exports = { loadModule };
