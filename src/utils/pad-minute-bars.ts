import dayjs from 'dayjs';
import type { KLineData } from 'klinecharts';
import { buildMinuteAxis } from './build-minute-axis';

/**
 * 分时占位 bar：尚未发生的分钟没有成交数据
 *
 * 价格 / 成交量留 NaN —— 图表库的图形绘制对非有限值一律跳过，
 * 面积线因此只画到最新一根，右侧保持空白（与真实分时图一致），
 * 指标计算也会把非有限值归一化为 n/a（见 charts/indicators/intraday-indicators）
 * @param timestamp 毫秒时间戳
 * @returns 占位 K 线
 */
const createPlaceholderBar = (timestamp: number): KLineData => ({
  timestamp,
  open: Number.NaN,
  high: Number.NaN,
  low: Number.NaN,
  close: Number.NaN,
  volume: Number.NaN,
});

/**
 * 把分时序列补齐为「全天固定时间轴」
 *
 * 盘中接口只下发已发生的分钟（例如 10:30 只到 10:30），直接交给图表会把
 * 已有数据拉伸铺满画布、X 轴也随之缩到当前时刻；这里按交易日补齐固定分钟格，
 * 缺失的分钟以占位 bar 填充，使 X 轴恒定为 09:30~15:00
 * @param bars 当日分时序列（时间升序）
 * @returns 补齐后的序列（时间升序；数据为空时原样返回）
 */
export const padMinuteBars = (bars: KLineData[]): KLineData[] => {
  if (bars.length === 0) return bars;
  const barByTime = new Map(bars.map((bar) => [bar.timestamp, bar]));
  const days = new Set(
    bars.map((bar) => dayjs(bar.timestamp).startOf('day').valueOf()),
  );
  const axis = new Set<number>();
  for (const day of days) {
    for (const timestamp of buildMinuteAxis(day)) {
      axis.add(timestamp);
    }
  }
  // 兜底：不落在固定轴上的分钟（上游偶发多下发的时刻）按序并入，避免丢点
  for (const bar of bars) {
    axis.add(bar.timestamp);
  }
  return [...axis]
    .sort((a, b) => a - b)
    .map((timestamp) => barByTime.get(timestamp) ?? createPlaceholderBar(timestamp));
};
