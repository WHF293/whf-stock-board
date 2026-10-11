/**
 * 把数组按固定大小分块
 *
 * 用途：SQLite 单条 SQL 的占位符数量有上限（`SQLITE_MAX_VARIABLE_NUMBER`），
 * 多值 INSERT 必须先分块，否则行数一多就报 "too many SQL variables"。
 * @param items 原始数组
 * @param size 每块大小（必须为正整数）
 * @returns 分块后的二维数组（入参不修改）
 */
export const chunkArray = <T>(items: readonly T[], size: number): T[][] => {
  if (size <= 0) {
    return [items.slice()];
  }
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};
