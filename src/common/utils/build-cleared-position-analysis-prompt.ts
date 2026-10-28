import type { RankDataset } from '@/common/types/rank-dataset.types';
import {
  CLEARED_POSITION_ANALYSIS_MAX_CHARS,
  CLEARED_POSITION_ANALYSIS_PROMPT_TEMPLATE,
} from '@/common/constants/agent-ask.constants';
import { buildRankDatasetSections } from '@/common/utils/build-rank-analysis-prompt';

/**
 * 把账户分析「清仓分析」模块的数据段组装成「AI 分析」提示词
 *
 * 数据段由页面组装（周期汇总 / 持有天数分桶 / 最大盈亏单明细），
 * 本函数只负责：段落拼接 → 整体超长截断 → 填入模板。
 * 全部数据段都无行时返回空串，由调用方提示「暂无可分析的数据」。
 * @param datasets 数据段列表
 * @returns 提示词；无有效数据返回空串
 */
export const buildClearedPositionAnalysisPrompt = (
  datasets: readonly RankDataset[],
): string => {
  const data = buildRankDatasetSections(datasets);
  if (data === '') {
    return '';
  }
  const capped =
    data.length > CLEARED_POSITION_ANALYSIS_MAX_CHARS
      ? data.slice(0, CLEARED_POSITION_ANALYSIS_MAX_CHARS) + '\n…（已截断）'
      : data;
  return CLEARED_POSITION_ANALYSIS_PROMPT_TEMPLATE.replace('{data}', capped);
};
