import dayjs from 'dayjs';
import type { KLineData } from 'klinecharts';

/**
 * 由分时（1 分钟）轮询数据构建「当前周期的实时最后一根柱」
 * （2026-11-02 王总指定：交易日盘中无论打开哪个周期，都轮询分时接口，
 * 用它更新其他周期 K 线的最后一根柱子）
 *
 * 实测口径（2026-11-02，经代理验证）：
 * - 新浪 1 分钟 ts = 分钟结束时刻（`HH:MM:00`），带 amount；
 * - 日 K 盘中**不含当日**；周 K（scale=1200）/ 月 K（scale=7200）
 *   **不含当前周 / 月**（最新只到上一周 / 上月最后一个交易日）。
 *
 * 各周期构建规则：
 * - minute / fiveDay：直接取最新一根分钟线（时间轴转换在图表组件内做）；
 * - min5：按 5 分钟桶（段结束时刻对齐）聚合最后一桶；
 * - daily：聚合当日全部分钟；
 * - weekly / monthly：聚合当前周 / 月内已有日 K（盘中 = 期初至昨日），
 *   日 K 未含今日时叠加今日分钟聚合；时间戳取本期名义末日
 *   （本周五 / 本月末，与上游期界约定一致，避免期界漂移出重复柱）。
 *
 * 结果仅经 subscribeBar 通道推送 / 临时拼接，**不写本地缓存**，
 * 收盘后上游真柱按相同时间戳自然覆盖。
 */

/** 5 分钟桶宽（毫秒） */
const MIN5_MS = 5 * 60_000;

/**
 * 新浪日 K / 分钟 K 的日期键（本地时区）
 * @param timestamp 毫秒时间戳
 * @returns `YYYY-MM-DD` 日期文案
 */
const dayKeyOf = (timestamp: number): string => dayjs(timestamp).format('YYYY-MM-DD');

/**
 * 周一为一周起点的「周起点」日 0 点时间戳
 * @param timestamp 毫秒时间戳
 * @returns 该日所属交易周的周一 0 点时间戳
 */
const weekStartOf = (timestamp: number): number => {
  const day = dayjs(timestamp).startOf('day');
  return day.subtract((day.day() + 6) % 7, 'day').valueOf();
};

/**
 * 聚合一组 K 线为单根柱（open 取首根 / close 取末根 / 高低极值 / 量额求和）
 * @param bars 时间升序子序列
 * @param timestamp 输出柱时间戳
 * @returns 聚合柱；空序列返回 null
 */
const aggregateBars = (bars: KLineData[], timestamp: number): KLineData | null => {
  if (bars.length === 0) return null;
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let volume = 0;
  let turnover = 0;
  for (const bar of bars) {
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);
    volume += bar.volume ?? 0;
    turnover += (bar.turnover as number | undefined) ?? 0;
  }
  return {
    timestamp,
    open: bars[0].open,
    high,
    low,
    close: bars[bars.length - 1].close,
    volume,
    turnover,
  };
};

/**
 * 构建当前周期的实时最后一根柱
 * @param period 图表周期
 * @param minutes 1 分钟线尾段（时间升序；需覆盖当日全部分钟以供聚合）
 * @param dailies 日 K 尾段（时间升序；weekly / monthly 聚合当前周 / 月用）
 * @returns 实时柱；无法构建（非今日数据 / 空序列）时返回 null（推送通道按旧数据忽略）
 */
export const buildLiveKlineBar = (
  period: 'minute' | 'fiveDay' | 'min5' | 'daily' | 'weekly' | 'monthly',
  minutes: KLineData[],
  dailies: KLineData[],
): KLineData | null => {
  if (minutes.length === 0) return null;
  const now = Date.now();
  const todayKey = dayKeyOf(now);
  const lastMinute = minutes[minutes.length - 1];
  const todayMinutes = minutes.filter((bar) => dayKeyOf(bar.timestamp) === todayKey);

  switch (period) {
    case 'minute':
    case 'fiveDay':
      // 最新一根分钟线（原始 close = 价格；时间轴涨跌幅转换在图表组件内做）
      return dayKeyOf(lastMinute.timestamp) === todayKey && todayMinutes.length > 0
        ? lastMinute
        : null;
    case 'min5': {
      // 当前 5 分钟桶（桶 = 段结束时刻对齐，与上游 5 分 K 口径一致）
      if (todayMinutes.length === 0) return null;
      const bucketEnd = Math.ceil(lastMinute.timestamp / MIN5_MS) * MIN5_MS;
      const bucket = todayMinutes.filter(
        (bar) => bar.timestamp > bucketEnd - MIN5_MS && bar.timestamp <= bucketEnd,
      );
      return aggregateBars(bucket, bucketEnd);
    }
    case 'daily':
      // 当日全天分钟聚合（时间戳 = 当日 0 点，与日 K 柱口径一致）；盘前无今日分钟 ⇒ 不推
      if (todayMinutes.length === 0) return null;
      return aggregateBars(todayMinutes, dayjs(todayKey).valueOf());
    case 'weekly':
    case 'monthly': {
      // 当前周 / 月内已有日 K（盘中 = 期初至昨日，新浪盘中不含当前周 / 月）
      const inPeriod = dailies.filter((bar) =>
        period === 'weekly'
          ? weekStartOf(bar.timestamp) === weekStartOf(now)
          : dayKeyOf(bar.timestamp).slice(0, 7) === todayKey.slice(0, 7),
      );
      // 日 K 尚未含今日（盘中）⇒ 叠加今日分钟聚合
      const base = [...inPeriod];
      if (!inPeriod.some((bar) => dayKeyOf(bar.timestamp) === todayKey)) {
        const todayBar = aggregateBars(todayMinutes, dayjs(todayKey).valueOf());
        if (todayBar) base.push(todayBar);
      }
      if (base.length === 0) return null;
      // 名义期末时间戳：本周五 / 本月最后一天（期界与上游完成态对齐，
      // 上游周期结束后下发的真柱按相同时间戳覆盖，不会出现重复柱）
      const timestamp =
        period === 'weekly'
          ? dayjs(now)
              .add(4 - ((dayjs(now).day() + 6) % 7), 'day')
              .startOf('day')
              .valueOf()
          : dayjs(now)
              .endOf('month')
              .startOf('day')
              .valueOf();
      return aggregateBars(base, timestamp);
    }
  }
};
