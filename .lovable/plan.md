# 修复 macOS 客户端：无法退出 + 打开后跳到登录页

## 现象与原因

1. **无法关闭退出**：窗口的关闭事件被拦截改成“隐藏”，只有托盘的“退出 Agent”会先置退出标记。macOS 上按 Cmd+Q 或菜单退出时没有置这个标记，退出被自己拦截，于是客户端关不掉。
2. **跳到平台登录页**：客户端窗口加载的是平台上的 `/desktop` 页面，而这个页面之前已按要求从平台移除，访问不到就被引导到登录页。

## 修复方案

### 客户端可以正常退出
- 退出前统一置退出标记，Cmd+Q、菜单退出、托盘退出、升级重启都能真正结束进程。
- macOS 补上标准应用菜单（含“退出”和 Cmd+Q），窗口红点关闭仍收进托盘，符合 mac 习惯。
- 退出时仍向平台上报“离线”，但不阻塞退出。

### 客户端自带本机工作台
- 在客户端内新增本机工作台页面（随安装包一起打包），窗口直接加载本地文件，不再请求平台页面，因此不需要登录、断网也能打开。
- 工作台包含：
  - 顶部：节点标识、版本、平台地址、注册状态、在线/离线与待补传数量
  - 录制：填写起始地址，开始/停止录制，生成步骤后可上传到平台
  - 用例：拉取平台用例列表，选中后本机执行或调试，显示步骤状态
  - 任务：显示平台下发任务的执行进度
  - 日志：实时滚动日志，含离线补传提示
  - 操作：检查更新、下载浏览器内核、重新注册、打开平台端
- 托盘菜单原有入口（录制/执行/调试/上传/任务队列）改为切换本机工作台的对应板块。

## 技术细节

- `agent-app/main.cjs`：`before-quit` 中置 `app.isQuiting = true`；新增 `Menu.setApplicationMenu` 提供 mac 应用菜单；`win.loadFile` 指向新的本地工作台文件，移除对 `/desktop` 的 `loadURL`。
- 新增 `agent-app/workbench.html`（含内联样式与脚本，无外部依赖）与 `agent-app/workbench-preload.cjs`（沿用现有 `preload.cjs` 暴露的 IPC 通道；不足的通道在 preload 中补齐）。
- 复用已有 IPC：`agent:info`、`agent:register`、`agent:pull-cases`、`agent:upload-case`、`agent:run-case`、`agent:record-start/stop`、`agent:outbox`、`agent:flush-outbox`、`agent:prepare-browsers`、`agent:check-updates`，以及主进程推送的 `agent:log`、`agent:run-event`、`agent:run-done`、`agent:update-stage`、`agent:browser-stage`、`agent:tray-action`。
- 打包脚本与 CI 已用整个 `agent-app` 目录，新文件自动包含；确认 `--ignore` 规则不会排除新文件。

## 验证

- `node --check` 校验改动的 CJS 文件。
- 本地以 Electron 启动客户端，确认窗口显示本机工作台、不再出现登录页，Cmd+Q 与托盘退出都能结束进程。
- 拉取用例并本机执行一条，确认日志与状态回传平台。
