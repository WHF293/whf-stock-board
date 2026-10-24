/**
 * 右侧停靠面板（dock panel）常量集中管理
 */

/**
 * 面板内容类型注册（渲染组件映射见 DockPanel.vue 的 CONTENT_COMPONENTS）
 *
 * 新增内容类型在此追加 key + 组件映射 + 内容参数（DockPanel 内 contentProps）即可
 */
export const DOCK_PANEL_CONTENT = {
  /** 个股行情详情（K 线 / 分时 / 筹码 / 资金流） */
  STOCK: 'stock',
  /** 插件贡献的停靠面板（具体渲染哪个由 store 的 pluginPanelKey 决定） */
  PLUGIN: 'plugin',
  /** 期货品种产业链基本面（同花顺产业链 F10 页面 iframe 嵌入，期货总览页发起） */
  CHAIN: 'chain',
  /** 个股 F10 资料抽屉（财务 / 资讯 / 基本资料 / 发行相关 / 高管简介 / 参股控股，详情页发起） */
  F10: 'f10',
} as const;

/** 面板内容类型 */
export type DockPanelContentType =
  (typeof DOCK_PANEL_CONTENT)[keyof typeof DOCK_PANEL_CONTENT];

/** 面板宽度下限（像素，最小可接受宽度 375） */
export const DOCK_PANEL_WIDTH_MIN = 375;

/** 面板宽度上限（占视口宽度比例上限） */
export const DOCK_PANEL_WIDTH_MAX_RATIO = 0.6;

/** 面板默认宽度（像素） */
export const DOCK_PANEL_WIDTH_DEFAULT = 560;

/**
 * Islands 布局的画布留白（像素，2026-10-22 PC 布局岛化）
 *
 * MainLayout 内容行四周 p-2.5（10px）露出画布底色：停靠面板右缘不再贴视口右缘，
 * 拖拽宽度换算「鼠标 X → 面板宽度」时须扣除这份留白，否则松手后左缘偏移 10px。
 * 与 MainLayout 内容行的 p-2.5 / gap-2.5 必须同步改。
 */
export const DOCK_LAYOUT_CANVAS_PADDING = 10;
