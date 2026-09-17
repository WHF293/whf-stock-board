import { BOARD_DETAIL_SORT } from '../constants/board-detail.constants';
import type {
  BoardDetailRow,
  BoardDetailSortBasis,
} from '../types/board-detail.types';

/**
 * 按涨跌幅降序排列成分股行（「涨跌幅大的在上面，小的在下面」）
 *
 * - 排序键为 `basis` 指定的口径：某一交易日的涨跌幅，或窗口区间累计涨跌幅；
 * - **无数据的票恒沉底**：降序语义下 null 若按数值 0 参与比较会插到中间，
 *   停牌股 / 次新股就混在平盘股里看不出区别 —— 沉底才符合「看得见的排前面」；
 * - 同值时按代码升序，保证同一份数据每次渲染顺序一致（不随上游返回顺序抖动）。
 * @param rows 成分股行（未排序，函数不修改入参）
 * @param basis 排序基准
 * @param dateIndex 基准为「某一交易日」时该日在 dates 中的下标
 * @returns 新的已排序数组
 */
export const sortBoardDetailRows = (
  rows: readonly BoardDetailRow[],
  basis: BoardDetailSortBasis,
  dateIndex: number,
): BoardDetailRow[] => {
  const pickValue = (row: BoardDetailRow): number | null =>
    basis === BOARD_DETAIL_SORT.CUMULATIVE ? row.cumulative : (row.cells[dateIndex] ?? null);

  return [...rows].sort((a, b) => {
    const left = pickValue(a);
    const right = pickValue(b);
    if (left === null && right === null) return a.symbol.localeCompare(b.symbol);
    if (left === null) return 1;
    if (right === null) return -1;
    if (right !== left) return right - left;
    return a.symbol.localeCompare(b.symbol);
  });
};
