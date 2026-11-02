import type { BoardCalendarRow } from '@/common/types/board-calendar.types';
import {
  BOARD_EXPAND_ANALYSIS_MAX_CHARS,
  BOARD_EXPAND_ANALYSIS_MAX_ROWS,
  BOARD_EXPAND_ANALYSIS_PROMPT_TEMPLATE,
  BOARD_EXPAND_ANALYSIS_ROW_LINE_TEMPLATE,
} from '@/common/constants/agent-ask.constants';
import { formatYuan } from '@/common/utils/format-yuan';

/** 携带给 Agent 的成分股明细行（扩展行表格行的最小投影） */
export interface BoardExpandAnalysisRow {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  turnoverRate: number | null;
  amount: number | null;
  /** 该日涨跌停标记（1 涨停 / -1 跌停 / null 非涨跌停或当日未知） */
  limitType: number | null;
}

/**
 * 板块日历扩展行「Agent 分析」提示词组装
 *
 * 数据全部来自扩展行当前已加载内容（当日汇总条 + 成分股表），零额外取数；
 * 成分股明细按涨跌幅降序取前 N 行（涨跌停成员置顶可见，符合「为什么大涨 / 大跌」的分析焦点）。
 * 无成分股明细时仍可分析（只带汇总），由调用方决定是否禁用入口。
 * @param board 被展开的板块行
 * @param tradeDate 交易日
 * @param scope 数据口径说明（当日实时 / 历史日仅涨跌停成员有涨跌数据 / 历史回补）
 * @param summary 当日汇总条目（label / value 已是展示文案）
 * @param rows 成分股明细（扩展行当前排序结果，涨跌幅降序）
 * @returns 提示词
 */
export const buildBoardExpandAnalysisPrompt = (
  board: BoardCalendarRow,
  tradeDate: string,
  scope: string,
  summary: ReadonlyArray<{ label: string; value: string }>,
  rows: readonly BoardExpandAnalysisRow[],
): string => {
  const summaryText = summary.map((item) => `${item.label} ${item.value}`).join('，');

  const lines = rows.slice(0, BOARD_EXPAND_ANALYSIS_MAX_ROWS).map((row) => {
    const pct =
      row.changePercent === null || row.changePercent === undefined
        ? '--'
        : `${row.changePercent.toFixed(2)}%`;
    const price = row.price === null || row.price === undefined ? '--' : row.price.toFixed(2);
    const amount = row.amount === null || row.amount === undefined ? '--' : formatYuan(row.amount);
    const turnover =
      row.turnoverRate === null || row.turnoverRate === undefined
        ? '--'
        : `${row.turnoverRate.toFixed(2)}%`;
    const limit =
      row.limitType === 1 ? '【涨停】' : row.limitType === -1 ? '【跌停】' : '';
    return BOARD_EXPAND_ANALYSIS_ROW_LINE_TEMPLATE.replace('{name}', row.name)
      .replace('{symbol}', row.symbol)
      .replace('{chg}', pct)
      .replace('{price}', price)
      .replace('{amount}', amount)
      .replace('{turnover}', turnover)
      .replace('{limit}', limit);
  });
  if (rows.length > BOARD_EXPAND_ANALYSIS_MAX_ROWS) {
    lines.push(`…（成分股共 ${rows.length} 只，仅携带涨跌幅前 ${BOARD_EXPAND_ANALYSIS_MAX_ROWS} 名）`);
  }
  const dataText = lines.join('\n');
  const capped =
    dataText.length > BOARD_EXPAND_ANALYSIS_MAX_CHARS
      ? dataText.slice(0, BOARD_EXPAND_ANALYSIS_MAX_CHARS) + '\n…（已截断）'
      : dataText;

  return BOARD_EXPAND_ANALYSIS_PROMPT_TEMPLATE.replace('{board}', board.name)
    .replace('{date}', tradeDate)
    .replace('{scope}', scope)
    .replace('{summary}', summaryText)
    .replace('{data}', capped);
};
