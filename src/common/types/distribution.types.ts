/**
 * 涨跌分布分桶定义
 */
export interface DistributionBucketDef {
  /** 桶唯一 key */
  key: string;
  /** 展示标签（如 '5~7'） */
  label: string;
  /** 区间下界（含）；负无穷表示无下界 */
  min: number;
  /** 区间上界（不含）；正无穷表示无上界 */
  max: number;
  /** 图表用色（hex，涨跌语义色） */
  color: string;
}

/**
 * 涨跌分布统计结果（单个桶的计数）
 */
export interface DistributionCount {
  /** 桶唯一 key */
  key: string;
  /** 展示标签 */
  label: string;
  /** 图表用色 */
  color: string;
  /** 落入该桶的股票数量 */
  count: number;
}
