/**
 * 净值序列最大回撤（纯函数，资产曲线 AI 分析用）
 */

/** 最大回撤结果 */
export interface MaxDrawdownResult {
  /** 峰值日期 */
  peakDate: string;
  /** 谷底日期 */
  troughDate: string;
  /** 回撤深度（正值小数口径，如 0.0832 = -8.32%） */
  depth: number;
  /** 是否已在区间内收复（谷底后又创出峰值新高） */
  recovered: boolean;
}

/**
 * 求序列的最大回撤窗口（峰值 → 谷底）
 * @param points 时间点序列（date 升序；value 为净值类正值）
 * @returns 最大回撤；序列不足 2 点或无回撤（单调不降）返回 null
 */
export const findMaxDrawdown = (
  points: readonly { date: string; value: number }[],
): MaxDrawdownResult | null => {
  let best: MaxDrawdownResult | null = null;
  let peakValue = Number.NEGATIVE_INFINITY;
  let peakDate = '';
  for (const point of points) {
    if (point.value > peakValue) {
      peakValue = point.value;
      peakDate = point.date;
      continue;
    }
    if (peakValue <= 0) {
      continue;
    }
    const depth = 1 - point.value / peakValue;
    if (depth > 0 && (!best || depth > best.depth)) {
      best = {
        peakDate,
        troughDate: point.date,
        depth,
        recovered: false,
      };
    }
  }
  if (!best) {
    return null;
  }
  // 收复判定：谷底之后是否出现超过峰值的新高
  const troughIndex = points.findIndex((point) => point.date === best.troughDate);
  best.recovered = points
    .slice(troughIndex)
    .some((point) => point.value >= peakValue);
  return best;
};
