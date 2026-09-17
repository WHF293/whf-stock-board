import dayjs from 'dayjs';
import { KLINE_TAIL_MARGIN_BARS, KLINE_TAIL_MIN_DATALEN } from '../constants/kline-cache.constants';
import { KLINE_MAX_BARS_PER_REQUEST } from '../constants/kline.constants';

/**
 * 计算「补齐库中最新日期 → 现在」所需的请求根数
 *
 * 新浪只能按「最近 N 根」倒序返回，无法指定起始日期，故用自然日跨度折算：
 * 一周至多 5 个交易日 ⇒ `days × 5 / 7` 是交易日数的**上限**估计
 * （节假日与长期停牌只会更少，故不会漏取）。
 *
 * 下限取 KLINE_TAIL_MIN_DATALEN：库中最后一根本身也可能在盘中变化，
 * 必须至少把它重新取回来一次，才能刷新当日 bar。
 * @param lastDate 库中最新 bar 的交易日（`YYYY-MM-DD`）
 * @param now 当前时间戳（毫秒）
 * @returns 请求根数（已收敛到 [KLINE_TAIL_MIN_DATALEN, KLINE_MAX_BARS_PER_REQUEST]）
 */
export const calcKlineTailDatalen = (lastDate: string, now: number): number => {
  const gapDays = Math.max(
    0,
    dayjs(now).startOf('day').diff(dayjs(lastDate).startOf('day'), 'day'),
  );
  const estimated = Math.ceil((gapDays * 5) / 7) + KLINE_TAIL_MARGIN_BARS;
  return Math.min(Math.max(estimated, KLINE_TAIL_MIN_DATALEN), KLINE_MAX_BARS_PER_REQUEST);
};
