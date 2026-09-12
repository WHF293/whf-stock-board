import type { DistributionBucketDef } from '../types/distribution.types';
import {
  DOWN_COLOR,
  DOWN_COLOR_LIGHT,
  DOWN_COLOR_PALE,
  DOWN_COLOR_STRONG,
  UP_COLOR,
  UP_COLOR_LIGHT,
  UP_COLOR_PALE,
  UP_COLOR_STRONG,
} from './stock-colors.constants';

/**
 * 涨跌分布分桶定义（区间左闭右开，末端桶含上边界）
 *
 * 每个桶的 color 取自涨跌语义色，图表直接消费
 */
export const DISTRIBUTION_BUCKETS: readonly DistributionBucketDef[] = [
  { key: 'deep_down', label: '≤-7%', min: Number.NEGATIVE_INFINITY, max: -7, color: DOWN_COLOR_STRONG },
  { key: 'down_5_7', label: '-7~-5', min: -7, max: -5, color: DOWN_COLOR },
  { key: 'down_3_5', label: '-5~-3', min: -5, max: -3, color: DOWN_COLOR_LIGHT },
  { key: 'down_0_3', label: '-3~0', min: -3, max: 0, color: DOWN_COLOR_PALE },
  { key: 'up_0_3', label: '0~3', min: 0, max: 3, color: UP_COLOR_PALE },
  { key: 'up_3_5', label: '3~5', min: 3, max: 5, color: UP_COLOR_LIGHT },
  { key: 'up_5_7', label: '5~7', min: 5, max: 7, color: UP_COLOR },
  { key: 'deep_up', label: '≥7%', min: 7, max: Number.POSITIVE_INFINITY, color: UP_COLOR_STRONG },
];
