import type { RankDataset } from '@/common/types/rank-dataset.types';
import {
  ASSET_CURVE_ANALYSIS_MAX_CHARS,
  ASSET_CURVE_ANALYSIS_PROMPT_TEMPLATE,
} from '@/common/constants/agent-ask.constants';
import { buildRankDatasetSections } from '@/common/utils/build-rank-analysis-prompt';

/**
 * 把账户分析「资产曲线」模块的数据段组装成「AI 分析」提示词
 *
 * 数据段由页面按当前区间组装（区间概览 / 最大回撤 / 净值序列抽样），
 * 本函数只负责：段落拼接 → 整体超长截断 → 填入模板。
 * 全部数据段都无行时返回空串，由调用方提示「暂无可分析的数据」。
 * @param rangeLabel 区间展示名（如「近1月」「2026-09-01 ~ 2026-10-23」，填入提示词）
 * @param datasets 数据段列表
 * @returns 提示词；无有效数据返回空串
 */
export const buildAssetCurveAnalysisPrompt = (
  rangeLabel: string,
  datasets: readonly RankDataset[],
): string => {
  const data = buildRankDatasetSections(datasets);
  if (data === '') {
    return '';
  }
  const capped =
    data.length > ASSET_CURVE_ANALYSIS_MAX_CHARS
      ? data.slice(0, ASSET_CURVE_ANALYSIS_MAX_CHARS) + '\n…（已截断）'
      : data;
  return ASSET_CURVE_ANALYSIS_PROMPT_TEMPLATE.replace('{range}', rangeLabel).replace(
    '{data}',
    capped,
  );
};
