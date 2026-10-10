/**
 * 盯盘气泡「板块热力」视图 · squarified treemap 布局（Bruls et al. 算法）
 *
 * 为什么不用 ECharts：气泡是独立轻量入口（watch-widget.html），为一个静态、
 * 无交互的迷你热力图引入整套图表库不成比例 —— 这里用纯函数 + SVG 渲染，
 * 面积权重与色阶口径与市场总览的 HeatmapChart 保持一致。
 *
 * 纯函数无副作用：输入权重序列与容器尺寸，输出与输入等长的矩形序列
 * （顺序一一对应），调用方自行叠加颜色与标签。
 */

/** 布局输出的矩形（容器左上角为原点，单位与传入宽高一致） */
export interface TreemapRect {
  /** 左上角 x */
  x: number;
  /** 左上角 y */
  y: number;
  /** 宽 */
  w: number;
  /** 高 */
  h: number;
}

/**
 * squarified treemap：把权重序列切成纵横比尽量接近 1 的矩形块
 *
 * @param values 权重序列（负值按 0 处理；全 0 / 容器无效时返回同长度的零矩形）
 * @param width 容器宽
 * @param height 容器高
 * @returns 与 values 等长的矩形序列（顺序一一对应）
 */
export const squarifyLayout = (
  values: number[],
  width: number,
  height: number,
): TreemapRect[] => {
  const count = values.length;
  if (count === 0) return [];
  if (width <= 0 || height <= 0) {
    return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  }
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (total <= 0) {
    // 全 0 权重退化为均分：保证「有数据但无市值字段」时仍能整面铺开
    return splitEvenly(count, width, height);
  }
  const scaled = values.map((value) => (Math.max(value, 0) / total) * width * height);
  const rects: TreemapRect[] = new Array(count);
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  /**
   * 当前行块的权重和
   * @param row 行内权重下标集合
   * @returns 权重和
   */
  const rowArea = (row: number[]): number => row.reduce((sum, i) => sum + scaled[i], 0);
  /**
   * 行内块沿剩余矩形短边排布时的最差纵横比（越接近 1 越方正）
   * @param row 候选行（权重下标集合）
   * @returns 最差纵横比；空行 / 退化尺寸返回 Infinity
   */
  const worstRatio = (row: number[]): number => {
    if (row.length === 0) return Number.POSITIVE_INFINITY;
    const side = Math.min(w, h);
    const thickness = rowArea(row) / side;
    if (thickness <= 0 || side <= 0) return Number.POSITIVE_INFINITY;
    let worst = 0;
    for (const i of row) {
      const length = scaled[i] / thickness;
      if (length <= 0) return Number.POSITIVE_INFINITY;
      worst = Math.max(worst, Math.max(thickness / length, length / thickness));
    }
    return worst;
  };
  /** 把当前行按短边方向落位，并收缩剩余矩形 */
  const flushRow = (): void => {
    if (row.length === 0) return;
    const area = rowArea(row);
    if (w >= h) {
      // 剩余矩形更宽：行作为左侧竖列，块自上而下堆叠
      const thickness = area / h;
      let cy = y;
      for (const i of row) {
        const itemHeight = scaled[i] / thickness;
        rects[i] = { x, y: cy, w: thickness, h: itemHeight };
        cy += itemHeight;
      }
      x += thickness;
      w -= thickness;
    } else {
      // 剩余矩形更高：行作为顶部横排，块自左向右排列
      const thickness = area / w;
      let cx = x;
      for (const i of row) {
        const itemWidth = scaled[i] / thickness;
        rects[i] = { x: cx, y, w: itemWidth, h: thickness };
        cx += itemWidth;
      }
      y += thickness;
      h -= thickness;
    }
    row = [];
  };

  let row: number[] = [];
  for (let i = 0; i < count; i++) {
    if (row.length === 0) {
      row = [i];
      continue;
    }
    // 加入当前块后纵横比不变差 → 并入当前行；否则先落位当前行再开新行
    const merged = [...row, i];
    if (worstRatio(merged) <= worstRatio(row)) {
      row = merged;
    } else {
      flushRow();
      row = [i];
    }
  }
  flushRow();
  return rects;
};

/**
 * 全 0 权重的均分回退：按网格近似正方切分
 * @param count 块数
 * @param width 容器宽
 * @param height 容器高
 * @returns 网格均分矩形序列
 */
const splitEvenly = (count: number, width: number, height: number): TreemapRect[] => {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellW = width / cols;
  const cellH = height / rows;
  return Array.from({ length: count }, (_, i) => ({
    x: (i % cols) * cellW,
    y: Math.floor(i / cols) * cellH,
    w: cellW,
    h: cellH,
  }));
};
