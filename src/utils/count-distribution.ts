import { DISTRIBUTION_BUCKETS } from '../constants/distribution.constants';
import type { DistributionCount } from '../types/distribution.types';

/**
 * 依据涨跌幅列表按预置分桶计数（区间左闭右开，末端桶含上边界）
 * @param changePercents 全市场涨跌幅列表（百分数数值）
 * @returns 各桶计数结果，顺序与 DISTRIBUTION_BUCKETS 一致
 */
export const countDistribution = (changePercents: readonly number[]): DistributionCount[] =>
  DISTRIBUTION_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    color: bucket.color,
    count: changePercents.filter((value) => value >= bucket.min && value < bucket.max).length,
  }));
