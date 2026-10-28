import type { RankDataset } from '@/common/types/rank-dataset.types';
import {
  BREADTH_ANALYSIS_MAX_CHARS,
  BREADTH_ANALYSIS_PROMPT_TEMPLATE,
} from '@/common/constants/agent-ask.constants';
import { buildRankDatasetSections } from '@/common/utils/build-rank-analysis-prompt';

/**
 * 把市场宽度页的广度指标摘要组装成「AI 分析」提示词
 *
 * 摘要数据段（最新截面 + 近段趋势）由页面组装，本函数只负责：
 * 数据积累天数注入 → 段落拼接 → 整体超长截断 → 填入模板。
 * 全部数据段都无行时返回空串，由调用方提示「暂无可分析的数据」。
 * @param accumDays 本地已积累的交易日数（不足 50 日时提示词告知 Agent 长窗口指标未成熟）
 * @param datasets 指标摘要数据段列表
 * @returns 提示词；无有效数据返回空串
 */
export const buildBreadthAnalysisPrompt = (
  accumDays: number,
  datasets: readonly RankDataset[],
): string => {
  const data = buildRankDatasetSections(datasets);
  if (data === '') {
    return '';
  }
  const capped =
    data.length > BREADTH_ANALYSIS_MAX_CHARS
      ? data.slice(0, BREADTH_ANALYSIS_MAX_CHARS) + '\n…（已截断）'
      : data;
  return BREADTH_ANALYSIS_PROMPT_TEMPLATE.replace('{days}', String(accumDays)).replace(
    '{data}',
    capped,
  );
};
