/**
 * 选股分析常量（信号扫描 / 尾盘选股）
 */

import type { EodFilters, SignalKey } from '../types/analysis.types';

/** 信号模板选项（label / desc 展示用，value 为 SignalKey） */
export const SIGNAL_TEMPLATES: readonly {
  key: SignalKey;
  label: string;
  desc: string;
}[] = [
  { key: 'ma_golden', label: 'MA金叉', desc: '短期均线上穿长期均线' },
  { key: 'ma_death', label: 'MA死叉', desc: '短期均线下穿长期均线' },
  { key: 'macd_golden', label: 'MACD金叉', desc: 'DIF 上穿 DEA' },
  { key: 'macd_death', label: 'MACD死叉', desc: 'DIF 下穿 DEA' },
  { key: 'rsi_oversold', label: 'RSI超卖', desc: 'RSI 低于 30' },
  { key: 'rsi_overbought', label: 'RSI超买', desc: 'RSI 高于 70' },
  { key: 'boll_upper', label: 'BOLL上轨', desc: '收盘价突破上轨' },
  { key: 'boll_lower', label: 'BOLL下轨', desc: '收盘价跌破下轨' },
] as const satisfies readonly {
  key: SignalKey;
  label: string;
  desc: string;
}[];

/** 信号扫描并发数（克制频率，避免触发上游反爬） */
export const SCAN_CONCURRENCY = 3;

/** 尾盘选股分时强度筛选的并发数（腾讯 JSONP 源，保守并发） */
export const EOD_TIMELINE_CONCURRENCY = 2;

/** 尾盘选股默认过滤条件（参考尾盘选股法常用参数） */
export const EOD_FILTERS_DEFAULT: EodFilters = {
  marketCapMin: 50,
  marketCapMax: 200,
  volumeRatioMin: 1.2,
  changePercentMin: 3,
  changePercentMax: 5,
  turnoverRateMin: 5,
  turnoverRateMax: 10,
  excludeST: true,
  timelineAboveAvgRatioMin: 80,
};

/** 涨停 / 强势股池选项（value 需为 SDK ZTPoolType 成员） */
export const SCAN_ZT_POOL_OPTIONS: readonly { label: string; value: string }[] = [
  { label: '涨停池', value: 'zt' },
  { label: '强势股', value: 'strong' },
  { label: '昨日涨停', value: 'yesterday' },
  { label: '次新股', value: 'sub_new' },
  { label: '炸板池', value: 'broken' },
  { label: '跌停池', value: 'dt' },
];

/** 盘口异动池选项（value 需为 SDK StockChangeType 成员） */
export const SCAN_STOCK_CHANGE_OPTIONS: readonly { label: string; value: string }[] = [
  { label: '火箭发射', value: 'rocket_launch' },
  { label: '大笔买入', value: 'large_buy' },
  { label: '大单扫货', value: 'big_buy_order' },
  { label: '封涨停板', value: 'limit_up_seal' },
  { label: '向上缺口', value: 'gap_up' },
  { label: '60日新高', value: 'high_60d' },
];

/** 榜单 TopN 选项 */
export const SCAN_TOP_N_OPTIONS = [20, 50, 100] as const;

/** 板块成分股截取数量选项 */
export const SCAN_BOARD_LIMIT_OPTIONS = [30, 50, 80] as const;
