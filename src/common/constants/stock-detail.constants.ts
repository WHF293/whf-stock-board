import type { SinaKlinePeriod } from '../api/sina-kline.api.ts';

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

/**
 * 图表周期默认值（分时）
 *
 * 仅在「用户从未选过周期」或持久化值非法时使用；正常路径由设置 store 的
 * `detailChartPeriod` 记住上一次选择（见 composables/use-chart-period.ts）
 */
export const CHART_PERIOD_DEFAULT: ChartPeriod = 'minute';

/** 详情页底部页签值 */
export type DetailBottomTab = 'trade' | 'etf' | 'financial' | 'news' | 'fund';

/**
 * 详情页底部页签选项（交易记录 / ETF 持仓股 / 财务 / 资讯 / 基金概况）
 *
 * 「ETF 持仓股」「基金概况」仅当场内基金时由页面追加渲染；「财务」仅当普通股票时由页面追加
 * （场内基金无财务报表概念，对应披露口径由「基金概况」页签承接），见 StockDetailView 的
 * bottomTabOptions；「资讯」（公告 + 个股新闻）普通股票与场内基金均可查看
 */
export const DETAIL_BOTTOM_TAB_OPTIONS: readonly { label: string; value: DetailBottomTab }[] = [
  { label: '交易记录', value: 'trade' },
  { label: 'ETF 持仓股', value: 'etf' },
  { label: '财务', value: 'financial' },
  { label: '资讯', value: 'news' },
  { label: '基金概况', value: 'fund' },
] as const;

/** 详情页底部页签默认值（交易记录） */
export const DETAIL_BOTTOM_TAB_DEFAULT: DetailBottomTab = 'trade';
