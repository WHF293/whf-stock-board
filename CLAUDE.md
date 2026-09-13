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
  router/         # 路由（懒加载分包）
  stores/         # Pinia（watchlist/settings/dock-panel/market-status/data-cache）
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

## 请求频率红线（踩过坑）

东财系接口高频请求会封 IP（全域名 TCP RST 数十分钟）：

- 全市场快照（`fetchAllMarketQuotes`）串行分页 batchSize 500 / concurrency 1
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
2. 提交后 `git tag v0.x.0 && git push origin main v0.x.0`
3. `release.yml` 在 Windows runner 自动构建并上传安装包到 GitHub Release；
   Release 描述由 workflow 从「上一个 tag..HEAD」的提交主题自动生成带编号的变更列表

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
