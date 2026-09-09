# 系统配置拆成二级菜单

现在系统配置是一整页四个面板加参数绑定。按功能拆成独立页面，挂在左侧导航「系统配置」分组下。

## 新的导航结构

```text
系统配置            ← 分组首节点，点击展开/收起
  ├ 基础信息        /settings          （平台名称、报告保留天数等）
  ├ Agent 与节点校验 /settings/agents  （最低版本、心跳超时等）
  ├ 执行策略        /settings/execution（并发、重试、超时等）
  ├ 通知            /settings/notify   （失败通知方式）
  └ 参数绑定        /settings/params   （环境 / 设备参数取值）
```

## 交互细节

- 分组行为与「任务管理」「Agent 管理」一致：首节点只展开收起，进入任意子页时自动展开并高亮。
- 每个子页保留原有的标题、说明和「保存配置」按钮，字段与保存逻辑完全不变。
- 参数绑定页保留现有的新增 / 删除绑定表格。
- 窄屏顶部横向导航同样列出这五个子页。

## 技术说明

- 把 `src/routes/settings.tsx` 改为只渲染 `<Outlet />` 的布局路由，页面内容移到 `src/routes/settings.index.tsx`（基础信息）以及新建的 `settings.agents.tsx`、`settings.execution.tsx`、`settings.notify.tsx`、`settings.params.tsx`。
- 共用的 `Row` 小组件和保存按钮抽到 `src/components/settings-shell.tsx`，各子页包一层，避免重复。
- 每个子页有独立的 `head()` 标题与描述。
- `src/components/platform-shell.tsx` 的 `NAV` 增加「系统配置」分组及五个子项，复用已有分组渲染逻辑。
- 数据层（`useAppStore`、`updateSettings`、参数绑定接口）不做任何改动。
