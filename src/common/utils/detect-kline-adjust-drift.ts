import dayjs from 'dayjs';
import type { KLineData } from 'klinecharts';
import {
  KLINE_ADJUST_DRIFT_ABS_EPSILON,
  KLINE_ADJUST_DRIFT_REL_EPSILON,
} from '../constants/kline-cache.constants.ts';

/**
 * 检测前复权口径漂移（补尾部场景）
 *
 * 前复权（qfq）序列在除权除息后**整条历史**会被上游重新缩放，本地缓存
 * 「历史不变、只补尾部」的策略会把新缩放口径的尾部接到旧口径历史上，
 * 除权日之后整条序列错位。对策：补数结果与缓存的重叠交易日逐一比对收盘价，
 * 任一日超出阈值即判定漂移，调用方作废该票缓存全量重取。
 *
 * 校验排除**当日** bar：当日盘中价格持续变化是正常现象（mergeKlineBars
 * 本就让新数据赢），与复权漂移无关。
 * @param cached 本地缓存序列（时间升序）
 * @param fetched 本次补尾取回序列（时间升序）
 * @returns 是否检测到口径漂移（true = 需整票作废重取）
 */
export const detectKlineAdjustDrift = (
  cached: readonly KLineData[],
  fetched: readonly KLineData[],
): boolean => {
  const cachedByTimestamp = new Map(cached.map((bar) => [bar.timestamp, bar]));
  const today = dayjs().format('YYYY-MM-DD');
  for (const bar of fetched) {
    if (dayjs(bar.timestamp).format('YYYY-MM-DD') === today) continue;
    const old = cachedByTimestamp.get(bar.timestamp);
    if (!old) continue;
    const epsilon = Math.max(
      KLINE_ADJUST_DRIFT_ABS_EPSILON,
      Math.abs(old.close) * KLINE_ADJUST_DRIFT_REL_EPSILON,
    );
    if (Math.abs(bar.close - old.close) > epsilon) {
      return true;
    }
  }
  return false;
};
