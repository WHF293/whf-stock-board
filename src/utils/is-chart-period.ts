import { CHART_PERIOD_OPTIONS, type ChartPeriod } from '../constants/stock-detail.constants';

/**
 * 判断任意值是否为合法的图表周期
 *
 * 用途：持久化偏好是「外部输入」——localStorage 里的值可能来自旧版本
 * （例如某个周期被下线）。直接把它当周期用会在取数配置表里取到 undefined，
 * 解构时抛错、K 线整块白屏，故读取时先过这一道校验。
 * @param value 待校验的值（宽类型，可来自 localStorage / 模板绑定）
 * @returns true 表示可安全当作 ChartPeriod 使用
 */
export const isChartPeriod = (value: unknown): value is ChartPeriod =>
  CHART_PERIOD_OPTIONS.some((option) => option.value === value);
