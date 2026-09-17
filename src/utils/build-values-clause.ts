/**
 * 生成多值 INSERT 的 VALUES 占位符片段
 *
 * 例：2 行 3 列 → `($1,$2,$3),($4,$5,$6)`
 * @param rowCount 行数
 * @param colCount 每行列数
 * @returns 占位符片段
 */
export const buildValuesClause = (rowCount: number, colCount: number): string => {
  const groups: string[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const slots: string[] = [];
    for (let col = 0; col < colCount; col += 1) {
      slots.push(`$${row * colCount + col + 1}`);
    }
    groups.push(`(${slots.join(',')})`);
  }
  return groups.join(',');
};
