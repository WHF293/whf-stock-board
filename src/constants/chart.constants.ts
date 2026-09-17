/**
 * ECharts 通用配色（与 theme.css 的文本 / 边线 token 同源的 hex 值）
 */

/** 轴标签文本色 */
export const CHART_TEXT_COLOR = '#5c6b80';

/** 轴线颜色 */
export const CHART_AXIS_LINE_COLOR = '#e5eaf0';

/** 分隔线颜色 */
export const CHART_SPLIT_LINE_COLOR = '#eef1f5';

/**
 * K 线图网格线颜色取值的 CSS 变量名（--color-flat-weak）
 *
 * 亮色 #eef1f5 / 暗色 #232a33，随主题自动切换；canvas 内不能直接用 var()，
 * 由 KlineChart 经 readCssVar 解析（消费方需在明暗切换时重设样式）
 */
export const CHART_GRID_LINE_CSS_VAR = '--color-flat-weak';

/** 图表系列间分隔色（热力图网格线，同卡片面） */
export const CHART_GAP_COLOR = '#ffffff';

/** 热力图标签文字色（深色底上的白字） */
export const CHART_LABEL_ON_TREND_COLOR = '#ffffff';

/** K 线主图价格轴三等分段数 */
export const PRICE_AXIS_SPLIT = 3;

/** K 线主图价格轴上下扩展比例（避免极值贴边） */
export const PRICE_AXIS_PAD_RATIO = 0.05;

/** X 轴刻度数量（非分时：可见区按此等分） */
export const AXIS_TICK_COUNT = 5;

/**
 * 蜡烛模式主图水平网格线条数（含上下界）
 *
 * 刻度 = 上下界 + 中间等分点，横向把主图区等分为 (本值 - 1) 格；
 * 纵向网格线蜡烛模式不开启
 */
export const CANDLE_Y_AXIS_TICK_COUNT = 4;

/** 分时图价格线固定颜色（淡雅蓝，不随涨跌配色主题变化） */
export const MINUTE_LINE_COLOR = '#4f83cc';
