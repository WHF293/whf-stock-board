import type { ZTPoolItem } from '../types/event.types';
import type { MarketSentiment } from '../types/market-sentiment.types';

/**
 * 由涨停 / 炸板 / 跌停 / 昨日涨停四池聚合市场情绪指标
 *
 * 口径：
 * - 涨停家数 = 涨停池条数；跌停家数 = 跌停池条数；炸板家数 = 炸板池条数
 * - 炸板率 = 炸板 / (涨停 + 炸板)（分母为当日曾触板总数）
 * - 连板梯队 / 高度由涨停池的连板数字段聚合（缺失按首板 1 计）
 * - 昨日涨停均涨 = 昨日涨停池内个股当日涨跌幅均值（打板溢价）
 * @param limitUp 涨停池
 * @param broken 炸板池
 * @param limitDown 跌停池
 * @param yesterdayZt 昨日涨停池
 * @returns 情绪指标聚合结果
 */
export const computeMarketSentiment = (
  limitUp: ZTPoolItem[],
  broken: ZTPoolItem[],
  limitDown: ZTPoolItem[],
  yesterdayZt: ZTPoolItem[],
): MarketSentiment => {
  const counts = new Map<number, number>();
  let maxLadder = 0;
  let continuousCount = 0;
  for (const item of limitUp) {
    const board = item.continuousBoardCount ?? 1;
    counts.set(board, (counts.get(board) ?? 0) + 1);
    if (board > maxLadder) {
      maxLadder = board;
    }
    if (board >= 2) {
      continuousCount += 1;
    }
  }
  const touchedTotal = limitUp.length + broken.length;
  const yesterdayPcts = yesterdayZt
    .map((item) => item.changePercent)
    .filter((pct): pct is number => pct !== null);
  return {
    limitUpCount: limitUp.length,
    limitDownCount: limitDown.length,
    brokenCount: broken.length,
    brokenRate: touchedTotal > 0 ? (broken.length / touchedTotal) * 100 : null,
    ladder: [...counts.entries()]
      .map(([board, count]) => ({ board, count }))
      .sort((a, b) => b.board - a.board),
    maxLadder,
    continuousCount,
    yesterdayZtAvgPct:
      yesterdayPcts.length > 0
        ? yesterdayPcts.reduce((acc, pct) => acc + pct, 0) / yesterdayPcts.length
        : null,
  };
};
