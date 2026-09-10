# 客户端编排：一键清空 + 修复 iframe 里元素定位错误

## 1. iframe 元素定位显示的是 iframe 自己的定位（缺陷）

原因已确认：客户端内置的 Playwright 是 1.56，录制器生成的语句形如

```text
await page.locator('#outer').contentFrame().getByRole('button', { name: '保存' }).click();
```

而现在的解析只认旧写法 `page.frameLocator('#outer')`。遇到 `contentFrame()` 时，整串被当成普通元素表达式，取到的是第一个 `locator('#outer')`，也就是 iframe 本身的定位，于是所有 iframe 内步骤都显示成 iframe 的路径，且不会生成「进入 Frame」步骤。

修复：
- 解析时同时识别 `frameLocator('x')` 和 `locator('x').contentFrame()` / `getByRole(...).contentFrame()` 等写法，把它们统一还原成 Frame 路径。
- 支持多层嵌套与两种写法混用，Frame 定位统一转成平台的定位格式（role/label/text/testid 等也能当 iframe 定位）。
- 拖拽目标 `dragTo(...)` 里的第二个定位同样按新写法解析。
- iframe 内的元素只保留元素自身的定位，Frame 部分变成「进入 Frame」步骤。

## 2. 编排里的一键清空

现在已有：单步删除、上下移动、下拉选择关键字后「追加步骤」。缺的是清空。

新增：
- 工具栏加「清空步骤」按钮，点击后二次确认，清掉当前草稿的所有步骤并同步刷新右侧脚本预览。
- 步骤为空时按钮置灰。

## 技术细节

- 改动集中在 `agent-app/recorder.cjs`：新增 Frame 作用域切分逻辑（替换目前只匹配 `frameLocator` 的 `FRAME_SCOPE` 正则），`parseAction` / `parseExpectation` / `parseScopedLocator` 复用同一个切分结果。
- 无法安全表达的语句继续走「待转换步骤」，不静默丢弃。
- `agent-app/workbench.html` 增加清空按钮与禁用态；不改上传/执行逻辑。
- 在 `tests/recorder.test.cjs` 增加 `contentFrame()` 写法的用例：单层、嵌套、与旧写法混用、iframe 内 `dragTo`，断言生成的步骤与元素定位正确。
- 跑全量 `tests/*.test.cjs` 与构建，并用嵌套 iframe 的真实页面复跑一次录制到执行的链路。
