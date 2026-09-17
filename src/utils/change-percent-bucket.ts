import { BOARD_SCORE_BUCKET } from '../constants/board-calendar.constants';
import { TREND_COLOR_LEVEL } from '../constants/stock-colors.constants';
import { TREND_FLAT_THRESHOLD } from '../constants/trend.constants';
import type { BoardScoreBucket } from '../types/board-calendar.types';

/**
 * 个股涨跌幅 → 7 档涨跌语义色档位
 *
 * 复用板块日历的档位常量与 `getBoardBucketBackground` / `getBoardBucketTextColor`，
 * 只把被映射的量从「板块得分率」换成「个股涨跌幅」，阈值取 `TREND_COLOR_LEVEL`
 * （±2 / ±5），与板块热力图对涨跌幅的档位一致。
 * @param changePercent 涨跌幅（百分数；null 表示该日无行情）
 * @returns 色阶档位（无行情为 none）
 */
export const resolveChangePercentBucket = (
  changePercent: number | null,
): BoardScoreBucket => {
  if (changePercent === null || !Number.isFinite(changePercent)) {
    return BOARD_SCORE_BUCKET.NONE;
  }
  const abs = Math.abs(changePercent);
  if (changePercent > TREND_FLAT_THRESHOLD) {
    if (abs >= TREND_COLOR_LEVEL.STRONG) return BOARD_SCORE_BUCKET.UP_STRONG;
    if (abs >= TREND_COLOR_LEVEL.MEDIUM) return BOARD_SCORE_BUCKET.UP;
    return BOARD_SCORE_BUCKET.UP_LIGHT;
  }
  if (changePercent < -TREND_FLAT_THRESHOLD) {
    if (abs >= TREND_COLOR_LEVEL.STRONG) return BOARD_SCORE_BUCKET.DOWN_STRONG;
    if (abs >= TREND_COLOR_LEVEL.MEDIUM) return BOARD_SCORE_BUCKET.DOWN;
    return BOARD_SCORE_BUCKET.DOWN_LIGHT;
  }
  return BOARD_SCORE_BUCKET.FLAT;
};
