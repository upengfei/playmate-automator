# AI 元素抓取：加页面截图 + 元素缓存

目标：AI 让客户端抓一次页面后，结果（含截图和元素属性）在平台缓存一段时间，短时间内再问同一个页面直接用缓存，不再反复驱动浏览器；客户端空闲时也降低轮询频率。

## 会有什么变化

1. **抓取结果带页面截图**：客户端抓元素时同时截一张页面截图，回传平台。AI 分析和定位推荐时可以配合截图，聊天里也能看到这张截图。
2. **元素属性更全**：除现有 id / name / placeholder / aria-label / data-testid / href 外，再抓 class、title、alt、value、type、是否禁用、是否唯一匹配、元素在页面中的位置与大小，并给出多个候选定位方式（推荐 role+名称、testid、id、文本），标注哪个最稳定。
3. **平台侧缓存**：同一个页面地址在缓存有效期内（默认 10 分钟）再次抓取时，直接返回上次结果，并说明「来自缓存，抓取于 X 分钟前」。需要最新页面时可要求重新抓取。
4. **客户端不再频繁刷新**：抓取指令轮询从固定 3 秒改为自适应——刚有任务时保持 3 秒，连续空闲 2 分钟后降到 15 秒，有新任务再立刻恢复。
5. **系统配置里可调**：AI 设置页新增「元素抓取缓存有效期（分钟）」和「是否保存页面截图」两项。

## 技术说明

- `src/lib/local-db.server.ts`：`agent_inspects` 增加 `screenshot`（JPEG base64，上限约 600KB，超出则压缩后再存）、`url_key`（归一化地址，去掉 hash 与追踪参数）、`viewport` 列，并加 `idx_inspects_url(url_key, status, finished_at)` 索引；`ai_settings` 增加 `inspect_cache_minutes`、`inspect_screenshot` 两列，DDL 用 `ALTER TABLE ... ADD COLUMN` 兼容已有库。
- `agent-app/inspect.cjs`：抓取后 `page.screenshot({ type: "jpeg", quality: 60, fullPage: false })` 转 base64；`page.evaluate` 扩充属性采集与候选定位器，用 `document.querySelectorAll(sel).length === 1` 判断唯一性。
- `agent-app/main.cjs`：轮询间隔改为自适应（3s / 15s），抓到任务立即回到快频；`agent-app/platform.cjs` 的 `reportInspect` 带上 `screenshot`、`viewport`。
- `src/routes/api/public/agent/inspect.ts`：POST 的 zod schema 接受新字段并限制截图大小；元素 schema 扩充 `candidates`、`unique`、`box`。
- `src/lib/ai-tools.server.ts`：`inspect_page` 先按 `url_key` 查最近一条「已完成」记录，命中缓存（在有效期内且未要求刷新）直接返回，附 `cached: true`、`capturedAt`、`screenshotUrl`；未命中才插入抓取指令。工具入参新增 `refresh`（默认 false）。
- 新增受登录保护的截图读取路由 `src/routes/api/inspect-shot.$id.ts`，按 id 返回 JPEG，供 AI 页面显示；不放在 `api/public` 下。
- `src/routes/ai.tsx`：当工具结果带 `screenshotUrl` 时在对话区显示缩略图，并标注是否来自缓存。
- `src/lib/ai-settings.server.ts` 与 `src/routes/settings.ai.tsx`：读写并展示新的缓存有效期与截图开关。
- 不改用例、任务、执行链路的任何业务逻辑。

## 验证

- 用一台已注册设备触发抓取，确认截图与扩充属性写入本地数据库。
- 连续两次让 AI 抓同一页面，确认第二次命中缓存且客户端没有再启动浏览器。
- 确认客户端空闲后轮询降频、来新任务后立刻恢复。
- 类型检查、客户端 CJS 语法检查与构建通过。
