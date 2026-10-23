import { COMPARE_COMMON_RATIO_MIN } from '../constants/compare.constants';
import type { CompareNormalized, CompareSeriesInput } from '../types/compare.types';

/**
 * 多票日 K 归一化对齐：并集日期轴 + 停牌 forward-fill + 共同基准日折算基准 100
 *
 * 口径：
 * - 横轴 = 全组日期并集（YYYY-MM-DD 升序），停牌位置沿用前一收盘（forward-fill）；
 * - 基准日 = 全组都有值的最早交易日；每票归一值 = 当日有效收盘 / 基准日收盘 × 100；
 *   晚上市票（基准日无值）以自己首个交易日收盘为基准（曲线起点也是 100，
 *   但起点晚于组基准日——统计口径一致，均为「相对自身起点」）；
 * - 基准日之前的日期直接丢弃（无任何跨票可比性）；
 * - 各票有效天数 / 区间长度低于 COMPARE_COMMON_RATIO_MIN 标记 truncated，
 *   由调用方提示「所选票上市时间差异过大」。
 * @param inputs 各票日 K 收盘序列（时间升序；空序列票整体忽略）
 * @param rangeDays 区间（自然交易日数，截取各票尾部）
 * @returns 归一化结果（少于 2 只有效票 / 找不到共同基准时 dates 为空数组）
 */
export const normalizeSeriesToBase = (
  inputs: CompareSeriesInput[],
  rangeDays: number,
): CompareNormalized => {
  const series = inputs.filter((item) => item.closes.length > 0);
  if (series.length < 2) {
    return { dates: [], values: {}, baseDate: '', truncated: false };
  }

  // 1. 每票按区间截尾，建「时间戳 -> 收盘」映射
  const maps = series.map((item) => {
    const tail = item.closes.slice(-rangeDays);
    const byTimestamp = new Map<number, number>();
    for (const point of tail) byTimestamp.set(point.timestamp, point.close);
    return { symbol: item.symbol, byTimestamp };
  });

  // 2. 并集时间戳轴（升序）
  const timestampSet = new Set<number>();
  for (const item of maps) {
    for (const timestamp of item.byTimestamp.keys()) timestampSet.add(timestamp);
  }
  const allTimestamps = [...timestampSet].sort((a, b) => a - b);

  // 3. 基准日 = 全组都有值的最早交易日；找不到 → 无法对比
  const baseValues = new Map<string, number>();
  let baseTimestamp = 0;
  for (const timestamp of allTimestamps) {
    if (maps.every((item) => item.byTimestamp.has(timestamp))) {
      baseTimestamp = timestamp;
      for (const item of maps) baseValues.set(item.symbol, item.byTimestamp.get(timestamp)!);
      break;
    }
  }
  if (baseTimestamp === 0) {
    return { dates: [], values: {}, baseDate: '', truncated: false };
  }

  // 4. 从基准日起逐日 forward-fill 产出归一值；晚上市票以自己首日为基准
  const fromBase = allTimestamps.filter((timestamp) => timestamp >= baseTimestamp);
  const dates: string[] = [];
  const values: Record<string, (number | null)[]> = {};
  for (const item of maps) values[item.symbol] = [];
  const lastValid = new Map<string, number>();
  for (const timestamp of fromBase) {
    for (const item of maps) {
      const close = item.byTimestamp.get(timestamp);
      if (close !== undefined) lastValid.set(item.symbol, close);
    }
    dates.push(formatDay(timestamp));
    for (const item of maps) {
      const current = lastValid.get(item.symbol);
      if (current === undefined) {
        // 基准日后仍无任何值（理论上只在晚上市票的基准日当天出现）
        values[item.symbol].push(null);
        continue;
      }
      const base = baseValues.get(item.symbol) ?? current;
      values[item.symbol].push((current / base) * 100);
    }
  }

  // 5. 共同段占比检查：有效天数最少的票覆盖不足则提示
  const minCoverage = Math.min(...series.map((item) => item.closes.length)) / rangeDays;
  const truncated = minCoverage < COMPARE_COMMON_RATIO_MIN;

  return { dates, values, baseDate: formatDay(baseTimestamp), truncated };
};

/**
 * 时间戳转 YYYY-MM-DD（本地时区；日 K 时间戳为交易所当日，无跨日歧义）
 * @param timestamp 毫秒时间戳
 * @returns YYYY-MM-DD 字符串
 */
const formatDay = (timestamp: number): string => {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};
