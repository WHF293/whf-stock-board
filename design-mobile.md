# design-mobile.md — 移动端 UI 设计规范

> 移动端（Android App / H5）视觉与交互单源。桌面端规范见 [DESIGN-PC.md](./DESIGN-PC.md)。
> 素材来源：`.ai/项目资源/stock-board-mobile-home-tab-v2.html`（v2 主稿）与 `stock-board-mobile-market-modules-v2.html`（二期模块稿），两稿附录定论已全部收敛进本文件。
> 项目共享 token（颜色 / 圆角 / 间距 / 涨跌语义）以 `src/common/assets/styles/theme.css` 为单源，本文件只定义**移动端特有**层，不重复抄值。

## 0. 代码分层（2026-10-10 重组后）

```
src/
├─ pc/        # PC 专属：views / components / layouts / router / agent / plugin(s) / weblog / widget / App.vue / bootstrap-desktop.ts
├─ mobile/    # 移动端专属：MobileApp / views / components / composables / constants.ts / mobile.css / router.ts
└─ common/    # 两端通用：api / constants / types / utils / composables / stores / assets
```

判定规则：新文件先问「移动端会不会用」——会用放 common，只 PC 用放 pc，只移动用放 mobile。移动端禁止 import `@/pc/*`；`src/common` 禁止反向 import `pc/mobile`。

## 1. 视觉基线：液态玻璃（v2 起）

移动端视觉对齐苹果系统玻璃质感（iOS Liquid Glass）。所有悬浮层（TabBar、navbar 图标座、弹层、卡片）统一用以下玻璃 token，定义于 `src/mobile/mobile.css`（v2.1 起从硬编码收敛为变量）：

| Token | 亮色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `--glass-light` | `rgba(255,255,255,.62)` | `rgba(38,44,53,.55)` | 玻璃底色（底座/卡片/弹层） |
| `--glass-light-strong` | `rgba(255,255,255,.78)` | `rgba(255,255,255,.14)` | TabBar 选中胶囊 |
| `--glass-blur` / `--glass-saturate` | `24px / 1.8` | 同左 | backdrop-filter；低端机 `@supports` 降级为不透明底色 |
| `--glass-border` | `rgba(255,255,255,.55)` | `rgba(255,255,255,.09)` | 玻璃描边（厚度感） |
| `--glass-highlight` | `rgba(255,255,255,.6)` | `rgba(255,255,255,.10)` | 顶部 1px 内高光 |
| `--glass-shadow` | `0 8px 24px rgba(31,39,51,.12)` 双层 | `0 10px 30px rgba(0,0,0,.5)` | 玻璃投影 |
| `--glass-radius` | `26px` | 同左 | TabBar 底座 / 大卡圆角 |

规则：

- 玻璃层必须 `backdrop-filter + -webkit-backdrop-filter` 双写；`@supports not (backdrop-filter: …)` 降级为不透明 `var(--color-surface)`。
- **全局背景**：页面背景用浅青渐变（暗色深青渐变），玻璃透底依赖此背景层次；纯白画布上不允许放玻璃层（无层次可透）。
- 涨跌语义沿用 PC：红涨 `--color-up` / 绿跌 `--color-down`，暗色同规则；金额千分位、涨跌幅带 ± 与 %。
- 明暗双主题切换复用「我的 → 主题设置」，玻璃两套值随 `html.dark` 切换。

## 2. 布局骨架

### 2.1 主 Tab 页（一级页）

- 结构：`navbar（玻璃）→ 可选摘要条 → 内容区（纵向撑满一屏）→ 悬浮 TabBar`。
- 垂直滚动一律发生在**面板内部**（Vant Tabs + PullRefresh 宿主结构，v1.1.2 滚动修复结论继续生效）：Tabs 只做点击切换，`animated` 可开、**禁止 `swipeable`**（触摸方向锁会拦截垂直滚动，真机已踩坑）。
- 列表底部让位 ≥ `88px + env(safe-area-inset-bottom)`，避免最后一条被悬浮 TabBar 压住。

### 2.2 底部 TabBar（液态玻璃胶囊）

- **悬浮**：`left/right 14px`、底部悬空 `10px + safe-area`，全圆角 `999px`，不通栏贴底。
- **底座固定不动**，选中态是叠在上面的**亮胶囊指示器**（`--glass-light-strong` 底 + 内高光 + 投影），切换 tab 时胶囊从旧位置**平滑滑动**到新位置；胶囊 `pointer-events: none` 不挡点击。
- 滑动动画：`transform 0.32s cubic-bezier(.16,1,.3,1)`（先快后慢，见 §3）；图标激活微放大 `1.1` 倍 + 文字颜色 0.25s 过渡。
- Tab 构成（v2 起）：**首页 / 热点新闻 / 我的**。今天炒什么不入 Tab（见 §4 路由）。

### 2.3 二级页形态（统一）

全部二级页（今天炒什么 / 行情全景 / 市场榜单 / 板块日历 / 板块详情 / 个股页 / 原文页 / 设置）：

- 玻璃 navbar：`返回键 + 标题（可带副标题）+ 右侧动作位`；无底部 TabBar。
- 底部 `env(safe-area-inset-bottom)` 留白；Android 系统返回手势 / 返回键等效返回键。
- 深链直达时返回键回首页（导航栈空兜底）。
- **卡片与列表通栏**：二级页内容卡、列表容器左右不留白（margin 0、圆角 0），行内边距统一 16px；控件行（chips / 周期切换 / 图例）保留 16px 内缩作节标题对齐。

## 3. 动效规范

