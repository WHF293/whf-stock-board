---
version: alpha
name: whf-stock-board-design-analysis
description: >
  WHF 股票看板的设计语言：一款清爽、克制、数据密度优先的 A 股行情看板（Vue 3 + Tailwind v4 + Tauri 桌面端）。
  画布基调为浅灰青（#f7f9fa），卡片为白色面 + 12px 圆角 + 柔和双层阴影，整体通透轻盈。
  主色为湖青（#0e9488）——刻意中性偏冷，与涨跌语义色（默认红涨绿跌）完全隔离，保证行情语义不与品牌色混淆。
  涨跌配色采用四档色阶（strong / 标准 / light / pale + weak 底色），文本与 ECharts 图表双轨消费同一套 token。
  支持暗色模式（class 策略）、三套主题色（清新绿/蓝/粉/紫）与三套涨跌配色主题（红涨绿跌/红跌绿涨/红涨蓝跌），
  全部通过 CSS 变量在 <html> 属性级联覆盖实现，全站自动跟随。
  字体走系统默认栈，无花哨装饰；信息呈现依赖间距、色阶与吸顶表格，而非线框。风格关键词：清爽、克制、数据密度优先、语义色驱动。
colors:
  primary: "#0e9488"
  on-primary: "#ffffff"
  primary-weak: "#e6f5f3"
  primary-hover: "opacity 90%（不换色，hover 用透明度）"
  ink: "#1f2733"
  ink-muted: "#5c6b80"
  ink-subtle: "#98a2b3"
  canvas: "#f7f9fa"
  surface-1: "#ffffff"
  hairline: "flat-weak 底色承担分隔（#eef1f5），项目不使用 1px 边框线"
  semantic-up: "#e02020"
  semantic-up-strong: "#c51616"
  semantic-up-light: "#f2a6a6"
  semantic-up-pale: "#f8d7d7"
  semantic-up-weak: "#fdecec"
  semantic-down: "#00b578"
  semantic-down-strong: "#00925f"
  semantic-down-light: "#8fd9bd"
  semantic-down-pale: "#ccefe0"
  semantic-down-weak: "#e6f7f1"
  semantic-flat: "#8a94a6"
  semantic-flat-weak: "#eef1f5"
  dark:
    canvas: "#101418"
    surface-1: "#1a2027"
    primary-weak: "#123f3b"
    ink: "#e6eaf0"
    ink-muted: "#9aa6b6"
    ink-subtle: "#6b7686"
    semantic-up-weak: "#3a1a1a"
    semantic-down-weak: "#12332a"
    semantic-flat-weak: "#232a33"
typography:
  page-title:
    fontFamily: 系统默认栈（未声明 webfont）
    fontSize: 16px
    fontWeight: 600
  card-title:
    fontFamily: 系统默认栈
    fontSize: 14px
    fontWeight: 600
  body:
    fontFamily: 系统默认栈
    fontSize: 14px
    fontWeight: 400
  body-sm:
    fontFamily: 系统默认栈
    fontSize: 12px
    fontWeight: 400
  caption:
    fontFamily: 系统默认栈
    fontSize: 12px
    fontWeight: 500
  button:
    fontFamily: 系统默认栈
    fontSize: 14px
    fontWeight: 500
  nav-active:
    fontFamily: 系统默认栈
    fontSize: 14px
    fontWeight: 500
rounded:
  card: 12px
  control: 8px（rounded-lg，按钮/输入框/菜单项）
  tag: 9999px（胶囊）
  scrollbar-thumb: 9999px
spacing:
  card-padding: 16px（p-4）
  control-y: 6px（py-1.5）
  control-x: 12px（px-3）
  card-header-gap: 12px（mb-3）
  element-gap: 4px / 8px 基准
components:
  card:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.card}"
    shadow: "{shadow.card}"
    padding: 16px
  card-header:
    typography: "{typography.card-title}"
    textColor: "{colors.ink}"
    layout: "flex justify-between gap-2，右侧为 extra 插槽"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    hover: "opacity 0.9"
    pressed: "scale 0.95（pressable + active:scale-95）"
  button-ghost:
    backgroundColor: "{colors.semantic-flat-weak}"
    textColor: "{colors.ink}"
    hover: "背景透明度 0.7"
  button-danger:
    backgroundColor: "{colors.semantic-up-weak}"
    textColor: "{colors.semantic-up}"
    hover: "opacity 0.8"
  text-input:
    backgroundColor: "{colors.semantic-flat-weak}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    placeholder: "{colors.ink-subtle}"
  text-input-focused:
    ring: "1px {colors.primary}"
  status-tag:
    backgroundColor: "语义 weak 色（如 bg-up-weak）"
    textColor: "对应语义色（如 text-up）"
    rounded: "{rounded.tag}"
    padding: "2px 8px"
    typography: "{typography.caption}"
  nav-item:
    inactive: "text-text-secondary，hover 提亮"
    active: "bg-primary-weak + text-primary + font-medium"
    rounded: "{rounded.control}"
  top-nav:
    layout: "左侧图标导航（桌面固定 / 窄屏抽屉）+ 头部页标题 + 交易时段徽标 + 明暗切换"
  data-table:
    container: "table-scroll（max-height 560/400/360px 三档），表头吸顶、第一列吸左"
    row-hover: "整行与首列底色变为 flat-weak"
  quote-flash:
    animation: "涨/跌 weak 色底 600ms ease-out 淡出（flash-up / flash-down，:key 重放）"
