# 「按键」关键字改为下拉选择，定位改为选填

## 目标

1. 编排步骤里的「按键」积木，按键值从手工输入改成下拉选择常用按键（Enter、Tab、Escape、方向键、Backspace、Delete、空格、Ctrl+A 等），仍可手动填写自定义按键。
2. 「按键」的定位器改为选填：留空时按键发送给整个页面（等价于键盘直接输入），填了就发送给指定元素。
3. 定位器输入框支持变量，写 `${参数名}` 或 `{{参数名}}` 都能在下发时替换成绑定值，并在参数预览里一起展示。

## 界面表现

- 按键积木上出现一个按键下拉框，最后一项为「自定义…」，选中后旁边出现输入框填写任意按键组合。
- 定位器输入框的占位提示变为「定位器（选填，可用 ${变量}）」。
- 定位器里用到的变量名，会和文本里的变量一样出现在用例详情页的参数列表和替换预览中。

## 技术细节

- `src/lib/keywords.ts`
  - `KeywordDef` 增加 `optionalTarget?: boolean` 与 `valueOptions?: { value: string; label: string }[]`。
  - `press` 关键字：`optionalTarget: true`，附常用按键选项；模板改为定位器为空时生成 `await page.keyboard.press(...)`，非空时保持 `page.locator(...).press(...)`。
- `src/components/block-editor.tsx`
  - 有 `valueOptions` 时渲染下拉（`@/components/ui/select`），值不在选项内时切到自定义输入框。
  - `optionalTarget` 的关键字，定位器占位符标注「选填」，不做必填校验。
- 变量支持：定位器已走 `applyParams`（`src/lib/case-params.server.ts`）替换，需确认收集变量名的地方同时扫描 `target` 与 `value`；若只扫描 `value`，补上 `target`，让参数预览与 `missingParams` 一致。
- 已有用例的 `press` 步骤保持兼容：原来填了定位器的照旧执行。
