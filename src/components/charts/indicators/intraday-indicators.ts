import type { Indicator, IndicatorCreate, KLineData } from 'klinecharts';
import { MACD_PARAMS } from '../../../constants/kline.constants';

/**
 * 分时（全天固定时间轴）专用的 VOL / MACD 创建参数
 *
 * 分时序列补齐到全天固定轴后，尚未发生的分钟是占位 bar（价格 / 成交量非有限值），
 * 内置 calc 会把 NaN 一路算下去，而内置图例只对 null / undefined 回落为 'n/a'，
 * NaN 会被原样渲染成 "NaN"。这里沿用内置口径重算一遍，仅把非有限值归一化为 null
 */

/** 指标结果行（键为 figure key） */
type IndicatorRow = Record<string, number | null>;

/**
 * 把结果行里的非有限值统一置为 null
 * @param rows 指标计算结果
 * @returns 归一化后的结果（键与入参一致）
 */
const nullifyNonFinite = (rows: IndicatorRow[]): IndicatorRow[] =>
  rows.map((row) => {
    const normalized: IndicatorRow = {};
    for (const key of Object.keys(row)) {
      const value = row[key];
      normalized[key] =
        typeof value === 'number' && !Number.isFinite(value) ? null : value;
    }
    return normalized;
  });

/**
 * 分时 VOL 计算（口径同内置 VOL：成交量按 calcParams 求移动均线）
 * @param dataList K 线序列（分时含占位 bar）
 * @param indicator 指标实例（取 calcParams 与 figures）
 * @returns 每根 K 线的成交量 / 均量（缺失为 null）
 */
const calcIntradayVol = (
  dataList: KLineData[],
  indicator: Indicator,
): IndicatorRow[] => {
  const params = indicator.calcParams as number[];
  const figures = indicator.figures;
  const sums: number[] = [];
  const rows = dataList.map((bar, i) => {
    const volume = bar.volume ?? Number.NaN;
    const row: IndicatorRow = {
      volume,
      open: bar.open ?? Number.NaN,
      close: bar.close ?? Number.NaN,
    };
    params.forEach((period, index) => {
      sums[index] = (sums[index] ?? 0) + volume;
      if (i >= period - 1) {
        row[figures[index].key] = sums[index] / period;
        sums[index] -= dataList[i - (period - 1)].volume ?? Number.NaN;
      }
    });
    return row;
  });
  return nullifyNonFinite(rows);
};

/**
 * 分时 MACD 计算（口径同内置 MACD：EMA(快) - EMA(慢) = DIF，DIF 再取 EMA = DEA）
 * @param dataList K 线序列（分时含占位 bar）
 * @returns 每根 K 线的 DIF / DEA / MACD（缺失为 null）
 */
const calcIntradayMacd = (dataList: KLineData[]): IndicatorRow[] => {
  const [shortPeriod, longPeriod, signalPeriod] = MACD_PARAMS;
  const maxPeriod = Math.max(shortPeriod, longPeriod);
  let closeSum = 0;
  let emaShort = 0;
  let emaLong = 0;
  let difSum = 0;
  let dea = 0;
  const rows = dataList.map((bar, i) => {
    const row: IndicatorRow = {};
    const close = bar.close;
    closeSum += close;
    if (i >= shortPeriod - 1) {
      emaShort =
        i > shortPeriod - 1
          ? (2 * close + (shortPeriod - 1) * emaShort) / (shortPeriod + 1)
          : closeSum / shortPeriod;
    }
    if (i >= longPeriod - 1) {
      emaLong =
        i > longPeriod - 1
          ? (2 * close + (longPeriod - 1) * emaLong) / (longPeriod + 1)
          : closeSum / longPeriod;
    }
    if (i >= maxPeriod - 1) {
      const dif = emaShort - emaLong;
      row.dif = dif;
      difSum += dif;
      if (i >= maxPeriod + signalPeriod - 2) {
        dea =
          i > maxPeriod + signalPeriod - 2
            ? (dif * 2 + dea * (signalPeriod - 1)) / (signalPeriod + 1)
            : difSum / signalPeriod;
        row.dea = dea;
        row.macd = (dif - dea) * 2;
      }
    }
    return row;
  });
  return nullifyNonFinite(rows);
};

/** 分时 VOL 创建参数（覆盖内置 calc；均线周期与内置一致） */
export const INTRADAY_VOL_INDICATOR: IndicatorCreate = {
  name: 'VOL',
  calc: calcIntradayVol,
};

/** 分时 MACD 创建参数（覆盖内置 calc；参数与内置一致） */
export const INTRADAY_MACD_INDICATOR: IndicatorCreate = {
  name: 'MACD',
  calc: calcIntradayMacd,
};
