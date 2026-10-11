/**
 * MCP Apps 载荷构造（工具结果 → UI 渲染数据）
 *
 * 为什么要有这一层：`stock-sdk` 的指标结果字段名（ma5 / dif / rsi6 / mid…）
 * 是实现细节，不该泄漏进 iframe。工具层在这里把结果归一化成「series 声明 +
 * 行数据」的稳定结构，App 只负责画——SDK 换版本时只改这里。
 *
 * 载荷进 `structuredContent`（只给 UI，不进模型上下文），模型侧仍拿文本块。
 */

/** 行情表 App 载荷（get_quotes） */
export interface QuoteTablePayload {
  kind: 'quote-table';
  rows: QuoteTableRow[];
  /** 数据时间（行情快照时间，展示用） */
  asOf?: string;
}

/** 行情表单行 */
export interface QuoteTableRow {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  /** 成交额（万） */
  amount: number;
  /** 换手率%（缺失 null） */
  turnoverRate: number | null;
}

/** 图表 App 载荷（get_kline / calc_indicator） */
export interface SeriesChartPayload {
  kind: 'series-chart';
  mode: 'kline' | 'indicator';
  title: string;
  subtitle?: string;
  note?: string;
  /** mode=kline：蜡烛序列 */
  bars?: KlineBar[];
  /** mode=indicator：行数据（含 date 与各 series 的 key） */
  rows?: Array<Record<string, number | string | null>>;
  /** mode=indicator：序列声明（key 对应行字段） */
  series?: SeriesSpec[];
}

/** 蜡烛（K 线图） */
export interface KlineBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 指标序列声明 */
export interface SeriesSpec {
  /** 行数据字段名 */
  key: string;
  /** 图例文案 */
  label: string;
  /** 绘制形态：line=折线，bar=柱（MACD 柱） */
  kind: 'line' | 'bar';
  /** 覆盖色（缺省按序取调色板） */
  color?: string;
}

/** K 线周期 → 中文标签 */
const PERIOD_LABEL: Record<string, string> = {
  daily: '日K',
  weekly: '周K',
  monthly: '月K',
  min5: '5分钟',
};

/**
 * 构造行情表载荷
 * @param rows 行情行（已裁剪为大字段摘要形态）
 * @param asOf 数据时间（行情快照时间）
 * @returns 行情表载荷
 */
export const buildQuoteTablePayload = (rows: QuoteTableRow[], asOf?: string): QuoteTablePayload => ({
  kind: 'quote-table',
  rows,
  asOf,
});

/**
 * 构造 K 线载荷
 * @param params 股票代码 / 名称 / 周期 / 蜡烛序列
 * @param params.symbol 归一化代码（如 sh600519）
 * @param params.name 股票名称（可缺省）
 * @param params.period 周期 key（daily / weekly / monthly / min5）
 * @param params.bars 蜡烛序列（时间升序）
 * @returns 图表载荷（mode=kline）
 */
export const buildKlinePayload = (params: {
  symbol: string;
  name?: string;
  period: string;
  bars: KlineBar[];
}): SeriesChartPayload => ({
  kind: 'series-chart',
  mode: 'kline',
  title: (params.name ? params.name + ' ' : '') + params.symbol,
  subtitle: (PERIOD_LABEL[params.period] ?? params.period) + ' · ' + params.bars.length + ' 根',
  note: '不复权（新浪源）',
  bars: params.bars,
});

/** 指标 kind → 序列声明（key 与 stock-sdk 输出字段一致） */
const INDICATOR_SERIES: Record<string, SeriesSpec[]> = {
  ma: [
    { key: 'close', label: '收盘', kind: 'line', color: '#9aa1ab' },
    { key: 'ma5', label: 'MA5', kind: 'line' },
    { key: 'ma10', label: 'MA10', kind: 'line' },
    { key: 'ma20', label: 'MA20', kind: 'line' },
    { key: 'ma30', label: 'MA30', kind: 'line' },
    { key: 'ma60', label: 'MA60', kind: 'line' },
  ],
  macd: [
    { key: 'macd', label: 'MACD 柱', kind: 'bar' },
    { key: 'dif', label: 'DIF', kind: 'line' },
    { key: 'dea', label: 'DEA', kind: 'line' },
  ],
  rsi: [
    { key: 'rsi6', label: 'RSI6', kind: 'line' },
    { key: 'rsi12', label: 'RSI12', kind: 'line' },
    { key: 'rsi24', label: 'RSI24', kind: 'line' },
  ],
  boll: [
    { key: 'close', label: '收盘', kind: 'line', color: '#9aa1ab' },
    { key: 'upper', label: '上轨', kind: 'line' },
    { key: 'mid', label: '中轨', kind: 'line' },
    { key: 'lower', label: '下轨', kind: 'line' },
  ],
};

/** 指标标题（含中文全称） */
const INDICATOR_TITLE: Record<string, string> = {
  ma: '均线 MA',
  macd: 'MACD',
  rsi: 'RSI',
  boll: '布林带 BOLL',
};

/**
 * 构造技术指标载荷（行数据 + 序列声明）
 *
 * MA / BOLL 属价格量纲，附带收盘价线作参照；MACD / RSI 为独立量纲，不掺价格。
 *
 * @param params 股票代码 / 指标类型 / 日期序列 / 收盘价 / SDK 指标行
 * @param params.symbol 归一化代码
 * @param params.name 股票名称（可缺省）
 * @param params.kind 指标类型（ma / macd / rsi / boll）
 * @param params.dates 与行数据对齐的日期序列
 * @param params.closes 与行数据对齐的收盘价
 * @param params.rows SDK 原始指标行（key 见 INDICATOR_SERIES）
 * @returns 图表载荷（mode=indicator）
 */
export const buildIndicatorPayload = (params: {
  symbol: string;
  name?: string;
  kind: string;
  dates: string[];
  closes: number[];
  rows: Array<Record<string, number | null>>;
}): SeriesChartPayload => {
  const series = INDICATOR_SERIES[params.kind] ?? [];
  const withPrice = params.kind === 'ma' || params.kind === 'boll';
  const rows: Array<Record<string, number | string | null>> = params.rows.map((row, index) => {
    const merged: Record<string, number | string | null> = { date: params.dates[index] ?? '' };
    for (const [key, value] of Object.entries(row)) {
      merged[key] = typeof value === 'number' ? value : null;
    }
    if (withPrice) merged.close = params.closes[index] ?? null;
    return merged;
  });
  return {
    kind: 'series-chart',
    mode: 'indicator',
    title: (params.name ? params.name + ' ' : '') + params.symbol,
    subtitle: (INDICATOR_TITLE[params.kind] ?? params.kind.toUpperCase()) + ' · ' + rows.length + ' 根',
    note: '基于不复权日K收盘价',
    rows,
    series,
  };
};

/** 载荷类型别名（UI 侧判别 union 用） */
export type McpUiPayload = QuoteTablePayload | SeriesChartPayload;
