/**
 * 主题色常量（清新绿为默认，data-theme 属性切换，settings store 持久化）
 *
 * 色值需与 `src/assets/styles/theme.css` 里的 `[data-theme='*']` 保持一致：
 * 这里只用于设置页色块展示，真正的换肤发生在 CSS。
 */
export const THEME_COLOR = {
  GREEN: 'green',
  BLUE: 'blue',
  ORANGE: 'orange',
  GOLD: 'gold',
} as const;

/** 主题色类型 */
export type ThemeColor = (typeof THEME_COLOR)[keyof typeof THEME_COLOR];

/**
 * 主题色选项（swatch 供设置页色块展示）
 *
 * ⚠️ swatch 用「亮色模式下的主色」——色块画在弹窗里，需要自身可辨识；
 * 暗色模式下主色不变，所以色块不必区分模式。
 */
export const THEME_COLOR_OPTIONS: readonly { label: string; value: ThemeColor; swatch: string }[] = [
  { label: '清新绿', value: THEME_COLOR.GREEN, swatch: '#0e9488' },
  { label: '淡雅蓝', value: THEME_COLOR.BLUE, swatch: '#4f83cc' },
  { label: '活力橙', value: THEME_COLOR.ORANGE, swatch: '#f97316' },
  { label: '黑金', value: THEME_COLOR.GOLD, swatch: '#c8920b' },
];

/**
 * 判定一个未知值是否为有效主题色（持久化水合校验用：旧版存过的
 * 已删除主题值要拦下来，避免 <html data-theme> 落在无 CSS 规则的值上）
 * @param value 任意值
 * @returns 是否为当前仍支持的主题色
 */
export const isThemeColor = (value: unknown): value is ThemeColor =>
  typeof value === 'string' && (Object.values(THEME_COLOR) as readonly string[]).includes(value);

/** 默认主题色 */
export const THEME_COLOR_DEFAULT: ThemeColor = THEME_COLOR.GREEN;

/** 主题色 CSS 变量名（ECharts 等非 CSS 上下文经 readCssVar 运行时读取） */
export const CSS_VAR_PRIMARY = '--color-primary';
