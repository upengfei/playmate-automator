# 让 Agent 变成真实可分发、真实执行的客户端

目标：Windows / macOS 真实安装包可下载分发；真实安装的 Agent 注册到平台并同步用例；本机用真实 Playwright 浏览器执行与录制。

## 1. 真实安装包（Windows / macOS / Linux）

- 用 @electron/packager 交叉打包 win32-x64、darwin-x64/arm64、linux-x64。
- 打包产物压缩为 zip / tar.gz，写入 `public/downloads/`，并按真实文件计算 SHA256 与体积。
- 版本清单接口 `/api/public/agent/version` 改为读取真实产物清单（不再写死示例哈希），下载页直接指向真实文件。
- 说明：沙箱内无法做代码签名与 macOS 公证，首次打开需「右键打开 / 允许运行」。安装包约 100–200 MB，超出静态托管单文件上限时，同时提供可直接下载的压缩包。

## 2. 真实注册与用例同步（接入 Lovable Cloud）

- 启用 Lovable Cloud，新建表：`agents`（节点信息、版本、心跳、能力）、`test_cases`（名称、模块、步骤 JSON、脚本、来源）、`agent_runs` + `run_logs`（执行结果与日志）。
- 新增公开接口（供本机 Agent 调用，带节点令牌校验）：
  - `POST /api/public/agent/register` 注册 + 心跳（写入真实节点）
  - `GET  /api/public/agent/cases` 拉取平台用例到本机
  - `POST /api/public/agent/cases` 上传本机录制的用例
  - `POST /api/public/agent/run-report` 回传执行状态、步骤结果与日志
- 平台端「执行节点管理」「用例管理」改为展示数据库中的真实节点与用例（演示数据保留为初始种子），上传后轮询自动出现。

## 3. 真实 Playwright 执行内核

- 客户端新增 `electron/runner.cjs`：用 `playwright` 启动真实 Chromium/Firefox/WebKit 实例，逐步执行用例步骤（goto/click/fill/waitFor/断言等），截图与失败产物存本地。
- 首次运行自动下载浏览器内核到用户目录（`PLAYWRIGHT_BROWSERS_PATH`），带进度提示。
- 每一步的开始/成功/失败通过 IPC 推给客户端界面，同时回传平台，任务详情页看到的是真实执行日志。
- 平台下发任务时，Agent 拉取用例 → 真实执行 → 回传结果。

## 4. 真实录制生成可执行脚本

- 录制按钮启动 Playwright 官方 codegen（真实浏览器窗口），用户操作被真实抓取。
- 录制结束解析生成的脚本为平台的步骤积木结构，客户端可预览、编辑、本地回放，再上传到平台。
- 上传后的用例在平台用例管理中可直接编排进任务并下发执行。

## 技术要点

- Electron 主进程为 Node 环境，可用 child_process 与 playwright；平台服务端（Worker）不执行浏览器。
- Agent 与平台之间仅通过 `/api/public/agent/*` HTTP 接口通信，节点令牌在首次注册时下发并保存在本地配置。
- 打包时 `playwright` 需随应用一起打包（不裁剪 node_modules），浏览器内核在首次运行时下载。

## 分批交付

1. 真实安装包 + 下载页接真实产物
2. Cloud 表与注册 / 用例同步接口 + 平台端接真实数据
3. Playwright 真实执行内核
4. 真实录制与脚本生成