---

# WHF 股票看板 · 设计规范

## Overview

本项目是一款 A 股行情看板桌面应用（Vue 3 + Tailwind CSS 4 + Tauri），设计上**数据密度优先、装饰克制**。

**Key Characteristics：**

- 浅灰青画布 + 白色卡片面，柔和双层阴影，12px 卡片圆角
- 湖青主色刻意中性偏冷，与涨跌语义色完全隔离
- A 股习惯「红涨绿跌」为默认语义，四档色阶（strong/标准/light/pale + weak 底色）供文本与图表双轨消费
- 三套可切换主题：主题色（data-theme）、涨跌配色（data-trend）、明暗模式（html.dark），全部 CSS 变量级联覆盖
- 无 1px 边框线，分隔靠弱色底与留白；表格吸顶吸左，滚动条细滑透明轨道

**注意**：本项目的 token 单源是 `src/assets/styles/theme.css`（Tailwind 4 `@theme`），图表侧与 `src/constants/stock-colors.constants.ts` 保持同源。改色值时两处必须同步。

## Colors

### Brand & Accent

- 主色 `{colors.primary}` `#0e9488`（清新绿，默认）：按钮、激活导航、进度条、focus ring
- 主色弱底 `{colors.primary-weak}`：激活态背景
- 可切换主题色：blue `#4f83cc` / pink `#e886a8` / purple `#9061f9`（写入 `<html data-theme>`）

### Surface

- 画布 `{colors.canvas}`：页面底色，清新的浅灰青
- 表面 `{colors.surface-1}`：卡片、表头、吸顶单元格
- 分隔色 `{colors.semantic-flat-weak}`：ghost 按钮底、输入框底、行 hover 底

### Text

- `{colors.ink}` 主文本 / `{colors.ink-muted}` 次级 / `{colors.ink-subtle}` 弱化与 placeholder

### Semantic（涨跌语义，项目核心）

四档色阶按 |涨跌幅| 分档：≥5% 用 strong，≥2% 用标准色，其余用 light；pale 供分布图桶色；weak 供胶囊底与闪烁动画：

| 档位 | 涨（默认红） | 跌（默认绿） |
| --- | --- | --- |
| strong | `#c51616` | `#00925f` |
| 标准 | `#e02020` | `#00b578` |
| light | `#f2a6a6` | `#8fd9bd` |
| pale | `#f8d7d7` | `#ccefe0` |
| weak 底 | `#fdecec` | `#e6f7f1` |

平盘 `{colors.semantic-flat}` `#8a94a6`。

**涨跌配色主题可切换**（`<html data-trend>`）：`red_up`（默认）/ `green_up`（红跌绿涨）/ `blue_down`（跌为蓝 `#2f6fed`）。文本类用 `text-up`/`text-down` 等 token 类名，图表组件读 CSS 变量重绘，两轨自动跟随。

### Dark Mode

class 策略（`<html class="dark">`），`@custom-variant dark`。覆盖 canvas/surface/文本三级/各 weak 底色与阴影；涨跌标准色不变，仅弱色底加深。

## Typography

系统默认字体栈，未引入 webfont。层级极简：

| 层级 | 字号/字重 | 用途 |
| --- | --- | --- |
| page-title | 16px / 600 | 页头标题、侧栏 logo |
| card-title | 14px / 600 | 卡片标题 |
| body | 14px / 400 | 正文、表格内容 |
| button / nav-active | 14px / 500 | 按钮、激活导航项 |
| body-sm / caption | 12px | 次级信息、标签、表格辅助列 |

## Layout

- 卡片内边距 16px；卡片头部与内容间距 12px
- 控件 padding 6px × 12px；元素间距以 4px / 8px 为基准
- 表格滚动容器三档：`table-scroll`（560px，整页宽表格）/ `table-scroll-sm`（400px，卡片内小表格）/ `table-scroll-xs`（360px，紧凑排行）；表头 `sticky top-0`，第一列 `sticky left-0`，左上角单元格双向固定 z-index 最高
- 报价卡片栅格 `quote-card-grid`：**所有卡片等宽**、每行张数由可用宽度决定（`repeat(auto-fill, minmax(min(350px, max(200px, calc(25% - 0.75rem))), 1fr))`）——容器够宽按 350px 起排，不够 4 张 350px 时按 4 等分收缩，窄到 848px 以下才退回 200px 下限自然换行（指数卡片等多卡并列场景统一用它，不再写死 `grid-cols-4`；必须 auto-fill，auto-fit 会拉伸末行）
- 指数卡片「首行裁剪」容器 `row-clamp` + `useRowClamp`：卡片**全部渲染**，收起态把容器高度实测固定为「首行高度」并 `overflow: clip` 裁掉其余行，展开态切到栅格总高，高度过渡 320ms（`prefers-reduced-motion` 下关闭）→ 一行显示几张完全由宽度决定，宽度只放得下 3 张时第 4 张自动被裁掉；窗口变宽首行能放下更多，一行放下全部时展开开关整个不渲染
- 布局骨架：左侧图标导航（桌面固定、窄屏抽屉）+ 头部（页标题、交易时段徽标、明暗切换）+ 右侧可收起停靠面板
- 主区内容上限 1600px（`MainLayout` 的 `max-w-[1600px]`）：为报价卡片栅格留出余量（上限内按列数公式排布）

