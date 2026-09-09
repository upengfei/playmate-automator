# 客户端首次启动改为「令牌配置」向导

目标：客户端第一次打开时必须先完成配置窗口，填写平台地址与平台下发的节点令牌，验证成功后才进入工作台。

## 用户看到的变化

1. 首次打开只出现配置窗口（无工作台、无托盘任务轮询），标题「首次使用配置」。
2. 表单两项：平台地址、节点令牌（原「设备标识 / 节点 ID」输入框移除）。
3. 点「验证并进入」后客户端把令牌交给平台校验：
   - 成功：显示平台上登记的设备名称与标识，短暂提示后自动进入工作台。
   - 失败（令牌错误 / 平台不可达）：留在配置窗口，显示具体原因，可修改重试。
4. 关闭配置窗口而没有完成验证 → 客户端直接退出，不会进入未配置状态的工作台。
5. 设备名称沿用平台注册设备时填写的名称，客户端不再要求用户输入。
6. 说明文字改为：令牌在平台「客户端下载更新」页注册设备后复制。

## 技术要点

### 平台侧
- 新增 `src/routes/api/public/agent/resolve.ts`：`POST { token }`，在本地 SQLite `agent_tokens` 中按令牌反查 `agent_id`，再从 `agents` 表取登记名称，返回 `{ ok, agentId, name }`；令牌无效返回 401。做基本长度校验，不回显任何其他设备信息。
- `src/lib/agent-store.server.ts` 增加 `findByToken(token)`（SQLite 查询 + Supabase 回退实现保持一致签名）。

### 客户端侧（agent-app）
- `setup.html` / `setup-preload.cjs`：输入项改为平台地址 + 令牌；新增 `verify` 通道展示解析出的设备名称。
- `main.cjs`
  - `openSetup()` 的 `agent-setup:register` 改为 `agent-setup:verify`：先调用 `/api/public/agent/resolve` 换出 `agentId`/`name`，写入本地配置（`platformUrl`、`agentId`、`token`），再调用一次 `platform.register("在线")` 确认心跳成功。
  - `whenReady`：`if (!cfg().token) { const ok = await openSetup(); if (!ok) { app.isQuiting = true; app.quit(); return; } }` —— 未完成配置不创建主窗口、托盘和各类轮询定时器。
  - 配置窗口关闭时若仍无令牌，resolve(false) 触发退出。
- `platform.cjs`：`defaultConfig()` 的 `agentId` 不再作为用户可填项（仍保留主机名兜底，供解析失败前的占位），新增 `agentName` 字段用于工作台显示。
- 工作台顶部信息与托盘提示中的「节点 ID」文案统一改为「节点令牌 / 设备」，避免歧义。

### 验证
- 平台注册一台设备取得令牌，用该令牌走 resolve 接口确认返回正确 `agentId` 与名称；错误令牌返回 401。
- CJS 语法检查、类型检查、构建。
- 沙箱无法真实启动 Electron 窗口，配置窗口的交互以 IPC 逻辑与接口返回为准验证。
