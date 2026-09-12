/**
 * 选股分析相关类型（信号扫描 / 尾盘选股，参考 stock-dashboard 实现）
 */

/** 分析进度（阶段 + 已完成 / 总数） */
export interface AnalysisProgress {
  /** 阶段文案（如「技术信号扫描」） */
  stage: string;
  /** 已完成数 */
  completed: number;
  /** 总数 */
  total: number;
}

/**
 * 技术信号 key（MA / MACD / RSI / BOLL 四族八种）
 */
export type SignalKey =
  | 'ma_golden'
  | 'ma_death'
  | 'macd_golden'
  | 'macd_death'
  | 'rsi_oversold'
  | 'rsi_overbought'
  | 'boll_upper'
  | 'boll_lower';

/**
 * 扫描股票池条目
 */
export interface ScannerPoolItem {
  /** 展示代码（6 位纯代码） */
  code: string;
  /** 完整符号（sh600519 形态，拉取 K 线 / 跳详情用） */
  symbol: string;
  /** 股票名称 */
  name: string;
}

/**
 * 信号扫描结果行
 */
export interface ScanSignalResult {
  /** 展示代码 */
  code: string;
  /** 完整符号 */
  symbol: string;
  /** 股票名称 */
  name: string;
  /** 命中的信号标签列表（如 ['MA金叉']） */
  matchedLabels: string[];
}

/**
 * 尾盘选股过滤条件（参考同花顺尾盘选股法默认值）
 */
export interface EodFilters {
  /** 流通市值下限（亿） */
  marketCapMin: number;
  /** 流通市值上限（亿；null 表示不设上限） */
  marketCapMax: number | null;
  /** 量比下限 */
  volumeRatioMin: number;
  /** 当日涨幅下限（%） */
  changePercentMin: number;
  /** 当日涨幅上限（%；null 表示不设上限） */
  changePercentMax: number | null;
  /** 换手率下限（%） */
  turnoverRateMin: number;
  /** 换手率上限（%；null 表示不设上限） */
  turnoverRateMax: number | null;
  /** 是否过滤 ST 股票 */
  excludeST: boolean;
  /** 分时强度下限（分时价位于均价上方的时间占比，%） */
  timelineAboveAvgRatioMin: number;
}

/**
 * 尾盘选股结果行（基础过滤 + 分时结构筛选后）
 */
export interface EodStock {
  /** 展示代码（6 位纯代码） */
  code: string;
  /** 完整符号 */
  symbol: string;
  /** 股票名称 */
  name: string;
  /** 现价（元） */
  price: number;
  /** 涨跌幅（%） */
  changePercent: number;
  /** 换手率（%） */
  turnoverRate: number | null;
  /** 量比 */
  volumeRatio: number | null;
  /** 流通市值（亿） */
  circulatingMarketCap: number | null;
  /** 分时强度（分时价位于均价上方的时间占比，%） */
  timelineAboveAvgRatio: number;
}
