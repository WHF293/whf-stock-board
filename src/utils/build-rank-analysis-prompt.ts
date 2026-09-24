import type { RankDataset } from '@/types/rank-dataset.types';
import {
  RANK_ANALYSIS_CELL_SEPARATOR,
  RANK_ANALYSIS_MAX_CHARS,
  RANK_ANALYSIS_MAX_ROWS,
  RANK_ANALYSIS_PROMPT_TEMPLATE,
  RANK_ANALYSIS_SECTION_TITLE_TEMPLATE,
} from '@/constants/agent-ask.constants';
import { AMOUNT_UNITS, NUMBER_PLACEHOLDER, YUAN_PER_WAN, YUAN_PER_YI } from '@/constants/format.constants';

/**
 * 单元格值转提示词文案：null / 非有限数值 → 占位符；
 * 大额数值换算万 / 亿（原始元值直接给模型可读性差），其余原样输出
 * @param value 单元格原始值
 * @returns 提示词文案
 */
const formatCellValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return NUMBER_PLACEHOLDER;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return NUMBER_PLACEHOLDER;
    }
    const abs = Math.abs(value);
    if (abs >= YUAN_PER_YI) {
      return `${(value / YUAN_PER_YI).toFixed(2)}${AMOUNT_UNITS.YI}`;
    }
    if (abs >= YUAN_PER_WAN) {
      return `${(value / YUAN_PER_WAN).toFixed(2)}${AMOUNT_UNITS.WAN}`;
    }
    return String(value);
  }
  return String(value);
};

/**
 * 单个数据段转文本块：标题行 + 表头行 + 前 N 行数据（超出补条数说明）
 * @param dataset 榜单数据段
 * @returns 文本块；无数据行返回空串
 */
const buildDatasetSection = (dataset: RankDataset): string => {
  if (dataset.rows.length === 0) {
    return '';
  }
  const lines: string[] = [
    RANK_ANALYSIS_SECTION_TITLE_TEMPLATE.replace('{title}', dataset.title),
    dataset.columns.map((col) => col.label).join(RANK_ANALYSIS_CELL_SEPARATOR),
  ];
  for (const row of dataset.rows.slice(0, RANK_ANALYSIS_MAX_ROWS)) {
    lines.push(
      dataset.columns.map((col) => formatCellValue(row[col.key])).join(RANK_ANALYSIS_CELL_SEPARATOR),
    );
  }
  if (dataset.rows.length > RANK_ANALYSIS_MAX_ROWS) {
    lines.push(`（仅展示前 ${RANK_ANALYSIS_MAX_ROWS} / 共 ${dataset.rows.length} 行）`);
  }
  return lines.join('\n');
};

/**
 * 把市场榜单数据组装成「AI 分析」提示词
 *
 * 每个数据段 = 标题行 + 表头行 + 前 N 行（大额数值换算万 / 亿），
 * 多数据段依次拼接（如异动页签 = 盘口异动 + 板块异动两段），整体超长截断。
 * 全部数据段都无行时返回空串，由调用方提示「暂无可分析的榜单数据」。
 * @param rank 榜单类型名（页签名，如「涨幅榜」「龙虎榜」）
 * @param datasets 榜单数据段列表
 * @returns 提示词；无有效数据返回空串
 */
export const buildRankAnalysisPrompt = (
  rank: string,
  datasets: readonly RankDataset[],
): string => {
  const sections = datasets
    .map(buildDatasetSection)
    .filter((section) => section !== '');
  if (sections.length === 0) {
    return '';
  }
  let data = sections.join('\n\n');
  if (data.length > RANK_ANALYSIS_MAX_CHARS) {
    data = data.slice(0, RANK_ANALYSIS_MAX_CHARS) + '\n…（已截断）';
  }
  return RANK_ANALYSIS_PROMPT_TEMPLATE.replace('{rank}', rank).replace('{data}', data);
};
