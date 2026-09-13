import { registerIndicator, type IndicatorTemplate, type KLineData } from 'klinecharts';
import { readTrendColors } from '../../../utils/trend-colors';

/**
 * 自定义指标注册：MACD&KDJ 复合副图（含买/卖汉字标注）与分时均价线
 */

/** MACD&KDJ 单根 K 线的计算结果 */
interface MacdKdjResult {
  dif: number | null;
  dea: number | null;
  macd: number | null;
  k: number | null;
  d: number | null;
  j: number | null;
  /** DIF 金叉 DEA 的 K 线上标注「买」 */
  buyMark: string | null;
  /** DIF 死叉 DEA 的 K 线上标注「卖」 */
  sellMark: string | null;
}

/**
 * EMA 计算（标准 MACD 口径：ema = prev * (1 - k) + close * k）
 * @param closes 收盘价序列
 * @param period 周期
 * @returns EMA 序列（与入参等长）
 */
const calcEma = (closes: number[], period: number): number[] => {
  const alpha = 2 / (period + 1);
  const out: number[] = [];
  let prev = Number.NaN;
  for (const close of closes) {
    prev = Number.isNaN(prev) ? close : prev * (1 - alpha) + close * alpha;
    out.push(prev);
  }
  return out;
};

/** MACD&KDJ 复合指标模板：DIF/DEA/MACD 柱 + KDJ 三线，金叉死叉标 买/卖 */
const MACD_KDJ_TEMPLATE: IndicatorTemplate<MacdKdjResult> = {
  name: 'MACD_KDJ',
  shortName: 'MACD&KDJ',
  series: 'normal',
  precision: 2,
  figures: [
    { key: 'k', title: 'K: ', type: 'line', styles: () => ({ color: '#f59e0b' }) },
    { key: 'd', title: 'D: ', type: 'line', styles: () => ({ color: '#6366f1' }) },
    { key: 'j', title: 'J: ', type: 'line', styles: () => ({ color: '#a855f7' }) },
    { key: 'dif', title: 'DIF: ', type: 'line', styles: () => ({ color: '#ef4444' }) },
    { key: 'dea', title: 'DEA: ', type: 'line', styles: () => ({ color: '#22c55e' }) },
    {
      key: 'macd',
      title: 'MACD: ',
      type: 'bar',
      baseValue: 0,
      styles: ({ data }) => ({
        color: ((data.current?.macd ?? 0) >= 0 ? readTrendColors().up : readTrendColors().down),
      }),
    },
    {
      key: 'buyMark',
      type: 'text',
      styles: () => ({ color: readTrendColors().up, size: 11, weight: 'bold' }),
      attrs: ({ data, coordinate, bounding }) => ({
        x: coordinate.current.x,
        y: bounding.height - 14,
        text: String(data.current?.buyMark ?? ''),
        align: 'center',
        baseline: 'bottom',
      }),
    },
    {
      key: 'sellMark',
      type: 'text',
      styles: () => ({ color: readTrendColors().down, size: 11, weight: 'bold' }),
      attrs: ({ data, coordinate }) => ({
        x: coordinate.current.x,
        y: 4,
        text: String(data.current?.sellMark ?? ''),
        align: 'center',
        baseline: 'top',
      }),
    },
  ],
  calc: (dataList): MacdKdjResult[] => {
    const closes = dataList.map((bar) => bar.close);
    const ema12 = calcEma(closes, 12);
    const ema26 = calcEma(closes, 26);
    const difList = closes.map((_, i) => ema12[i] - ema26[i]);
    const deaList = calcEma(difList, 9);

    // KDJ（9,3,3）：RSV 经 SMA 平滑
    let prevK = 50;
    let prevD = 50;
    let prevDif = Number.NaN;

    return dataList.map((bar, i) => {
      const windowStart = Math.max(0, i - 8);
      let high = Number.NEGATIVE_INFINITY;
      let low = Number.POSITIVE_INFINITY;
      for (let j = windowStart; j <= i; j += 1) {
        high = Math.max(high, dataList[j].high);
        low = Math.min(low, dataList[j].low);
      }
      const rsv = high === low ? 50 : ((bar.close - low) / (high - low)) * 100;
      const k = prevK * (2 / 3) + rsv * (1 / 3);
      const d = prevD * (2 / 3) + k * (1 / 3);
      prevK = k;
      prevD = d;

      const dif = difList[i];
      const dea = deaList[i];
      // 金叉死叉判定：上一根存在有效 DIF/DEA 且相对关系发生翻转
      const golden = !Number.isNaN(prevDif) && prevDif <= deaList[i - 1] && dif > dea;
      const death = !Number.isNaN(prevDif) && prevDif >= deaList[i - 1] && dif < dea;
      prevDif = dif;

      return {
        dif,
        dea,
        macd: (dif - dea) * 2,
        k,
        d,
        j: 3 * k - 2 * d,
        buyMark: golden ? '买' : null,
        sellMark: death ? '卖' : null,
      };
    });
  },
};

/** 分时均价线指标模板（主图叠加，读取分钟线上的 avgPrice 自定义字段） */
const AVG_PRICE_TEMPLATE: IndicatorTemplate<{ avg: number | null }> = {
  name: 'AVG_PRICE',
  shortName: '均价',
  series: 'normal',
  precision: 2,
  figures: [
    { key: 'avg', title: '均价: ', type: 'line', styles: () => ({ color: '#f59e0b' }) },
  ],
  calc: (dataList) =>
    dataList.map((bar) => ({
      avg: (bar.avgPrice as number | undefined) ?? bar.close,
    })),
  // tooltip 显示「原始均价 + 相对昨收涨跌幅」，如 `194.38 +0.33%`
  // （数据来自 KlineChart 的 displayBars：avgPriceRaw 原始均价 / pre 昨收 / avgPrice 涨跌幅小数）
  createTooltipDataSource: ({ crosshair }) => {
    const bar = crosshair.kLineData as
      | (KLineData & { avgPriceRaw?: number | null; avgPrice?: number })
      | undefined;
    const raw = bar?.avgPriceRaw;
    const pct = bar?.avgPrice;
    const value =
      raw === undefined || raw === null
        ? 'n/a'
        : `${raw.toFixed(2)} ${pct === undefined ? '' : `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(2)}%`}`;
    return {
      name: '均价',
      calcParamsText: '',
      features: [],
      legends: [{ title: '均价: ', value }],
    };
  },
};

registerIndicator(MACD_KDJ_TEMPLATE);
registerIndicator(AVG_PRICE_TEMPLATE);
