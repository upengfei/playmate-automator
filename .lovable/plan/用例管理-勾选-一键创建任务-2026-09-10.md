# 用例管理：勾选 + 一键创建任务

## 目标
用例管理列表支持勾选（表头一键全选当前筛选结果），勾选后一键创建任务并直接跳到任务详情页。

## 现状
- `src/routes/cases.index.tsx` 已有模块/状态/关键字筛选，模块过滤本身已可用。
- 任务创建复用 `src/lib/store.ts` 的 `createTask()`（走本地 SQLite，参数：name/caseIds/agentId/env/browser/concurrency/retry）。
- 任务详情页 `/tasks/$taskId` 已存在，可在其中下发。

## 改动（仅 `src/routes/cases.index.tsx`）
1. **勾选列**
   - 表格首列加复选框；表头复选框 = 全选/取消全选「当前筛选结果」（`list`），支持半选状态。
   - 选中状态用 `useState<string[]>` 保存；筛选条件变化时保留仍存在于筛选结果中的勾选，剔除已不可见的。
2. **批量操作条**
   - 有勾选时在筛选栏下方出现操作条：显示「已选 N 个用例」、按钮「创建任务」「清空」。
3. **一键创建任务**
   - 任务名自动生成：`批量任务（模块名 或 筛选）+ 日期`。
   - 默认参数：第一台在线节点（无在线节点时用第一台节点）、环境「测试环境」、浏览器 Chromium、并发/重试取系统配置默认值。
   - 无任何节点时 toast 提示先注册节点，不创建。
   - 创建成功 toast 提示并 `navigate` 到 `/tasks/$taskId` 详情页，用户可在详情页确认后下发。
4. 勾选与筛选联动说明文案：表头复选框 aria-label「全选当前筛选结果」。

## 技术说明
- 不改数据库、不改 store 接口；仅列表页前端逻辑 + 复用 `createTask`。
- 复用现有 `Checkbox` 组件（`@/components/ui/checkbox`）。
- 验证：`bunx tsgo --noEmit`，浏览器打开 `/cases` 实测勾选、全选、创建任务跳转。
