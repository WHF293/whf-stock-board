/**
 * 自选多票叠加对比类型
 */

/** 一只票的日 K 收盘序列（对比输入；时间升序，时间戳为毫秒） */
export interface CompareSeriesInput {
  /** 完整符号（`sh600519` 形态，作为系列标识） */
  symbol: string;
  /** 票名（图例与统计表展示） */
  name: string;
  /** 日 K 收盘价（时间升序） */
  closes: { timestamp: number; close: number }[];
}

/** 归一化叠加结果（ECharts 直接消费的数据形态） */
export interface CompareNormalized {
  /** 横轴日期序列（各票交易日并集，YYYY-MM-DD 升序） */
  dates: string[];
  /** 各票归一化值（基准 = 100；无值位置为 null，ECharts 断线） */
  values: Record<string, (number | null)[]>;
  /** 归一化基准日（全组共同的首个交易日，YYYY-MM-DD） */
  baseDate: string;
  /** 是否发生了共同段不足的截取（true 时 UI 提示） */
  truncated: boolean;
}

/** 一只票的对比统计 */
export interface CompareStatsItem {
  /** 完整符号 */
  symbol: string;
  /** 票名 */
  name: string;
  /** 区间涨跌幅（百分数原值，如 12.34 表示 +12.34%） */
  changePct: number;
  /** 区间最大回撤（百分数原值，恒为非正值，如 -8.5 表示最大回撤 8.5%） */
  maxDrawdownPct: number;
  /** 年化波动率（百分数原值；有效样本 < 2 时为 null） */
  annualVolPct: number | null;
}
