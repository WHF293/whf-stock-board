/**
 * Squarified treemap 布局（纯函数，零依赖）
 *
 * 经典 squarified 算法：条目按面积降序，逐「行」填充剩余矩形（行沿当前短边方向），
 * 以各行格子的最佳宽高比（worst ratio）决定行是否收尾，使格子尽量接近正方形。
 * 输出不含间隙，间隙由渲染层在每格内缩绘制。
 */

/** treemap 输入条目 */
export interface TreemapInput {
  /** 展示名 */
  name: string;
  /** 面积权重（> 0） */
  value: number;
}

/** treemap 输出矩形（坐标基于 0,0 起、width×height 的画布） */
export interface TreemapRect {
  name: string;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 生成 squarified treemap 布局
 * @param items 输入条目（value <= 0 的条目会被忽略）
 * @param width 画布宽（像素）
 * @param height 画布高（像素）
 * @returns 矩形列表（与有效输入同序：value 降序）；总面积 / 尺寸非法时返回空数组
 */
export function squarifyTreemap(items: readonly TreemapInput[], width: number, height: number): TreemapRect[] {
  if (width <= 0 || height <= 0) return [];
  const valid = items.filter((item) => item.value > 0);
  const total = valid.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return [];

  const sorted = [...valid].sort((a, b) => b.value - a.value);
  const scale = (width * height) / total;

  const out: TreemapRect[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let row: { item: TreemapInput; area: number }[] = [];

  /**
   * 行的 worst 宽高比（Bruls et al. squarified treemap 论文口径）
   * @param areas 行内各格面积
   * @param thickness 行厚（沿短边）
   * @returns 最差宽高比（越小越接近正方形）
   */
  const worstRatio = (areas: readonly number[], thickness: number): number => {
    if (areas.length === 0 || thickness <= 0) return Infinity;
    let min = Infinity;
    let max = 0;
    let sum = 0;
    for (const area of areas) {
      min = Math.min(min, area);
      max = Math.max(max, area);
      sum += area;
    }
    const s2 = sum * sum;
    const t2 = thickness * thickness;
    return Math.max((t2 * max) / s2, s2 / (t2 * min));
  };

  /**
   * 把当前行铺进剩余区域并输出
   * @param rowItems 行内条目
   * @returns 扣除行厚度后的剩余区域
   */
  const flushRow = (rowItems: { item: TreemapInput; area: number }[]): void => {
    const sum = rowItems.reduce((acc, r) => acc + r.area, 0);
    if (sum <= 0 || w <= 0 || h <= 0) return;
    if (w >= h) {
      // 行沿宽方向铺满，厚度占 h
      const thickness = sum / w;
      let offset = x;
      for (const r of rowItems) {
        out.push({ name: r.item.name, value: r.item.value, x: offset, y, w: r.area / thickness, h: thickness });
        offset += r.area / thickness;
      }
      y += thickness;
      h -= thickness;
    } else {
      // 列沿高方向铺满，厚度占 w
      const thickness = sum / h;
      let offset = y;
      for (const r of rowItems) {
        out.push({ name: r.item.name, value: r.item.value, x, y: offset, w: thickness, h: r.area / thickness });
        offset += r.area / thickness;
      }
      x += thickness;
      w -= thickness;
    }
  };

  for (const item of sorted) {
    const area = item.value * scale;
    const thickness = Math.min(w, h);
    if (thickness <= 0) break;
    if (row.length === 0 || worstRatio([...row.map((r) => r.area), area], thickness) <= worstRatio(row.map((r) => r.area), thickness)) {
      row.push({ item, area });
    } else {
      flushRow(row);
      row = [{ item, area }];
    }
  }
  flushRow(row);
  return out;
}
