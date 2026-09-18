/**
 * 初始设置引导弹窗常量
 *
 * 弹窗为左右分栏：左栏展示界面预览图 + 欢迎语，右栏收集三项外观偏好
 * （明暗模式 / 主题色 / 涨跌配色）。选项清单复用 `theme-color.constants.ts`
 * 与 `trend-theme.constants.ts`（与设置页同源）。
 *
 * **两处入口共用同一组件**，仅文案不同（组件 `mode` prop 切换）：
 * - `first-run`：新用户首次打开软件时自动弹出一次；
 * - `settings`：设置页「主题设置」按钮手动唤起（老用户想改外观时走这里）。
 */

/** 弹窗名称（左栏大标题，同时作为 role=dialog 的 aria-label —— 本弹窗无独立标题栏） */
export const FIRST_RUN_TITLE = '欢迎使用股票看板';

/** 右栏顶部小标签 */
export const FIRST_RUN_BADGE = '首次启动设置';

/** 左栏副标题（大标题下方一句话说明） */
export const FIRST_RUN_WELCOME_DESC =
  '先花 10 秒选好界面外观。以下设置即时生效，之后可随时在「设置」中调整。';

/** 左栏界面预览图（public/ 下静态资源，不经打包，弹窗打开时才请求） */
export const FIRST_RUN_PREVIEW_SRC = '/onboarding/app-preview.png';

/** 左栏界面预览图替代文本 */
export const FIRST_RUN_PREVIEW_ALT = '股票看板界面预览';

/** 明暗模式分组标签 */
export const FIRST_RUN_APPEARANCE_LABEL = '外观模式';

/** 明暗模式说明文案 */
export const FIRST_RUN_APPEARANCE_HINT = '选择亮色或暗色界面，右上角可随时切换';

/**
 * 明暗模式选项（value 即 isDark 目标值；icon 为 MenuIcon 名称）
 *
 * 与设置页的顶栏明暗开关同语义：白天 = 移除 <html class="dark">，黑暗 = 挂上。
 */
export const FIRST_RUN_APPEARANCE_OPTIONS: readonly {
  value: boolean;
  label: string;
  icon: string;
}[] = [
  { value: false, label: '白天模式', icon: 'sun' },
  { value: true, label: '黑暗模式', icon: 'moon' },
];

/** 主题色分组标签 */
export const FIRST_RUN_THEME_LABEL = '系统主题色';

/** 涨跌配色分组标签 */
export const FIRST_RUN_TREND_LABEL = '涨跌主题色';

/** 涨跌配色分组说明文案 */
export const FIRST_RUN_TREND_HINT = '决定全站行情文本与图表的涨 / 跌颜色';

/** 完成按钮文案 */
export const FIRST_RUN_DONE_BUTTON = '开始使用';

// ---------- 设置页语境（mode: 'settings'）替换文案 ----------
// 弹窗被设置页「主题设置」按钮复用时，上面四条「首次启动」口吻的文案不再成立，替换为下列中性表述。

/** 左栏大标题（设置页语境） */
export const FIRST_RUN_SETTINGS_TITLE = '界面外观';

/** 右栏顶部小标签（设置页语境） */
export const FIRST_RUN_SETTINGS_BADGE = '主题设置';

/** 左栏副标题（设置页语境） */
export const FIRST_RUN_SETTINGS_DESC =
  '明暗模式、系统主题色与涨跌配色都在这里调整，选择即时生效并自动记住。';

/** 完成按钮文案（设置页语境） */
export const FIRST_RUN_SETTINGS_DONE_BUTTON = '完成';
