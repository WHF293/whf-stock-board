/**
 * 股票详情页 · 图表指标配置选项
 *
 * 主图指标叠加在蜡烛面板（klinecharts 内置 MA / BOLL）；
 * 副图指标每项独立面板（内置 VOL / MACD / BOLL / KDJ + 本项目自定义 MACD_KDJ 复合指标）。
 * 分时 / 五日模式固定为主图 + 均价线 + VOL + MACD，不参与配置。
 */

/** 主图指标选项 */
export const CHART_MAIN_INDICATOR_OPTIONS = [
  { label: 'MA（5，10，30）', value: 'MA' },
  { label: 'BOLL', value: 'BOLL' },
] as const;

/** 副图指标选项 */
export const CHART_SUB_INDICATOR_OPTIONS = [
  { label: 'VOL', value: 'VOL' },
  { label: 'MACD', value: 'MACD' },
  { label: 'BOLL', value: 'BOLL' },
  { label: 'KDJ', value: 'KDJ' },
  { label: 'MACD&KDJ', value: 'MACD_KDJ' },
] as const;

/** 主图指标默认勾选（= 历史固定行为） */
export const CHART_MAIN_INDICATORS_DEFAULT: readonly string[] = ['MA'];

/** 副图指标默认勾选（= 历史固定行为） */
export const CHART_SUB_INDICATORS_DEFAULT: readonly string[] = ['VOL', 'MACD_KDJ'];
