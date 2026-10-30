import type { BoardDailyRow } from '../types/board-calendar.types.ts';
import type { BoardMainlineCell, BoardMainlineMatrix } from '../types/board-calendar.types.ts';

/**
 * 构建板块分析矩阵：每个交易日按指定口径取前 N 名，转置成「行 = 名次位、列 = 交易日」
 *
 * 口径（2026-10-29 王总指定板块Top 按真实得分降序，替代原「成交额」与「得分绝对值」口径）：
 * - 'score'：当日真实得分（带符号）降序——得分高的板块（做多主线）排前，大跌板块自然沉底；
 * - 'amount'：当日成交额降序（null 缺额排末位）——资金在哪些板块聚集一目了然。
 * 同一板块跨多天停留在同名次附近 = 资金集中做一条主线；
 * 各日板块名频繁变换 = 市场在快速轮动。
 *
 * 只使用入参给出的交易日（与日历矩阵同一份范围口径）；
 * 数值相同时按入参原始顺序稳定排序（与落库读出顺序一致，可复现）。
 * @param dailyRows 板块日聚合行（不限定范围，函数内部按 dates 过滤）
 * @param dates 需要展示的交易日（降序，最近在左）
 * @param topN 每日取前几名
 * @param sortBasis 排序口径：'score' = 真实得分（默认）/'amount' = 当日成交额
 * @returns 主线矩阵（ranks 行数 = topN，每行与 dates 下标对齐）
 */
export const buildBoardMainlineMatrix = (
  dailyRows: readonly BoardDailyRow[],
  dates: readonly string[],
  topN: number,
  sortBasis: 'amount' | 'score' = 'score',
): BoardMainlineMatrix => {
  const byDate = new Map<string, BoardDailyRow[]>();
  for (const row of dailyRows) {
    if (!dates.includes(row.tradeDate)) continue;
    const list = byDate.get(row.tradeDate);
    if (list) {
      list.push(row);
    } else {
      byDate.set(row.tradeDate, [row]);
    }
  }

  const byBasis = (a: BoardDailyRow, b: BoardDailyRow): number =>
    sortBasis === 'score'
      ? b.score - a.score
      : (b.amount ?? -1) - (a.amount ?? -1);

  /** 每日的前 N 名（与 dates 下标对齐；不足 N 名时截断） */
  const topByDate: BoardMainlineCell[][] = dates.map((date) =>
    (byDate.get(date) ?? [])
      .slice()
      .sort(byBasis)
      .slice(0, topN)
      .map((row) => ({
        tradeDate: row.tradeDate,
        boardCode: row.boardCode,
        boardName: row.boardName,
        amount: row.amount,
        limitUp: row.limitUp,
        limitDown: row.limitDown,
        score: row.score,
        scoreRate: row.scoreRate,
        dataLevel: row.dataLevel,
      })),
  );

  const ranks: (BoardMainlineCell | null)[][] = Array.from({ length: topN }, (_, rankIndex) =>
    dates.map((_, dateIndex) => topByDate[dateIndex][rankIndex] ?? null),
  );
  return { dates: [...dates], ranks };
};
