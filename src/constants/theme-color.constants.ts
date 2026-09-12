/**
 * 主题色常量（清新绿为默认，data-theme 属性切换，settings store 持久化）
 */
export const THEME_COLOR = {
  GREEN: 'green',
  BLUE: 'blue',
  PINK: 'pink',
  PURPLE: 'purple',
} as const;

/** 主题色类型 */
export type ThemeColor = (typeof THEME_COLOR)[keyof typeof THEME_COLOR];

/** 主题色选项（swatch 供设置页色块展示） */
export const THEME_COLOR_OPTIONS: readonly { label: string; value: ThemeColor; swatch: string }[] = [
  { label: '清新绿', value: THEME_COLOR.GREEN, swatch: '#0e9488' },
  { label: '淡雅蓝', value: THEME_COLOR.BLUE, swatch: '#4f83cc' },
  { label: '淡雅粉', value: THEME_COLOR.PINK, swatch: '#e886a8' },
  { label: '极光紫', value: THEME_COLOR.PURPLE, swatch: '#9061f9' },
];

/** 默认主题色 */
export const THEME_COLOR_DEFAULT: ThemeColor = THEME_COLOR.GREEN;

/** 主题色 CSS 变量名（ECharts 等非 CSS 上下文经 readCssVar 运行时读取） */
export const CSS_VAR_PRIMARY = '--color-primary';
