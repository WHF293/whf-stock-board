import type { RankDataset } from '@/common/types/rank-dataset.types';
import type { BoardCalendarViewMode } from '@/common/types/board-calendar.types';
import {
  BOARD_ROTATION_ANALYSIS_MAX_CHARS,
  BOARD_ROTATION_ANALYSIS_PROMPT_TEMPLATE,
  BOARD_ROTATION_VIEW_FOCUS,
} from '@/common/constants/agent-ask.constants';
import { buildRankDatasetSections } from '@/common/utils/build-rank-analysis-prompt';

/**
 * 把题材轮动页当前视图的数据段组装成「AI 分析」提示词
 *
 * 数据段由页面按当前激活视图组装（题材段 / 板块日历矩阵 / 赚钱效应排行 / 板块Top 矩阵），
 * 本函数只负责：视图专属解读要点注入 → 段落拼接 → 整体超长截断 → 填入模板。
 * 全部数据段都无行时返回空串，由调用方提示「暂无可分析的数据」。
 * @param mode 视图模式值（BoardCalendarViewMode，用于取视图专属解读要点）
 * @param viewLabel 视图展示名（如「题材轮动」「板块日历」，填入提示词）
 * @param datasets 当前视图的数据段列表
 * @returns 提示词；无有效数据返回空串
 */
export const buildBoardRotationAnalysisPrompt = (
  mode: BoardCalendarViewMode,
  viewLabel: string,
  datasets: readonly RankDataset[],
): string => {
  const data = buildRankDatasetSections(datasets);
  if (data === '') {
    return '';
  }
  const capped =
    data.length > BOARD_ROTATION_ANALYSIS_MAX_CHARS
      ? data.slice(0, BOARD_ROTATION_ANALYSIS_MAX_CHARS) + '\n…（已截断）'
      : data;
  const focus = BOARD_ROTATION_VIEW_FOCUS[mode] ?? '';
  return BOARD_ROTATION_ANALYSIS_PROMPT_TEMPLATE.replace('{view}', viewLabel)
    .replace('{focus}', focus)
    .replace('{data}', capped);
};
