import {
  BOARD_CELL_TEXT_ON_LIGHT,
  BOARD_CELL_TEXT_ON_STRONG,
  BOARD_SCORE_BUCKET,
  BOARD_SCORE_LEVEL,
} from '../constants/board-calendar.constants';
import type { BoardScoreBucket } from '../types/board-calendar.types';

/**
 * 板块得分色阶（与「板块热力图」同款 7 档语义色）
 *
 * 与 `utils/trend-colors.ts` 的区别：那边返回**求值后的 hex**（ECharts 无法消费 CSS 类），
 * 本页是普通 DOM，直接返回 `var(--color-*)` 即可 —— 颜色由浏览器级联解析，
 * 明暗主题与涨跌配色主题（`<html data-trend>`）切换时**自动生效，无需 JS 重算**。
 *
 * 阈值语义同样与热力图一致（强 / 中 / 弱三档 × 涨跌两向 + 平盘），
 * 只是把被映射的量从「涨跌幅」换成了「得分率」（±1.5 / ±3.0，按实测分布标定）。
 */

/** 档位 → CSS 颜色变量（`var()` 形式，缺失为透明） */
const BUCKET_BACKGROUND: Record<BoardScoreBucket, string> = {
  [BOARD_SCORE_BUCKET.UP_STRONG]: 'var(--color-up-strong)',
  [BOARD_SCORE_BUCKET.UP]: 'var(--color-up)',
  [BOARD_SCORE_BUCKET.UP_LIGHT]: 'var(--color-up-light)',
  [BOARD_SCORE_BUCKET.FLAT]: 'var(--color-flat)',
  [BOARD_SCORE_BUCKET.DOWN_LIGHT]: 'var(--color-down-light)',
  [BOARD_SCORE_BUCKET.DOWN]: 'var(--color-down)',
  [BOARD_SCORE_BUCKET.DOWN_STRONG]: 'var(--color-down-strong)',
  [BOARD_SCORE_BUCKET.NONE]: 'transparent',
};

/**
 * 档位 → 单元格文字色
 *
 * `--color-up-light` / `--color-down-light` 在暗色主题下**未被覆盖**（theme.css 的 .dark
 * 段只覆盖了 `*-weak` 三色），浅底必须配深色文字；深档与平盘用白字。
 */
const BUCKET_TEXT_COLOR: Record<BoardScoreBucket, string> = {
  [BOARD_SCORE_BUCKET.UP_STRONG]: BOARD_CELL_TEXT_ON_STRONG,
  [BOARD_SCORE_BUCKET.UP]: BOARD_CELL_TEXT_ON_STRONG,
  [BOARD_SCORE_BUCKET.UP_LIGHT]: BOARD_CELL_TEXT_ON_LIGHT,
  [BOARD_SCORE_BUCKET.FLAT]: BOARD_CELL_TEXT_ON_STRONG,
  [BOARD_SCORE_BUCKET.DOWN_LIGHT]: BOARD_CELL_TEXT_ON_LIGHT,
  [BOARD_SCORE_BUCKET.DOWN]: BOARD_CELL_TEXT_ON_STRONG,
  [BOARD_SCORE_BUCKET.DOWN_STRONG]: BOARD_CELL_TEXT_ON_STRONG,
  [BOARD_SCORE_BUCKET.NONE]: 'var(--color-text-tertiary)',
};

/**
 * 得分率 → 色阶档位
 * @param scoreRate 得分率（得分 ÷ 成分股数）
 * @returns 档位（0 为中性，正负各按阈值分三档）
 */
export const resolveBoardScoreBucket = (scoreRate: number): BoardScoreBucket => {
  const abs = Math.abs(scoreRate);
  if (scoreRate > 0) {
    if (abs >= BOARD_SCORE_LEVEL.STRONG) return BOARD_SCORE_BUCKET.UP_STRONG;
    if (abs >= BOARD_SCORE_LEVEL.MEDIUM) return BOARD_SCORE_BUCKET.UP;
    return BOARD_SCORE_BUCKET.UP_LIGHT;
  }
  if (scoreRate < 0) {
    if (abs >= BOARD_SCORE_LEVEL.STRONG) return BOARD_SCORE_BUCKET.DOWN_STRONG;
    if (abs >= BOARD_SCORE_LEVEL.MEDIUM) return BOARD_SCORE_BUCKET.DOWN;
    return BOARD_SCORE_BUCKET.DOWN_LIGHT;
  }
  return BOARD_SCORE_BUCKET.FLAT;
};

/**
 * 档位 → 背景色（`var(--color-*)` 形式，随主题级联自动变化）
 * @param bucket 色阶档位
 * @returns CSS 颜色值（无数据为 transparent）
 */
export const getBoardBucketBackground = (bucket: BoardScoreBucket): string =>
  BUCKET_BACKGROUND[bucket];

/**
 * 档位 → 单元格文字色
 * @param bucket 色阶档位
 * @returns CSS 颜色值（深档白字 / 浅档深字 / 无数据三级文字色）
 */
export const getBoardBucketTextColor = (bucket: BoardScoreBucket): string =>
  BUCKET_TEXT_COLOR[bucket];