| 类型 | 规范 |
| --- | --- |
| 位移动画（胶囊滑动、面板横滑、bottom sheet 升起） | `cubic-bezier(.16,1,.3,1)`（先快后慢），0.28–0.35s |
| 透明度动画（页面淡入、toast） | 0.12–0.25s，ease-out |
| Tab 切换内容过渡 | 胶囊滑动 + 120ms 淡入；**禁用整页横滑**（方向语义留给二级页内部源切换） |
| 骨架屏 | shimmer 1.4s 循环；`prefers-reduced-motion: reduce` 时静态降级 |
| 骨架行 | 与最终态同构（宽高一致 + 宽度梯度），避免加载完成跳动 |

## 4. 路由与导航

| 路由 | 层级 | 说明 |
| --- | --- | --- |
| `/` | Tab1 | 首页（冷启动落点） |
| `/news` | Tab2 | 热点新闻（v1 全量保留） |
| `/mine` | Tab3 | 我的 |
| `/board` | 二级 | 今天炒什么（首页入口卡跳转；v1 深链兼容，UI 不改） |
| `/settings`、`/theme`、`/article` | 二级 | v1 保留 |
| `/panorama`、`/market-rank`、`/board-calendar(/:code)`、`/stock/:code` | 二级 | 二期模块（稿：market-modules-v2） |

- v1 的 Tab 持久化 key 作废不迁移。
- 个股页 `/stock/:code` 是全站股票名/代码的统一落点（榜单行、日历弹层、全景领涨股）；代码带市场后缀自动路由行情源。

## 5. 首页版式（Tab1）

自上而下（稿：home-tab-v2 A0）：

1. **玻璃 navbar**：日期问候（「10月10日 周五」+ 分时段问候语）+ ⚙（跳设置）。
2. **指数情绪条**：4 个玻璃胶囊（上证 / 深成 / 创业板 / 北证50，现价+涨跌幅）；一期进入首页刷新一次（30s TTL），点击无动作（二期并入全景）。
3. **今天炒什么入口卡**：今日主线 + Top5 榜单预览（取六平台榜单第一名，交集优先、无交集取最高热度）；点整卡跳 `/board`；接口失败分区降级 + 重试；休市显示上期并标注日期。
4. **二期预告卡 ×3**：行情全景 / 市场榜单 / 板块日历，一期「二期上线」锁定态 + 点击 toast；上线当天替换真实卡，布局顺序不变。
5. 二期完成态：行情全景卡（指数 2×2 + 行业热力）落地后移除独立指数条（稿 A4）。

状态完备性：A1 骨架屏（首载/下拉刷新）、A2 空态+错误态（分区降级、错误码+request_id、重试只重拉对应接口、空态给引导文案不用技术语）、A3 暗色玻璃。

## 6. 二期模块要点（稿：market-modules-v2）

- **行情全景** `/panorama`：模块 chips 六项可配置；A股全景 = 涨跌统计 4 卡 + 三组筛选 chips + 板块行（涨跌幅胶囊 + 领涨股 + 涨跌家数 mini-bar，点击手风琴展开成分股）；板块资金曲线 + 净流入榜；美股/宏观 2 列网格卡；新股打新卡。
- **市场榜单** `/market-rank`：9 榜 chips（主力/连板/异动/龙虎/大宗/涨幅/跌幅/成交额/换手）；报价榜列裁为 个股/最新价/涨跌幅/成交额/换手率；**所有榜单行点击进个股页**；切换 chips 用 Vant animated（不带 swipeable）。
- **板块日历** `/board-calendar`：板块×交易日矩阵（行头 sticky + 7 档色阶图例常驻）→ 点格弹玻璃 bottom sheet（当日涨跌停明细，个股行可点）→ 板块名进详情矩阵（成分股×日，±2/±5 阈值色）。
- **个股页** `/stock/:code`：报价头（现价大字 + 涨跌 + 4×2 指标网格）→ 周期 chips（分时/五日/日K/周K/月K/5分，与 PC `CHART_PERIOD_OPTIONS` 一致）→ MA 图例 → K 线主图+成交量副图（复用 PC `KlineChart.vue` 双模式）→ 五档盘口 → 底部「交易记录 / ETF 持仓」Tab。**不含 AI 分析入口**（该功能暂不实现）。

数据口径：与 PC 同接口同字段（api 层在 `src/common/api`）；缓存沿用移动端 30 分钟 TTL（行情类 30s 内存缓存不入盘）；4s 报价 / 30s 榜单轮询**仅前台当前视图生效**，页面隐藏即暂停；K 线单屏 ≤120 根。

## 7. 组件与命名

- 组件前缀 `Mobile*`（views/components），CSS 类前缀 `m-`。
- 玻璃容器复用顺序：优先现成 class（`.m-tabbar` 系、`.m-glass-card`），不得各自硬编码 blur/rgba。
- 滚动安全红线（v1.1.2 结论）：任何悬浮玻璃层必须精确控制 `pointer-events`，不得拦截列表触摸；新增悬浮层必须在真机回归「列表上滑 + 下拉刷新」。

## 8. 无障碍与验收

- 骨架动画响应 `prefers-reduced-motion: reduce`；暗色文本对比度 ≥4.5:1。
- 验收基线：360px 宽与暗色主题下无破版；矩阵横滑跟手、sticky 行头不闪烁；轮询暂停恢复无脏数据。
- 埋点：`tracking_mode = none`（沿用 v1/v2 稿口径）。

## 9. 变更记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-10-10 | v2.0 | 首版：液态玻璃基线 + Tab 重构（首页/热点新闻/我的）+ 二级页形态 + 二期模块要点；对应 v2 两稿附录定论收敛 |
