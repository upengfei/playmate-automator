# 验证：录制中的 Frame 切换步骤

录制器目前已经会自动记录 iframe 的进入与返回（含多层嵌套），这次的工作是用一个真实的嵌套 iframe 页面把整条链路跑通并给出证据。

## 要验证什么

1. 用一个带嵌套 iframe 的本地测试页面（外层 iframe 内再嵌一层），页面里放按钮、复选框、文本，主文档里也放一个按钮。
2. 走一遍录制流程，确认录制结果里自动出现「进入 Frame」「返回上层 Frame」步骤，顺序与操作一致，主文档操作不会被错误地留在 iframe 里。
3. 把录制出的步骤直接执行一次，确认每一步都命中正确的文档范围，日志与状态正常写入本地数据库。
4. 确认没有被静默丢弃的操作：不支持的语句会显示为「待转换步骤」并阻止上传/执行。

## 技术细节

- 用 Playwright 起一个本地静态页面（主文档 + 两层 iframe），驱动脚本放在 `/tmp` 下，不写入项目。
- 录制解析路径：`agent-app/recorder.cjs` 的 `parse()`（已支持 `page.frameLocator(...)` 链路归一化）。
- 执行路径：`agent-app/runner.cjs` 的 `framePath` 栈与 `switchFrame` / `parentFrame` / `mainFrame` 分支。
- 已有回归测试 `tests/recorder.test.cjs`、`tests/keyword-contract.test.cjs`、`tests/agent-runner.test.cjs` 一并跑一次。
- 如实测暴露缺陷（例如某类 codegen 语句未覆盖），在同一轮里修复录制解析或执行分支，并补一条对应测试。

## 交付

一份实测结论：录制得到的步骤列表、执行结果与日志摘要；若有修复，说明改了什么。
