import { CALENDAR_BOARDS } from '../constants/board-calendar.constants';

/**
 * 板块日历 · 板块列（行）顺序工具
 *
 * 设计要点：
 * - **顺序与勾选分开存**：`order` 是板块池代码的完整排列（决定行序），
 *   `hidden` 是未勾选的代码。若把两者合成「已勾选数组」，就无法区分
 *   「用户主动取消勾选」与「新版本新增了板块」——前者不该被自动补回来。
 * - `order` 等于默认序时表示**用户没有自定义行序**，此时表格按热门口径自动排序。
 */

/** 默认列顺序（= 板块池声明顺序：31 个申万一级 + 追加的热门板块） */
export const BOARD_DEFAULT_ORDER: readonly string[] = CALENDAR_BOARDS.map(
  (board) => board.code,
);

/**
 * 归一化列顺序：丢弃未知代码、去重、缺失的板块补到末尾
 *
 * 补齐而不是丢弃，是为了让**新版本新增的板块默认可见**（不会被历史设置挡住）；
 * 而「用户主动取消勾选」由 `hidden` 表达，不会被这里补回来。
 * @param order 待归一化的顺序（可能来自 localStorage，内容不可信）
 * @returns 板块池代码的完整排列
 */
export const normalizeBoardOrder = (order: readonly string[]): string[] => {
  const known = new Set(BOARD_DEFAULT_ORDER);
  const result: string[] = [];
  // 入参来自 localStorage（外部输入，可能是 null / 非数组 / 非字符串项）：
  // 坏值一律忽略，最差情况退化为完整默认序，绝不让页面因脏数据崩掉
  if (Array.isArray(order)) {
    for (const code of order) {
      if (typeof code === 'string' && known.has(code) && !result.includes(code)) {
        result.push(code);
      }
    }
  }
  for (const code of BOARD_DEFAULT_ORDER) {
    if (!result.includes(code)) {
      result.push(code);
    }
  }
  return result;
};

/**
 * 是否为默认顺序（默认 ⇒ 表格按热门口径自动排序）
 * @param order 列顺序
 * @returns true 表示未自定义
 */
export const isDefaultBoardOrder = (order: readonly string[]): boolean =>
  order.length === BOARD_DEFAULT_ORDER.length &&
  order.every((code, index) => code === BOARD_DEFAULT_ORDER[index]);

/**
 * 归一化隐藏项：仅保留已知代码并去重
 * @param hidden 待归一化的隐藏代码（可能来自 localStorage）
 * @returns 隐藏代码数组
 */
export const normalizeBoardHidden = (hidden: readonly string[]): string[] => {
  const known = new Set(BOARD_DEFAULT_ORDER);
  if (!Array.isArray(hidden)) return [];
  return [
    ...new Set(
      hidden.filter((code): code is string => typeof code === 'string' && known.has(code)),
    ),
  ];
};
