import type { ConceptBoard, IndustryBoard } from '../types/board.types';

/**
 * 板块行情常量
 */
export type BoardRow = IndustryBoard | ConceptBoard;

/** 排序方式选项（互斥按钮组；value 与板块字段对应） */
export const BOARD_SORT_OPTIONS = [
  { label: '按涨跌幅', value: 'changePercent' },
  { label: '按市值', value: 'totalMarketCap' },
] as const;

/** 板块类型选项（互斥按钮组） */
export const BOARD_TYPE_OPTIONS = [
  { label: '行业板块', value: 'industry' },
  { label: '概念板块', value: 'concept' },
] as const;

/** 涨跌分档阈值（%） */
export const BOARD_STAT_THRESHOLD = {
  /** 强势分界：|涨跌幅| > 3 视为大涨/大跌 */
  STRONG: 3,
} as const;

/**
 * 板块涨跌筛选值（代替魔法串）
 */
export const BOARD_FILTER = {
  ALL: 'all',
  UP: 'up',
  DOWN: 'down',
  UP_STRONG: 'up_strong',
  UP_ALL: 'up_all',
  DOWN_MILD: 'down_mild',
  DOWN_STRONG: 'down_strong',
} as const;

/** 板块涨跌筛选值类型 */
export type BoardFilterValue = (typeof BOARD_FILTER)[keyof typeof BOARD_FILTER];

/** 板块涨跌筛选选项（筛选按钮组） */
export const BOARD_FILTER_OPTIONS: readonly { label: string; value: BoardFilterValue }[] = [
  { label: '全部', value: BOARD_FILTER.ALL },
  { label: '上涨板块', value: BOARD_FILTER.UP },
  { label: '下跌板块', value: BOARD_FILTER.DOWN },
  { label: '涨幅>3%', value: BOARD_FILTER.UP_STRONG },
  { label: '涨幅≥0%', value: BOARD_FILTER.UP_ALL },
  { label: '跌幅<3%', value: BOARD_FILTER.DOWN_MILD },
  { label: '跌幅>3%', value: BOARD_FILTER.DOWN_STRONG },
];

/**
 * 判断板块是否命中筛选条件
 * @param changePercent 板块涨跌幅（可能为 null）
 * @param filter 筛选值
 * @returns 是否命中
 */
export const matchBoardFilter = (
  changePercent: number | null,
  filter: BoardFilterValue,
): boolean => {
  if (filter === BOARD_FILTER.ALL) {
    return true;
  }
  const pct = changePercent ?? 0;
  const threshold = BOARD_STAT_THRESHOLD.STRONG;
  switch (filter) {
    case BOARD_FILTER.UP:
      return pct > 0;
    case BOARD_FILTER.DOWN:
      return pct < 0;
    case BOARD_FILTER.UP_STRONG:
      return pct > threshold;
    case BOARD_FILTER.UP_ALL:
      return pct >= 0;
    case BOARD_FILTER.DOWN_MILD:
      return pct < 0 && pct >= -threshold;
    case BOARD_FILTER.DOWN_STRONG:
      return pct < -threshold;
    default:
      return true;
  }
};
