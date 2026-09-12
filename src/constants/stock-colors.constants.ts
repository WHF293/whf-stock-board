import type { Trend } from './trend.constants';

/**
 * 涨跌语义色（图表用 hex，与 theme.css 的 --color-up/--color-down token 同源）
 *
 * A 股习惯：红涨绿跌
 */
export const UP_COLOR = '#e02020';
/** 深涨色：强涨幅（|涨跌幅| >= 5） */
export const UP_COLOR_STRONG = '#c51616';
/** 浅涨色：弱涨幅 */
export const UP_COLOR_LIGHT = '#f2a6a6';
/** 极浅涨色：最弱涨幅（分布图 0~3 桶） */
export const UP_COLOR_PALE = '#f8d7d7';
export const DOWN_COLOR = '#00b578';
/** 深跌色：强跌幅（|涨跌幅| >= 5） */
export const DOWN_COLOR_STRONG = '#00925f';
/** 浅跌色：弱跌幅 */
export const DOWN_COLOR_LIGHT = '#8fd9bd';
/** 极浅跌色：最弱跌幅（分布图 -3~0 桶） */
export const DOWN_COLOR_PALE = '#ccefe0';
/** 平盘色 */
export const FLAT_COLOR = '#8a94a6';

/** 色阶阈值（百分数）：决定用深色 / 标准色 / 浅色 */
export const TREND_COLOR_LEVEL = {
  STRONG: 5,
  MEDIUM: 2,
} as const;

/**
 * 依据涨跌幅取图表用色（红涨绿跌三档色阶）
 * @param changePercent 涨跌幅（百分数数值）
 * @returns hex 色值
 */
export const getTrendColor = (changePercent: number): string => {
  const abs = Math.abs(changePercent);
  if (changePercent > 0) {
    if (abs >= TREND_COLOR_LEVEL.STRONG) return UP_COLOR_STRONG;
    if (abs >= TREND_COLOR_LEVEL.MEDIUM) return UP_COLOR;
    return UP_COLOR_LIGHT;
  }
  if (changePercent < 0) {
    if (abs >= TREND_COLOR_LEVEL.STRONG) return DOWN_COLOR_STRONG;
    if (abs >= TREND_COLOR_LEVEL.MEDIUM) return DOWN_COLOR;
    return DOWN_COLOR_LIGHT;
  }
  return FLAT_COLOR;
};

/** 涨跌方向 -> 文本色类名（对应 theme.css 的 --color-* token） */
export const TREND_TEXT_CLASS: Record<Trend, string> = {
  up: 'text-up',
  down: 'text-down',
  flat: 'text-flat',
};

/** 涨跌方向 -> 胶囊样式类名（弱色底 + 语义文字色） */
export const TREND_PILL_CLASS: Record<Trend, string> = {
  up: 'bg-up-weak text-up',
  down: 'bg-down-weak text-down',
  flat: 'bg-flat-weak text-flat',
};
