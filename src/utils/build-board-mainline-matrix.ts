import type { BoardDailyRow } from '../types/board-calendar.types';
import type { BoardMainlineCell, BoardMainlineMatrix } from '../types/board-calendar.types';

/**
 * 构建板块分析矩阵：每个交易日按得分**绝对值**取前 N 名，转置成「行 = 名次位、列 = 交易日」
 *
 * 用绝对值口径：大跌的板块同样有分析价值（资金砸向哪里），
 * 多空方向由单元格色阶（得分率正负）区分。
 * 同一板块跨多天停留在同名次附近 = 资金集中做一条主线；
 * 各日板块名频繁变换 = 市场在快速轮动。
 *
 * 只使用入参给出的交易日（与日历矩阵同一份范围口径）；
 * 绝对值相同按入参原始顺序稳定排序（与落库读出顺序一致，可复现）。
 * @param dailyRows 板块日聚合行（不限定范围，函数内部按 dates 过滤）
 * @param dates 需要展示的交易日（降序，最近在左）
 * @param topN 每日取前几名
 * @returns 主线矩阵（ranks 行数 = topN，每行与 dates 下标对齐）
 */
export const buildBoardMainlineMatrix = (
  dailyRows: readonly BoardDailyRow[],
  dates: readonly string[],
  topN: number,
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

  /** 每日的前 N 名（与 dates 下标对齐；不足 N 名时截断） */
  const topByDate: BoardMainlineCell[][] = dates.map((date) =>
    (byDate.get(date) ?? [])
      .slice()
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, topN)
      .map((row) => ({
        tradeDate: row.tradeDate,
        boardCode: row.boardCode,
        boardName: row.boardName,
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
