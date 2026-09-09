# 新增「AI 助手」

在左侧导航加一个独立的「AI 助手」节点，用对话方式生成用例、分析测试数据、辅助定位页面元素。

## 1. 对话生成用例

- 中文描述需求（例如「打开官网，登录后进入订单列表，断言标题包含订单」），AI 输出关键字步骤序列（复用现有关键字积木，包含条件与循环）。
- 生成结果在对话右侧以「步骤预览 + 实时 Playwright 脚本」展示，可逐步删除或调整顺序。
- 确认后点「保存为用例」才写入用例库（v1 版本快照），随后可直接跳到用例编排页；不确认则不落库。
- 支持追问式修改：「加一步截图」「把断言改成文本包含」，在同一预览上迭代。

## 2. AI 分析测试数据

- 对话里可问「最近失败最多的用例是什么」「通过率趋势如何」「这条失败原因是什么」。
- AI 通过工具读取本地 SQLite 的执行记录、任务、日志与用例统计（只读），给出结论、原因归类和改进建议，并附上引用到的用例/任务链接。
- 报告分析页增加一个「AI 摘要」按钮，一键生成当前筛选范围的分析结论，结果同样进入 AI 助手会话。

## 3. AI 页面元素定位

- 在 AI 助手里输入起始地址和目标描述（例如「登录按钮」），平台向已在线的 Agent 下发一次「页面抓取」指令。
- Agent 用本机 Playwright 打开页面，回传精简后的可交互元素清单（角色、文本、可访问名、候选定位）。
- AI 从清单里挑最稳定的定位方式并说明理由，可一键把该步骤插入当前生成中的用例预览。

## 技术方案

- 模型：Lovable AI（默认 `openai/gpt-6-astra`，Responses API 流式），密钥仅在服务端读取。
- 新增 `src/routes/api/chat.ts` 流式对话路由 + `src/routes/ai.tsx` 页面，聊天界面用 AI Elements（conversation / message / prompt-input / tool / shimmer）组合，工具调用折叠展示。
- 服务端工具（server-only）：
  - `generate_case_steps`：产出结构化步骤，字段与 `src/lib/keywords.ts` 的关键字一致，服务端校验非法关键字后再返回。
  - `query_case_stats` / `query_runs` / `query_run_logs`：只读封装 `src/lib/local-db.server.ts` 与 `platform.server.ts` 已有查询，不新增写操作。
  - `inspect_page`：在 `src/routes/api/public/agent/jobs.ts` 的任务类型上扩展一种 `inspect` 指令，Agent 侧新增 `agent-app/inspect.cjs` 抓取元素清单并回传。
- 保存用例走现有 `upsertCase` / 版本快照逻辑，AI 不直接写数据库。
- 导航：`src/components/platform-shell.tsx` 新增一级节点「AI 助手」，页面自带 `head()` 元信息。
- 报告页「AI 摘要」按钮复用同一对话接口，仅预置提示词。

## 不在本次范围

- AI 自动修复失败用例、AI 自动执行任务。
- 会话历史长期持久化（先保留当前页面内会话）。
