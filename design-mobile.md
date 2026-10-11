# DESIGN-MOBILE.md — 移动端 UI 设计规范

> 移动端（Android App / H5）视觉与交互单源。桌面端规范见 [DESIGN-PC.md](./DESIGN-PC.md)。
> 素材来源：`.ai/项目资源/stock-board-mobile-ui-clean-v2.html`（v3 清新版定稿稿）；
> 历史稿 `stock-board-mobile-ui-1to1-v1.html`（v2 液态玻璃全量 1:1 稿，玻璃仅存于 TabBar 的出处）、
> `stock-board-mobile-home-tab-v2.html` 与 `stock-board-mobile-market-modules-v2.html`（二期模块稿）。
> 项目共享 token（颜色 / 圆角 / 间距 / 涨跌语义）以 `src/common/assets/styles/theme.css` 为单源，本文件只定义**移动端特有**层，不重复抄值。

## 0. 代码分层（2026-10-10 重组后）

```
src/
├─ pc/        # PC 专属：views / components / layouts / router / agent / plugin(s) / weblog / widget / App.vue / bootstrap-desktop.ts
├─ mobile/    # 移动端专属：MobileApp / views / components / composables / constants.ts / mobile.css / router.ts
└─ common/    # 两端通用：api / constants / types / utils / composables / stores / assets
```

判定规则：新文件先问「移动端会不会用」——会用放 common，只 PC 用放 pc，只移动用放 mobile。移动端禁止 import `@/pc/*`；`src/common` 禁止反向 import `pc/mobile`。

## 1. 视觉基线：清新白卡 + hairline（v3 起）

v3 清新版定调（2026-10-11，稿：clean-v2 附录 §1）：**内容层去玻璃拟物**——白卡片 + hairline 细分割线 + 大留白分层；
**玻璃仅保留于底部 TabBar**（液态玻璃特例，见 §2.2）。

| 层 | 亮色 | 暗色 | 说明 |
| --- | --- | --- | --- |
| 页面底 `--m-page-bg` | `#f6f8f9` 平涂 | `#21282e` 统一灰底 | v2 的浅青渐变随内容层去玻璃一并移除 |
| 卡片面 `--color-surface` | `#ffffff` | `#262e35`（灰底上抬一档） | navbar / 卡片 / 弹层 / 列表 |
| hairline `--color-border` | `#edf1f4` | `rgba(255,255,255,.07)` | 全部分割线；**分层靠 hairline 不靠投影** |
| 卡片影 `--m-card-shadow` | `0 1px 2px rgba(27,37,48,.05)` | `none` | 唯一投影档；TabBar / 浮层可另加一层柔影 |
| 卡片圆角 | `12px` | 同左 | 小件 `8px`；胶囊 `999px` |

规则：

- **色彩纪律**：红（`--color-up`）绿（`--color-down`）只表达涨跌；湖青主色（`--color-primary`）只表达激活态与可操作动作；来源名、股票代码等标识信息一律中性灰（`--color-text-2/3`），不与语义色争色。
- 内容卡片统一走 `.m-card` / `.m-home-panel` 系（白底 + 12px 圆角 + `--m-card-shadow`），**不得再新写玻璃底色 / backdrop-filter**（TabBar 除外）。
- 涨跌语义沿用 PC：红涨 `--color-up` / 绿跌 `--color-down`，跟随 `data-trend` 三套配色；金额千分位、涨跌幅带 ± 与 %。
- 明暗双主题：2026-10-11 起「我的」页**深色模式**独立行内切换（浅色/深色/跟随），主题色为其并列独立选项（行内色点直切）；涨跌配色在「我的 → 涨跌颜色设置」。两套值随 `html.dark` 切换。
- 设置页 icon 固定黑色（`#111418`）+ 浅灰 chip 底（亮暗同值），不随主题色 / 明暗切换；navbar 图标亮色黑（`#111418`）暗色白（`#fff`），标题 18px 加粗。

## 2. 布局骨架

### 2.1 主 Tab 页（一级页）

- 结构：`navbar（实底：surface + hairline 下边）→ 可选摘要条 → 内容区（纵向撑满一屏，卡片化）→ 悬浮 TabBar`。
- 垂直滚动一律发生在**面板内部**（Vant Tabs + PullRefresh 宿主结构，v1.1.2 滚动修复结论继续生效）：Tabs 只做点击切换，`animated` 可开、**禁止 `swipeable`**（触摸方向锁会拦截垂直滚动，真机已踩坑）。
- 列表底部让位 ≥ `88px + env(safe-area-inset-bottom)`，避免最后一条被悬浮 TabBar 压住。

### 2.2 底部 TabBar（液态玻璃胶囊 · 全 App 唯一玻璃组件）

