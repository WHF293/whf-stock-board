import type { DailyCloseBar, StockWindowChange } from '../types/board-detail.types';

/**
 * 由日 K 收盘序列计算「窗口内逐日涨跌幅 + 区间累计涨跌幅」
 *
 * 纯函数（无 IO、无时间依赖），入参 `bars` 是**连续**的日 K（升序，来自上游原样），
 * `dates` 是要取值的交易日窗口（降序，与矩阵列序一致）。
 *
 * 关键点：某一日的前一根必须在 `bars` 里 —— 取数侧因此多取
 * `BOARD_DETAIL_FETCH_BARS - 窗口长度` 根缓冲，缺了就返回 null（不拿 0 冒充平盘）。
 * @param bars 日 K 收盘序列（升序、连续）
 * @param dates 交易日窗口（降序，最近的在最前）
 * @returns 逐日涨跌幅与区间累计涨跌幅（百分数，如 2.35 表示 +2.35%）
 */
export const calcWindowChangePercents = (
  bars: readonly DailyCloseBar[],
  dates: readonly string[],
): StockWindowChange => {
  const indexByDate = new Map<string, number>();
  bars.forEach((bar, index) => {
    indexByDate.set(bar.tradeDate, index);
  });

  const cells: (number | null)[] = dates.map((date) => {
    const index = indexByDate.get(date);
    if (index === undefined || index === 0) {
      return null;
    }
    const prev = bars[index - 1].close;
    if (prev <= 0) {
      return null;
    }
    return (bars[index].close / prev - 1) * 100;
  });

  // 区间累计：窗口内最后一个可得收盘 ÷ 窗口内最早就可得交易日的「前一根」收盘 − 1
  // （按收盘价比值算，而不是把逐日涨跌幅连乘 —— 停牌缺口的复利口径会漂）
  let firstIndex = -1;
  let lastIndex = -1;
  for (let i = 0; i < dates.length; i += 1) {
    const index = indexByDate.get(dates[i]);
    if (index !== undefined) {
      if (lastIndex === -1) lastIndex = index;
      firstIndex = index;
    }
  }
  const base = firstIndex > 0 ? bars[firstIndex - 1].close : 0;
  const cumulative =
    firstIndex === -1 || base <= 0 ? null : (bars[lastIndex].close / base - 1) * 100;

  return { cells, cumulative };
};
