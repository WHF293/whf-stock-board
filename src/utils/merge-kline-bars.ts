import type { KLineData } from 'klinecharts';

/**
 * 合并「本地缓存」与「本次取回」的 K 线序列
 *
 * 按 `timestamp` 去重：本次取回的同刻 bar 覆盖缓存里的旧值
 * —— 当日 bar 在盘中会持续变化，必须让新数据赢。
 * 结果按时间升序（图表要求）。
 * @param cached 本地缓存序列（时间升序）
 * @param fetched 本次取回序列（时间升序）
 * @returns 合并后的序列（时间升序；入参均不修改）
 */
export const mergeKlineBars = (
  cached: readonly KLineData[],
  fetched: readonly KLineData[],
): KLineData[] => {
  if (fetched.length === 0) {
    return [...cached];
  }
  if (cached.length === 0) {
    return [...fetched];
  }
  const byTimestamp = new Map<number, KLineData>();
  for (const bar of cached) {
    byTimestamp.set(bar.timestamp, bar);
  }
  for (const bar of fetched) {
    byTimestamp.set(bar.timestamp, bar);
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
};