- **玻璃特例（2026-10-11 定稿）**：液态玻璃是 iOS 最新系统特性，国产安卓新系统也在跟进玻璃化，故 TabBar 保留 v1 液态玻璃，内容层不跟。参数：blur `32px` + saturate `2.4`、底 `rgba(255,255,255,.28)`（暗 `rgba(52,60,70,.42)`）、白边 + 顶部 1px 内高光 + 重投影。
- **悬浮**：`left/right 14px`、底部悬空 `10px + safe-area`，全圆角 `999px`，不通栏贴底。
- **底座固定不动**，选中态是叠在上面的**亮胶囊指示器**（`--glass-light-strong` 底 + 内高光 + 投影，暗色同步抬亮），胶囊 `pointer-events: none` 不挡点击。
- **切换动效（两段包络）**：
  1. 行程：位移 `translateX(idx×100%)` 同时均匀缩小至 `scale(0.8)`、不透明度降至 `0.55`，`transform 0.34s cubic-bezier(0.16,1,0.3,1)` + `opacity 0.34s ease`；
  2. 落点：`160ms` 后回弹恢复 `scale(1)` / `opacity 1`，`0.22s cubic-bezier(0.3,1.35,.6,1)`。
  实现在 `MobileTabBar.vue`，参数常量在 `mobile/constants.ts`（`MOBILE_TAB_THUMB_*`），禁止在组件里散落字面量。
- 激活项：文字 / 图标湖青色，图标微放大 `1.1` 倍。
- Tab 构成（v2.1 起）：**首页 / 自选 / 热点新闻 / 我的**。今天炒什么不入 Tab（见 §4 路由）。

### 2.3 二级页形态（统一）

全部二级页（今天炒什么 / 行情全景 / 市场榜单 / 板块日历 / 板块详情 / 个股页 / 原文页 / 设置）：

- 实底 navbar：`返回键 + 标题 + 右侧动作位`；无底部 TabBar。
- 底部 `env(safe-area-inset-bottom)` 留白；Android 系统返回手势 / 返回键等效返回键。
- 深链直达时返回键回首页（导航栈空兜底）。
- **卡片化（v3，替代 v2 的「通栏不留白」）**：内容卡 / 列表容器左右留白 `12px`、圆角 `12px`、极浅影；卡片内行内边距统一 `16px`；区块标题与 chips 行左右 `12px` 与卡片边对齐。

## 3. 动效规范

| 类型 | 规范 |
| --- | --- |
| 位移动画（胶囊滑动、面板横滑、bottom sheet 升起） | `cubic-bezier(.16,1,.3,1)`（先快后慢），0.28–0.35s |
| **TabBar 指示胶囊切换** | 两段包络：行程缩至 0.8 / 透明度 0.55 → 落点回弹恢复（参数见 §2.2，常量 `MOBILE_TAB_THUMB_*`） |
| 透明度动画（页面淡入、toast） | 0.12–0.25s，ease-out |
| Tab 切换内容过渡 | 胶囊滑动 + 120ms 淡入；**禁用整页横滑**（方向语义留给二级页内部源切换） |
| 骨架屏 | shimmer 1.4s 循环；`prefers-reduced-motion: reduce` 时静态降级 |
| 骨架行 | 与最终态同构（宽高一致 + 宽度梯度），避免加载完成跳动 |

## 4. 路由与导航

| 路由 | 层级 | 说明 |
| --- | --- | --- |
| `/` | Tab1 | 首页（冷启动落点） |
| `/watchlist` | Tab2 | 自选（v2.1 增） |
| `/news` | Tab3 | 热点新闻（v1 全量保留） |
| `/mine` | Tab4 | 我的 |
| `/board` | 二级 | 今天炒什么（首页入口卡跳转；v1 深链兼容） |
| `/settings`、`/theme`、`/article` | 二级 | v1 保留 |
| `/panorama`、`/market-rank`、`/board-calendar(/:code)`、`/stock/:code`、`/search` | 二级 | 二期模块 / 搜索页（稿：market-modules-v2、clean-v2 C1） |

- v1 的 Tab 持久化 key 作废不迁移。
- 个股页 `/stock/:code` 是全站股票名/代码的统一落点（榜单行、日历弹层、全景领涨股、搜索结果行）；代码带市场后缀自动路由行情源。

## 5. 首页版式（Tab1，v3）

自上而下（稿：clean-v2 A1 / 源码 MobileHome.vue）：

1. **实底 navbar**：「股票看板」标题 + ⌕（跳 `/search` 搜索页）。
2. **金刚区 5×2 白卡**：8 实位（今天炒什么 / 行情全景 / 市场榜单 / 板块日历 / 连板 / 异动 / 龙虎榜 / 历史牛熊）+ 2 预留虚线位；tile 底为**浅灰**（`--m-king-ic-bg`：亮 `#eef1f4` / 暗 `#313943`，与页面底、卡面拉开层级），icon 为**每项固定彩色**（`KING_ITEMS.color`，亮暗同一套、不随主题，2026-10-11 定稿）。
3. **指数情绪条**：白底迷你卡横滚（上证 / 深成 / 创业板 / 科创50，现价+涨跌幅）；进入首页刷新一次（30s TTL）。
4. **成交额卡**：30/60/180 日 chips 本地切片；两市（主色面积线）/ 上证（橙）/ 深证（青）三线 SVG；悬停 crosshair 浮层为白卡 + hairline + 柔影。
5. **涨跌分布 · 市场情绪合并卡**：全市场 8 桶分布 + 涨跌家数；情绪行（涨停/跌停/炸板/最高连板/昨涨停均涨）+ 连板梯队药丸（≥3 板红字浅红底强调）。30s 前台轮询。
6. **今天炒什么入口卡**：平台 badge + Top5 预览（名次纯文字，前三湖青加粗）；点整卡跳 `/board`。

