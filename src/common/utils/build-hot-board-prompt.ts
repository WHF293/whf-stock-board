import type { HotBoardItem } from '@/common/types/hot-board.types';
import {
  BOARD_ANALYSIS_ITEM_LINE_TEMPLATE,
  BOARD_ANALYSIS_MAX_CHARS,
  BOARD_ANALYSIS_MAX_ROWS_PER_BOARD,
  BOARD_ANALYSIS_PROMPT_TEMPLATE,
  BOARD_ANALYSIS_SECTION_TITLE_TEMPLATE,
} from '@/common/constants/agent-ask.constants';

/** 单张榜单的数据段（平台名 + 分组名 + 条目） */
export interface BoardPromptSection {
  /** 平台展示名（如「同花顺热榜」） */
  boardLabel: string;
  /** 分组展示名（如「大家都在看」） */
  groupLabel: string;
  /** 该榜条目（已按名次升序） */
  items: readonly HotBoardItem[];
}

/**
 * 把数值格式化为 prompt 展示文本（null 归一为「--」，避免散落 undefined）
 * @param value 数值（可为 null）
 * @param suffix 数值后缀（如「元」「%」）
 * @returns 展示文本
 */
const toNumText = (value: number | null, suffix: string): string =>
  value === null ? '--' : `${value.toFixed(2)}${suffix}`;

/**
 * 把单张榜单拼成数据段文本
 * @param section 榜单数据段
 * @returns 文本（标题行 + 条目行；上限内全量，超限截断）
 */
const toSectionText = (section: BoardPromptSection): string => {
  const title = BOARD_ANALYSIS_SECTION_TITLE_TEMPLATE.replace(
    '{board}',
    section.boardLabel,
  ).replace('{group}', section.groupLabel);
  const lines = section.items
    .slice(0, BOARD_ANALYSIS_MAX_ROWS_PER_BOARD)
    .map((item) => {
      const heat = item.heatLabel !== '' ? item.heatLabel : '热度 --';
      const tags =
        item.tags.length > 0 ? `，标签：${item.tags.join('、')}` : '';
      const rankChange =
        item.rankChange === null
          ? ''
          : `（排名${item.rankChange >= 0 ? '↑' : '↓'}${Math.abs(item.rankChange)}）`;
      return (
        BOARD_ANALYSIS_ITEM_LINE_TEMPLATE.replace('{rank}', String(item.rank))
          .replace('{name}', item.name)
          .replace('{code}', item.code)
          .replace('{price}', toNumText(item.price, '元'))
          .replace('{chg}', toNumText(item.changePct, '%'))
          .replace('{heat}', `${heat}${rankChange}`) + tags
      );
    });
  return `${title}\n${lines.join('\n')}`;
};

/**
 * 把五平台热股榜单组装成「AI 分析」提示词
 *
 * 每榜独立截断（每榜上限 BOARD_ANALYSIS_MAX_ROWS_PER_BOARD 行，保住每平台的
 * 头部共识而非让单一长榜刷屏）→ 拼各数据段 → 超整体上限时整段丢弃并注明。
 * 全部榜单为空返回空串，由调用方提示「暂无可分析的榜单」。
 * @param sections 榜单数据段列表
 * @returns 提示词；无有效数据返回空串
 */
export const buildHotBoardPrompt = (
  sections: readonly BoardPromptSection[],
): string => {
  const parts: string[] = [];
  for (const section of sections) {
    if (section.items.length === 0) continue;
    const text = toSectionText(section);
    if (parts.join('\n\n').length + text.length > BOARD_ANALYSIS_MAX_CHARS) {
      parts.push('…（因长度限制后续榜单未纳入）');
      break;
    }
    parts.push(text);
  }
  if (parts.length === 0) return '';
  return BOARD_ANALYSIS_PROMPT_TEMPLATE.replace('{boards}', parts.join('\n\n'));
};
