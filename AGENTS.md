# AGENTS.md — AI 编码代理项目说明

面向 AI 编码代理（ZCode / Claude 等）的项目指南。修改代码前请先读完本文。

## 项目概述

A 股看板应用（个人学习用）：浏览器 SPA + Tauri 2 PC 客户端共用同一套 Vue 3.5 + TypeScript 前端。

- 页面：市场总览 / 自选股 / 行情全景（A股·美股·全球宏观）/ 资金动向 / 涨停与异动 / 龙虎榜·大宗 / 选股器（基础筛选·信号扫描·尾盘选股）/ 设置
- 数据源：[stock-sdk](https://stock-sdk.linkdiary.cn/)（腾讯 + 东方财富）
- 详情交互：全站「跳个股详情」一律打开右侧停靠面板（`stores/dock-panel.ts` 的 `openStock()`），不走路由

## 常用命令

```bash
pnpm dev          # 浏览器开发（vite，含 /stock-proxy 本地代理中间件）
pnpm tauri dev    # PC 客户端开发（Rust 直连数据源，无 CORS）
pnpm build        # vue-tsc 类型检查 + vite 构建
pnpm lint         # ESLint（提交前必须 0 error / 0 warning）
pnpm tauri build  # Windows 安装包（msi + nsis，产出 src-tauri/target/release/bundle/）
```

注意：`cargo` 需在 PATH（`~/.cargo/bin`）；bash 会话中用 `export PATH="/c/Users/wanghaofeng/.cargo/bin:$PATH"`。

## 目录结构

```
src/
  api/            # 数据接口层（唯一允许 import stock-sdk 的地方是 api/sdk.ts 与少量直连 api）
  components/
    ui/           # 通用 UI（BaseCard/BaseTable/BaseTabs/BaseButton/BaseInput/…）
    business/     # 业务组件（报价头/五档/自选表/板块排行…）
    charts/       # ECharts 图表（注册表 echarts-setup.ts）
    dock/         # 右侧停靠面板（DockPanel + StockDetailPanel）
    screener/     # 选股器三工具子组件
  composables/    # use-polling（轮询引擎）/ use-theme / use-lazy-rows…
  constants/      # 全部魔法值集中于此（禁止散落字面量）
  layouts/        # MainLayout（侧栏 + 主区 + 右侧停靠面板）
  plugin/         # 插件内核（一切皆插件：内核只做加载/卸载/依赖，能力由插件贡献）
  plugins/        # 内置插件（每个插件一个目录，自带 plugin.ts / 组件 / constants）
  router/         # 路由（懒加载分包）
  stores/         # Pinia（watchlist/settings/dock-panel/market-status/data-cache/plugin）
  types/          # 全部类型（多为 stock-sdk re-export）
  utils/          # 原子函数（一函数一文件）
  views/          # 页面
src-tauri/        # Tauri 2 客户端（Rust：tauri-plugin-http 直连数据源）
server/           # vite 中间件：/stock-proxy（仅浏览器 dev 使用）
.ai/              # 本地开发沉淀（gitignore，不入库）
```

## 硬性 TS 规范（ESLint 已卡口，提交前必须全绿）

- **禁 enum**：用 `const 对象 + as const + satisfies` 替代
- **类型导入**必须 `import type`（verbatimModuleSyntax）
- **禁魔法值**：字面量进 `src/constants/`（含图表颜色、时间间隔、URL、阈值）
- **全导出写 JSDoc**：导出函数必须有 `@param` / `@returns`
- **原子函数**：utils 一函数一文件
- **类型进 `src/types/`**（多为 stock-sdk 类型 re-export，业务自定义类型单独文件 `xxx.types.ts`）
- 路径别名：`@` 指向 `src/`

## 数据通道（重要，勿破坏）

- 所有 fetch 型上游经 `src/api/proxy-fetch.ts`（SDK 的 `fetchImpl` 注入点）：
  - **Tauri 内**：`tauri-plugin-http` 由 Rust 直连（无 CORS），域名白名单在 `src-tauri/capabilities/default.json`
  - **浏览器**：同源 `/stock-proxy?u=<encoded>` 转发（`server/stock-proxy-middleware.ts`）
- **响应体按原始字节透传（arrayBuffer）**：SDK 对腾讯源固定按 GBK 解码，任何转码都会乱码
- JSONP 类源（腾讯行情/分时，script 注入）不走代理，浏览器直连
- 新增数据域名：浏览器侧改 `constants/proxy.constants.ts` 白名单，Tauri 侧改 capabilities scope
- **接口与数据源完整清单见根目录 `SERVER_API.md`**（每个页面调了什么接口 / 什么 stock-sdk 方法、上游 host、本机封禁与频率红线），新增或排查取数问题时先查此文件

## 插件体系（一切皆插件，硬性架构）

内核 `src/plugin/`（`kernel.ts` 为状态机核心）**只负责**三件事：加载 / 卸载 / 依赖收敛。
**一切能力都由插件贡献**——侧栏面板、菜单、路由、停靠面板、命令、Agent MCP 服务器。
宿主不硬编码任何具体插件，新增能力应当写成插件而不是改宿主（`MainLayout.vue` 里只保留面板承载与命令转发）。

### 内核 API

```ts
import { pluginKernel } from '@/plugin';
pluginKernel.use(plugin, config?)  // 注册并挂载（返回 Disposable）
pluginKernel.unuse(id)             // 彻底移除
pluginKernel.setEnabled(id, bool)  // 运行期启停（贡献点即撤销/恢复）
pluginKernel.retry(id)             // 失败插件显式重试
pluginKernel.list()                // PluginRuntimeInfo[]（status/contributions/error）
pluginKernel.revision              // ref<number>：宿主响应式依赖它感知变化
```

插件形态：`{ id, name, version, description?, inject?, apply(ctx) }`（见 `types/plugin.types.ts`）。
`apply` 可同步可异步；抛错 → 状态 `failed` + **已产生的贡献点全量回滚** + 记 `error`，不自动重试。

### 三条硬性约定

1. **可逆副作用**：`ctx.sidebar/menu/router/dock/command/stockRow/stockDetail/agent` 的每次 `add` 都由内核登记撤销句柄，
   插件卸载 = 撤销全部贡献。**插件里禁止直接改宿主状态**（如往 pinia 塞数据），必须走贡献点或服务。
2. **依赖靠服务名，不靠 import 顺序**：`inject: ['note:repo']` 声明依赖 → 依赖未就绪时状态为 `pending`
   （不报错、不阻塞其它插件）；就绪后自动挂载。依赖被禁用 → 依赖方级联回到 `pending`，恢复后自动重挂。
   环形依赖双方停在 `pending`，**不死循环**。协作走后端 `ctx.provide('note:repo', impl)` + `ctx.consume('note:repo')`
   （同名后注册者覆盖，卸载后恢复前者）。
3. **类型化事件**：`ctx.on('note:saved', h)` / `ctx.emit`，订阅返回 Disposable 且随插件卸载自动退订。
   新增事件须在 `plugin.types.ts` 的 `AppEventMap` / `AppServiceMap` 里扩展（**插件通过 `declare module` 自行扩展**，
   见 `src/plugins/quick-note/service.ts`）。

### 贡献点速查

| 贡献点 | API | 说明 |
| --- | --- | --- |
| 侧栏面板 | `ctx.sidebar.add({ id, title, component, mode, position, order, visibleWhenCollapsed })` | `mode: 'inline' \| 'drawer'`（默认 inline）；`position: 'nav' \| 'footer'`；`order` 越大越靠下，宿主内置项在前 |
| 菜单 | `ctx.menu.add({ path, title, icon, component, order? })` | **带 `component` 会自动注册路由**（挂在主布局之下），无需再手动 `router.add` |
| 路由 | `ctx.router.add({ path, component, underLayout? })` | 无菜单入口的隐藏页用这个；`underLayout` 默认 `true` |
| 停靠面板 | `ctx.dock.add(key, component, title)` | 右侧面板（`openPluginPanel(key)` 打开） |
| 命令 | `ctx.command.add({ id, title, keys?, run })` | `keys: 'Ctrl+Alt+N'` 自动接管全局快捷键（`command-keys.ts` 解析） |
| 股票行操作 | `ctx.stockRow.add({ id, title, activeTitle?, icon, order?, isActive?, run })` | 往**自选股表格的「操作」列**注入按钮（宿主不硬编码任何插件）；`isActive` 表达激活态（宿主据此高亮 + 换用 `activeTitle`），适合「盯盘 / 取消盯盘」这类开关动作 |
| 个股详情扩展区 | `ctx.stockDetail.add({ id, title, component, order?, props? })` | 在**个股详情面板底部**注入一个卡片区块（宿主只传 `symbol`，内容完全由插件决定）；适合速记 / 标签 / 备注这类「跟着个股走」的功能，示范见 dsh-quick-note 的 `StockNotesSection.vue` |
| Agent 工具 | `ctx.agent.addServer({ key, name, description, tools })` | 并入 `listBuiltinMcpServers()`，与内置 MCP 同权 |

### 新增一个左侧栏面板插件（最小流程）

1. 建目录 `src/plugins/<your-plugin>/`：`plugin.ts`（导出 `PluginDefinition`）+ 面板 `xxx.vue` + `constants.ts`（文案/阈值入常量）
2. `plugin.ts` 里 `apply: (ctx) => ctx.sidebar.add({ id, title, component, mode: 'inline', position: 'nav', order })`
3. 注册到 `src/plugins/index.ts` 的 `BUILTIN_PLUGINS`（宿主按此列表挂载，黑名单见 `stores/plugin.ts`；**改前先按下方「备份与恢复」规范备份**）
4. 面板内既可用 `pluginLab` 这类宿主导出的公共数据，也可自己 `ctx.provide` 服务给别的插件
5. 启停无需改宿主：设置页「插件」卡片（`PluginManageModal.vue`）已按 `pluginKernel.list()` 自动渲染

### 宿主接线（别绕开）

- `main.ts` 在 `app.use(router)` **之前**调 `installPlugins(pinia)`（`plugin/setup.ts`）：
  先 provide 宿主服务（`app:version` / `kernel:runtime` / `app:navigate` / `panel:open` / `app:notify`），再挂插件，
  再 `attachPluginRoutes(router)`（订阅路由注册表版本号），随后**异步挂载用户插件**，最后 `router.afterEach` 广播 `route:changed`
- 侧栏面板渲染：`components/plugin/SidebarPanelHost.vue`（inline，折叠时不挂载）+ `SidebarPanelEntry.vue`（drawer 入口按钮）+ `PluginPanelDrawer.vue`（抽屉承载）
- 插件存储：`ctx.storage` 落在 `whf:app` 整包的 `plugin:<pluginId>` 命名空间下，**插件之间天然隔离**
- 插件通用数据库 `ctx.db`（见下节）；面板组件通过 `usePluginPanelHost()`（`plugin/panel-host.ts`）拿到 `{ mode, visibleWhenCollapsed }` 等宿主上下文
- **应用级浮窗 `app:notify`**（`types/notify.types.ts` + `stores/notifications.ts` + `components/ui/NotificationHost.vue`）：
  插件 `ctx.consume('app:notify')` 即可弹右下角提醒（tone 走涨跌 token，自动跟随 `data-trend`）。
  承载组件由 `MainLayout` 渲染一次，**与发起它的插件面板是否挂载无关**——需要长期生效的提醒（如盯盘到价）必须走这里，
  不能挂在面板组件里（面板折叠即卸载）

### 面板挂载语义（决定「后台任务该放哪」，别踩）

侧栏面板有**两层**折叠，都会让面板组件被卸载：

1. 面板自身标题条折叠 → `SidebarPanelHost.vue` 的 `v-if="!collapsed"`；
2. 侧栏收起为 64px 图标栏 → `MainLayout` 的 `shouldRenderInline()` 按面板声明的 `visibleWhenCollapsed` 决定是否渲染。

所以**任何需要「用户不看也在跑」的逻辑（轮询、到价告警、定时任务）都不能写在面板组件里**，
要放插件层，用 `createPollingScheduler`（`composables/polling-scheduler.ts`，无组件依赖，
与 `usePolling` 共用同一份交易窗口 / 退避 / 可见性策略）+ `ctx.onDispose()` 收尾；
面板只读引擎暴露的响应式快照（示范：dsh-sidebar-watch 的 `monitor.ts`）。

### 插件通用数据层（ctx.db / ctx.storage，硬性：插件永不直接访问 SQL）

插件数据持久化统一走宿主 API，**插件侧不存在任何 SQL / tauri-plugin-sql 依赖**：

- **`ctx.storage`**（KV，小体量偏好数据）：localStorage 即时写（`plugin:<id>` 命名空间），
  Tauri 端异步镜像进 `plugin_storage` 表，启动时以库覆盖水合（`api/plugin-storage-db.api.ts`）
- **`ctx.db`**（结构化记录，`types/plugin.types.ts` 的 `PluginDatabase`）：每插件独立表，
  物理表名 `plugin_<插件id>_<表名>`（`utils/plugin-db-sql.ts` 纯函数做标识符白名单校验，
  是防注入边界）。声明式建表（`ensureTable` 幂等）+ CRUD（insert/select/update/remove/count/clear，
  等值过滤参数化，`json` 列自动 stringify/parse）。Tauri 端落 stock-board.db 动态表，
  浏览器端降级为 appStorage JSON 表仿真，两端语义一致（`api/plugin-db.api.ts`）
- **表结构演进：加列直接改声明，宿主自动补列**。`CREATE TABLE IF NOT EXISTS` 对已存在的表是空操作，
  所以 `ensureTable` 会比对 `PRAGMA table_info` 并对缺列执行 `ALTER TABLE … ADD COLUMN`
  （`buildAddColumnSql`，一律补成可空列）——插件因此不需要写任何迁移逻辑。
  反过来说：**列声明就是唯一事实源，改列类型 / 删列不会被宿主感知**（SQLite 也不支持直接改），
  需要动类型时只能新建列名。
- **表登记与卸载**：`ensureTable` 自动登记到 `plugin-db-tables`（appStorage）；卸载用户插件时
  若有登记表，弹窗挂起「保留数据 / 一并删除」待办（`use-user-plugins.ts` 的
  `pendingDbCleanup` + `resolveDbCleanup`），删表走 `dropPluginTables`（DROP + 清降级数据 + 清登记）
- **内置插件的示范实现**：dsh-quick-note 的速记（含 ctx.storage 旧数据一次性迁移、
  后续追加的股票关联两列 `symbol/stock_name`、以及「个股详情扩展区」贡献点的消费方 `StockNotesSection.vue`）、
  dsh-sidebar-watch 的盯盘候选（`plugin_dsh_sidebar_watch_watch_candidates`，含「刚加入就移除」的串行写队列、
  以及后续追加的阈值四列 `alert_kind/alert_value/alert_above/alert_armed` —— 加列的现成例子）
- **MCP 同步**：新增表 / 改表结构后同步 `app-tools.ts` 的 `db_query` / `db_execute` 描述；
  Agent 对 `plugin_*` 表默认只看不改

### 应用内插件安装（用户插件，对标 dsh 的看板内安装）

除源码级插件外，应用支持**运行时安装**：设置页「插件」→「安装插件」（`PluginInstallModal.vue`）。

- **插件格式**：预构建 ESM JS，`export default { …PluginDefinition }`（或 `export const plugin`）。
  面板组件用渲染函数 `h()` 写——生产构建不含 Vue 运行时模板编译器，`<template>` 字符串不可用
- **加载链**：`plugin/user-plugin-loader.ts` 把代码包成 Blob URL 动态 `import()`（CSP 无限制：浏览器侧无
  CSP meta、Tauri `csp: null`）→ `validateUserPluginDefinition` 结构校验（id 规则 / 必填字段 / 占用检查，
  **纯函数**可被烟雾测试直跑）→ `pluginKernel.use(def, { origin: 'user' })`
- **持久化**：代码原文存 `stores/user-plugins.ts`（命名空间 `plugin.user`，上限 50 条 / 单份 512KB）；
  启动时 `setup.ts` 异步重挂，并按启动路径快照还原「直刷插件路由被 404 兜底带走」的场景
- **管理**：启停与内置插件同一套黑名单语义；管理弹窗里用户插件有「卸载」（两段确认）——内核 `unuse`
  + 删持久化，**插件运行时数据保留**（重装恢复）
- **信任级别**：插件代码与应用同权限执行（无沙箱），安装弹窗有固定风险提示；写操作类插件需自行确认来源

### 源码级安装 / 卸载的备份与恢复（硬性）

运行时启停（设置页开关）不碰源文件、天然可逆，无需备份；**改源文件才算「安装」，删除才算「卸载」，这两步必须走备份流程**：

1. **安装前备份**：把所有将被改动的宿主文件（至少 `src/plugins/index.ts`，若还涉及 constants / MCP registry / 路由等一并算上）按原相对路径备份到 `.ai/plugin-backups/<pluginId>/`，并在该目录写 `manifest.json`：`{ pluginId, files: [相对路径...], backupAt, note }`
2. **卸载时恢复**：先删插件目录 `src/plugins/<pluginId>/`，再把备份文件按 `manifest.json` 清单逐一写回原路径，恢复后跑 `pnpm lint` + `pnpm build` 验证
3. **git 是第二道保险，不替代本流程**：`.ai/` 不入库，备份只在本机有效；git 干净时 `git checkout -- <file>` 也可用，但 manifest 备份是硬性兜底
4. 插件自己的运行时数据（`whf:app` 整包里 `plugin:<pluginId>` 命名空间）卸载插件时**不清理**，重装后数据仍在——要彻底清数据需用户在设置页确认

### 自检口径

改完内核或新增插件，除 `pnpm lint` + `pnpm build` 外**必须跑内核烟雾测试**：

```bash
node .ai/tmp/plugin-kernel-smoke.mjs   # 71 项断言：挂载/卸载/贡献点可逆/order 排序/依赖收敛/环形依赖/失败回滚/服务覆盖恢复/事件退订/清理逆序/菜单自动路由/存储隔离/快捷键解析/Agent 贡献点/revision/ctx.db 降级通道全链路
node "C:/Users/ChenYj/.workbuddy/skills/ts-smoke-harness/scripts/run-ts-smoke.mjs" --test .ai/tmp/plugin-db-smoke.mjs   # 26 项：ctx.db 纯函数层（表名校验/DDL/序列化）
```

问自己一句：「这个能力是插件贡献的，还是我又改宿主硬编码了？插件卸载后它真的消失了吗？」

## 内置 MCP 同步规范（硬性，勿漏）

Agent 的内置 MCP 工具定义在 `src/agent/mcp/`（`app-tools.ts`「app-api」与 `stocksdk-tools.ts`「stock-sdk」，条目展示见 `components/agent/McpManageModal.vue`）。以下变更**必须同步更新对应 MCP 工具**，否则 Agent 能力与实际接口/库表脱节：

- **新增接口 / API**：同步新增 MCP 工具或扩展现有工具（`app-tools.ts` / `stocksdk-tools.ts`），zod schema 为单一事实源（`inputSchema` 由 `z.toJSONSchema` 推导）
- **接口变更**（入参/返回结构/语义变化）：同步修改对应工具的 zod schema、description 与返回摘要
- **接口删除**：同步删除对应 MCP 工具
- **数据库变更**（Rust 迁移新增表/字段、删表、改表）：同步更新 `app-tools.ts` 中 `db_query` / `db_execute` 与 CRUD 工具涉及的表说明（如 `news_saved` 等）
- **插件贡献的 MCP 服务器**：插件经 `ctx.agent.addServer()` 注册的服务器会并入 `listBuiltinMcpServers()`
  （`agent/mcp/registry.ts`），在 `McpManageModal.vue` 里按归属插件展示；插件工具的 schema / description
  同样适用上述口径，改完确认启停插件时它随之出现与消失

自检口径：改完跑 `pnpm lint` + `pnpm build`；问自己一句「Agent 现在调用这些接口/表的方式还和代码一致吗？」

## MCP Apps 渲染约定（工具结果可视化，硬性）

内置 MCP 工具可声明「调用后渲染成卡片」：工具加 `_meta.ui.resourceUri`（`ui://<server>/<app>`），
`execute` 返回 **双通道** 结果 —— `content[0].text` 给模型（精简 JSON 控 token）、
`structuredContent` 给 UI（不进模型上下文）。新增/修改带 UI 的工具按此约定：

- UI 应用写在 `src/agent/mcp/ui-apps.ts`：单文件 HTML、零外部依赖（不引 CDN/字体/图片），
  源码内**不能出现反引号与 `${`**（整个文件是 TS 模板字符串）；主题/涨跌配色由宿主经
  `hostContext` 下发（`data-theme` / `data-trend`），App 不读 localStorage；
- 渲染数据必须先在 `ui-payload.ts` 归一化为「series 声明 + 行数据」，**不要把 stock-sdk
  的字段名（ma5/dif/rsi6…）直接漏进 App**——SDK 换版本只改这一处；
- `uiCallable` 只对**只读**工具开 `true`（App 可反向 `tools/call`）；写操作与任意 SQL
  一律 `false`（`app-tools.ts` 全部 false，勿放开）；
- 宿主协议实现见 `components/agent/McpAppHost.vue`：iframe `sandbox="allow-scripts"`，
  **严禁加 `allow-same-origin`**（加了 sandbox 就等于失效），消息必须校验
  `event.source === iframe.contentWindow`；
- 改完必须跑 `.ai/tmp/mcp-apps-smoke.cjs`（协议链路 + 渲染 + 白名单 + 主题跟随，44 项断言）。

远端 MCP 工具由 `src/agent/mcp/remote.ts` 直连 `@modelcontextprotocol/sdk`（不走
`@langchain/mcp-adapters`：那层会丢掉 `_meta.ui` / `structuredContent`，且无法注入
tauri fetch 绕 webview CORS）。

## 请求频率红线（踩过坑）

东财系接口高频请求会封 IP（全域名 TCP RST 数十分钟）：

- 全市场快照（`fetchAllMarketQuotes`）小并发分页 batchSize 500 / concurrency 3（⚠️ 不得超过 3）
- 同一上游连续请求用 `delay(500)` 错峰
- 重接口（全市场快照 / K 线 / 资金流 / 分时循环）一律用户点击触发，不轮询
- 并发扫描用 `utils/map-with-concurrency.ts`（信号扫描并发 3、尾盘分时并发 2）

## 轮询治理

`usePolling({ task, intervalMs, tradingAware, market })`：

- tradingAware 时仅在交易窗口内轮询，窗口外自动暂停（挂载首次请求照常执行）
- 窗口：A 股交易日 09:15-15:00（SDK 日历）；美股 21:30-24:00 与 00:00-04:00（按星期近似）
- 窗口 getter 在 `stores/market-status.ts`（分钟级 clockTick 驱动）；规则文案与设置页 NoticeBar 保持一致

## UI 约定

- 表格统一 `BaseTable` 列配置驱动（`TableColumn<T>`），滚动容器 `table-scroll` / `table-scroll-sm`（吸顶吸左），长列表配 `useLazyRows`
- 主区容器已开 `@container`：页面栅格用容器断点（`@2xl/@3xl/@4xl`）而非视口断点，右侧面板打开时自动换行
- 主题：`<html data-theme>`（4 套主题色）+ `<html data-trend>`（3 套涨跌配色）；图表不走 CSS 类，经 `utils/trend-colors.ts` / `read-css-var.ts` 运行时读变量
- 新增 ECharts 图表类型必须在 `charts/echarts-setup.ts` 注册，否则 setOption 静默失败（svg 容器空白）
- 按钮等可交互元素带 `pressable` 按压动效

## 持久化

- localStorage 单 key `whf:app`，值为命名空间对象；各 store 经 `utils/app-local-storage.ts`（`appStorage`）读写，`persist: { key: STORAGE_NS_*, storage: appStorage }`
- 明暗模式（useDark）同走 appStorage

## 发布流程（PC 客户端）

1. 版本号三处同步改：`src-tauri/tauri.conf.json`、`package.json`、`src/constants/app-info.constants.ts`（APP_VERSION，供「检查更新」比较）
2. 提交并推送代码（**先 push 代码，再处理 tag**）：

   ```bash
   git add -A
   git commit -m "feat: <中文描述>（vX.Y.Z）"
   git push origin main
   ```

3. 打 tag 并推送 tag（必须在代码 push 成功之后执行）：

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

4. `release.yml` 在 Windows runner 自动构建并上传安装包到 GitHub Release；
   Release 描述由 workflow 从「上一个 tag..HEAD」的提交主题自动生成带编号的变更列表

注意：tag 必须打在**已推送的最新 commit** 上（先 push 后打 tag）；若 push 后有他人新提交，先用 `git pull --rebase` 再走流程。`pnpm lint` 与 `pnpm build` 必须在 commit 前全绿。

### 提交信息规范（Conventional Commits，硬性）

提交主题（subject）格式：`<type>: <中文描述>`，type 取值：

- `feat`：新增功能
- `fix`：修复 bug
- `refactor`：重构（不改行为）
- `perf`：性能优化
- `docs`：文档
- `chore`：构建 / 依赖 / 配置

提交主题会原样进入 GitHub Release 的「更新内容」编号列表，因此必须写成面向用户可读的一句话；一次提交含多项变更时在 body 里分条列出。示例：`feat: 新增设置页检查更新`、`fix: 修复打包后新浪源无数据`。

### 打包注意

- `productName` 固定为 ASCII（`stock-board`）：WiX/MSI 不支持非 ASCII 产品名；中文「股票看板」只用于窗口标题 / Release 描述等展示文案，勿把 productName 设为中文
- `pnpm tauri build` 打 WiX/NSIS 工具链需下载，国内网络先设 `HTTPS_PROXY`


## 其他

- 提交作者统一 `ZCode <zcode@users.noreply.github.com>`（`-c user.name="ZCode" -c user.email=...`）
- `.ai/` 目录为本地开发沉淀，不入库
- 不要自动 push 到远端仓库，除非开发者主动要求

## UI 风格规范

本项目 UI 严格遵循根目录 `DESIGN.md`（基于项目现有 theme.css 提炼的自定义风格）。
所有界面代码必须使用其中的 token（颜色、字体、圆角、间距），禁止引入规范之外的颜色、字号、圆角值。
新增组件样式前先查阅 DESIGN.md 的 components 一节；token 单源为 `src/assets/styles/theme.css`（Tailwind 4 @theme），改色值需与 `src/constants/stock-colors.constants.ts` 同步。
