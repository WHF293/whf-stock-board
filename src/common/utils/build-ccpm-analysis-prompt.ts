import type { RankDataset } from '@/common/types/rank-dataset.types';
import {
  CCPM_ANALYSIS_MAX_CHARS,
  CCPM_ANALYSIS_PROMPT_TEMPLATE,
} from '@/common/constants/agent-ask.constants';
import { buildRankDatasetSections } from '@/common/utils/build-rank-analysis-prompt';

/**
 * 把机构行为页（中金所 CCPM 席位持仓）的当前口径数据组装成「AI 分析」提示词
 *
 * 席位数据段（概览指标 / 排行榜 / 选中席位明细）由页面组装，本函数只负责：
 * 口径与披露日注入 → 段落拼接 → 整体超长截断 → 填入模板。
 * 全部数据段都无行时返回空串，由调用方提示「暂无可分析的数据」。
 * @param scopeLabel 当前口径展示名（如「品种合约」「会员汇总」「全部品种」）
 * @param dayText 披露交易日（`yyyy-MM-dd`；数据未就绪传空串，提示词显「未就绪」）
 * @param datasets 席位数据段列表
 * @returns 提示词；无有效数据返回空串
 */
export const buildCcpmAnalysisPrompt = (
  scopeLabel: string,
  dayText: string,
  datasets: readonly RankDataset[],
): string => {
  const data = buildRankDatasetSections(datasets);
  if (data === '') {
    return '';
  }
  const capped =
    data.length > CCPM_ANALYSIS_MAX_CHARS
      ? data.slice(0, CCPM_ANALYSIS_MAX_CHARS) + '\n…（已截断）'
      : data;
  return CCPM_ANALYSIS_PROMPT_TEMPLATE.replace('{scope}', scopeLabel)
    .replace('{day}', dayText === '' ? '未就绪' : dayText)
    .replace('{data}', capped);
};