状态完备性：分区独立降级（指数 / 成交额 / 分布 / 情绪 / 热榜各自重试互不阻塞）、骨架屏、空态 + 错误态文案、整页下拉刷新强制越过缓存。

## 6. 二期模块要点（稿：market-modules-v2）

- **行情全景** `/panorama`：模块 chips 四项（A股 / 资金 / 美球 / 新股）；A股 = 强涨/红盘/绿盘/强跌统计 4 卡（白底迷你卡）+ 行业/概念切换 + 板块行（涨跌幅胶囊 + 领涨股 + 涨跌家数 mini-bar，点击手风琴展开成分股）；板块资金曲线 + 净流入榜；美股/全球指数/外盘商品列表；新股打新列表。
- **市场榜单** `/market-rank`：9 榜 chips（主力/连板/异动/龙虎/大宗/涨幅/跌幅/成交额/换手）；行右值（净流入等）跟随涨跌着色；**所有榜单行点击进个股页**；切换 chips 用 Vant animated（不带 swipeable）。
- **板块日历** `/board-calendar`：板块×交易日矩阵（白卡内，行头 sticky + 7 档色阶图例常驻，色阶透明度降一档）→ 点格弹白卡 bottom sheet（当日涨跌停明细，个股行可点）→ 板块名进详情矩阵（成分股×日，±2/±5 阈值色）。
- **个股页** `/stock/:code`：报价头（现价大字 + 涨跌 + 3×2 指标网格，最高/最低已移除）→ 周期 chips（分时/五日/日K/周K/月K/5分，与 PC `CHART_PERIOD_OPTIONS` 一致）→ K 线主图+成交量+MACD（复用 PC `KlineChart.vue` 双模式，min 420px）→ 五档盘口 → 底部「交易记录 / ETF 持仓」Tab。**不含 AI 分析入口**（该功能暂不实现）。
- **股票搜索** `/search`：灰底无边框搜索输入（focus 湖青描边）→ 热门搜索双列纯文字名次（1-2 红 / 3-4 橙 / 5-6 灰）→ 结果行（市场标签 + 中性灰代码 + 湖青圆形加号）。

数据口径：与 PC 同接口同字段（api 层在 `src/common/api`）；缓存沿用移动端 30 分钟 TTL（行情类 30s 内存缓存不入盘）；30s 榜单/新闻轮询**仅前台当前视图生效**，页面隐藏即暂停。

## 7. 组件与命名

- 组件前缀 `Mobile*`（views/components），CSS 类前缀 `m-`。
- **玻璃容器仅 `.m-tabbar` 系**（`mobile.css` 内自带加浓 token 覆盖）；`--glass-*` 基础变量仅为 TabBar 兜底保留，新组件禁止消费。
- 新增内容卡一律复用 `.m-card` / `.m-home-panel`（白底 + 12px 圆角 + `--m-card-shadow`），不得各自硬编码白底阴影。
- 滚动安全红线（v1.1.2 结论）：任何悬浮层必须精确控制 `pointer-events`，不得拦截列表触摸；新增悬浮层必须在真机回归「列表上滑 + 下拉刷新」。

## 8. 无障碍与验收

- 骨架动画响应 `prefers-reduced-motion: reduce`；暗色文本对比度 ≥4.5:1（连板梯队强调档 v3 已修复为红字浅红底）。
- 验收基线：360px 宽与暗色主题下无破版；矩阵横滑跟手、sticky 行头不闪烁；轮询暂停恢复无脏数据。
- 埋点：`tracking_mode = none`（沿用 v1/v2 稿口径）。

## 9. 变更记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-10-11 | v3.1 | 金刚区 tile 底改浅灰（`--m-king-ic-bg` 亮/暗两档），icon 改每项固定彩色（不随主题）——替代 v3.0 的湖青单色 tile |
| 2026-10-11 | v3.0 | 清新版基线（稿：stock-board-mobile-ui-clean-v2.html）：内容层去玻璃改白卡 + hairline + 极浅影；页面底平涂；金刚区湖青单色 tile；名次去徽标盒；色彩纪律（来源/代码中性灰、加自选湖青）；连板梯队对比度修复；榜单右值着色统一；**TabBar 保留液态玻璃**（iOS/国产安卓玻璃化趋势）并新增两段缩放+透明度切换动效；二级页通栏改卡片化（12px 边距 + 12px 圆角） |
| 2026-10-10 | v2.0 | 首版：液态玻璃基线 + Tab 重构（首页/热点新闻/我的）+ 二级页形态 + 二期模块要点；对应 v2 两稿附录定论收敛 |
