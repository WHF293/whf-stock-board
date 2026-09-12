/**
 * 右侧停靠面板（dock panel）常量集中管理
 */

/**
 * 面板内容类型注册（渲染组件映射见 DockPanel.vue 的 CONTENT_COMPONENTS）
 *
 * 当前仅个股详情；后续扩展新内容在此追加 key + 组件映射即可
 */
export const DOCK_PANEL_CONTENT = {
  /** 个股行情详情（K 线 / 分时 / 筹码 / 资金流） */
  STOCK: 'stock',
} as const;

/** 面板内容类型 */
export type DockPanelContentType =
  (typeof DOCK_PANEL_CONTENT)[keyof typeof DOCK_PANEL_CONTENT];

/** 面板宽度下限（像素，同花顺投资账本口径） */
export const DOCK_PANEL_WIDTH_MIN = 400;

/** 面板宽度上限（占视口宽度比例上限） */
export const DOCK_PANEL_WIDTH_MAX_RATIO = 0.6;

/** 面板默认宽度（像素） */
export const DOCK_PANEL_WIDTH_DEFAULT = 560;