## Elevation & Depth

- 卡片阴影 `{shadow.card}`：`0 1px 3px rgb(31 39 51 / 0.06), 0 4px 16px rgb(31 39 51 / 0.06)`；暗色下改为 `0 1px 3px rgb(0 0 0 / 0.4)`
- 无边框线、无分层面板阶梯——深度仅靠阴影与底色差表达
- 装饰性深度：报价变动的 weak 色底闪烁动画（600ms ease-out 淡出）、NProgress 主色顶部进度条（3px）

## Shapes

- 卡片 12px（`rounded-card` token）
- 控件（按钮/输入框/导航项/菜单）8px（`rounded-lg`）
- 标签/胶囊 9999px；滚动条滑块 9999px
- 按压反馈：`pressable` 工具类（150ms ease，transition 覆盖 transform 与颜色类属性）+ `active:scale-95`

## Components

组件以 `src/components/ui/` 的 Base* 系列为实现单源，样式见 frontmatter components 一节：

- **BaseCard**：卡片单源，`rounded-card bg-surface p-4 shadow-card`，可选标题 + extra 插槽
- **BaseButton**：primary（主色底白字）/ ghost（flat-weak 底）/ danger（up-weak 底红字）三变体，hover 用透明度、按下 scale-95
- **BaseInput**：flat-weak 底无边框，focus 时 1px 主色 ring
- **BaseTag**：胶囊形，语义 weak 底 + 语义文字色
- **BaseTable / table-scroll**：数据表单源，吸顶吸左见 Layout 节
- **BaseTabs / BaseSwitch / BaseSkeleton / BaseEmpty / BaseConfirmModal / BaseTooltip**：同风格基础件，新增组件前先复用

## Do's and Don'ts

**Do：**

- 一切色值从 `theme.css` 的 `@theme` token 取，Tailwind 类如 `text-up`、`bg-surface` 直接消费
- 涨跌语义一律用 `text-up/text-down/text-flat` 类名或 `getTrendColor()`，绝不写死红/绿 hex
- 图表用色与 `stock-colors.constants.ts` 同源；需要图表跟随涨跌主题时读 CSS 变量重绘
- 新组件优先复用 Base* 系列；按压类控件加 `pressable` + `active:scale-95`
- 暗色适配：新色值必须同时补 `.dark` 覆盖

**Don't：**

- 不引入 token 之外的颜色、字号、圆角值
- 不用 1px 边框线做卡片/分隔（用弱色底与留白）
- 不引入 webfont、不改变系统字体栈
- 不把品牌主色用于涨跌语义（主色必须与语义色隔离）
- 不写死「红=涨」，语义方向随 `data-trend` 主题切换

## Responsive Behavior

- 桌面端侧栏常驻，窄屏折叠为抽屉（`useMediaQuery` 驱动）
- 右上角工具条 = 宿主内置项 + 插件条目（`ctx.header`），顺序与显隐由设置页「顶栏工具」编排；插件轮播条目不展示图标，收起态为 Swiper 式上下滑动切换，视窗 170px 全固定 = 名称 5 字（60，与价格零间距）+ 价格 48（按 `99999.99` 冗余预留）+ 间距 2 + 涨跌幅 60（按 `+9999.99%` 冗余预留），涨跌幅与右侧展开箭头之间留一点间距，各段位置恒定、不推挤相邻按钮
- 表格纵向 + 横向滚动，靠吸顶/吸左保持上下文，不做响应式列裁剪
- 触控/按压目标遵循控件统一高度（py-1.5 + text-sm）

## Iteration Guide

- 改主题色 / 涨跌配色：只动 `theme.css`（图表侧同步 `stock-colors.constants.ts`），不要在各组件里散改
- 新增 token：加进 `@theme` 块并同步 `.dark` 覆盖，再在本文档 frontmatter 登记
- 组件新增变体：进 Base* 组件的 VARIANT_CLASS 映射，不另起炉灶

## Known Gaps

- 未定义 display 级大标题与等宽字体 token（行情数字未用 mono 字体，如需可补 `mono` token）
- hairline 边框体系不存在（有意为之）；若未来需要细边框需先立项 token
- 断点策略依赖 Tailwind 默认断点，未定义自定义断点
