import type { SinaKlinePeriod } from '../api/sina-kline.api';

/** 图表周期值（与新浪 K 线周期对齐） */
export type ChartPeriod = SinaKlinePeriod;

/**
 * 图表周期选项（分时 / 五日 / 5分 / 日K / 周K / 月K）
 *
 * 侧栏（StockDetailPanel）与详情页（StockDetailView）共用，避免两处漂移
 */
export const CHART_PERIOD_OPTIONS: readonly { label: string; value: ChartPeriod }[] = [
  { label: '分时', value: 'minute' },
  { label: '日K', value: 'daily' },
  { label: '周K', value: 'weekly' },
  { label: '月K', value: 'monthly' },
  { label: '5分', value: 'min5' },
  { label: '五日', value: 'fiveDay' },
] as const;
