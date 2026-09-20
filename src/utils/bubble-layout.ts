/**
 * 气泡图纯几何布局（无 DOM / 无业务依赖，可单独跑断言）
 *
 * 语义：
 * - **x 轴 = 数值**（决定横向位置，值域两端各留一个最大半径，避免气泡越出画布）
 * - **半径 = |数值|**（决定面积）
 * - 气泡自**基线向上堆叠**：大泡先落位贴着基线，冲突则整体上移 → 互不重叠，
 *   顶部自然收窄（经典 bubble swarm 形态）。
 *
 * ⚠️ 半径用 `下限 + 增量 × √(|值| ÷ 最大|值|)` 而不是严格的 `∝ √|值|`：
 * 严格正比会让 0 值气泡退化成不可见的点，而「0 值」（多空完全均衡）是有效数据；
 * 该映射对 |值| **严格单调递增** ⇒「绝对值越大、面积越大」仍然成立。
 *
 * 文字行也是在这里定的：按「名称 + 数值 → 名称折两行 → 仅名称」逐个降级，
 * 用圆的**弦半宽**判断放不放得下（放不下就不画，交给悬停卡片）。
 */

/** 堆叠搜索迭代上限（防御性兜底，正常远达不到） */
const MAX_STACK_ITERATIONS = 4_000;

/** 高度收缩适配的最大迭代次数（线性收敛，正常 2 次内到位） */
const MAX_SHRINK_ITERATIONS = 4;

/** 气泡输入项 */
export interface BubbleLayoutItem {
  /** 唯一键（调用方回查原始数据用） */
  key: string;
  /** 显示名 */
  name: string;
  /** 决定横向位置与面积的数值 */
  value: number;
}

/** 气泡内的一行文字 */
export interface BubbleLabelLine {
  /** 文字内容 */
  text: string;
  /** 相对圆心的垂直偏移（像素，向下为正） */
  dy: number;
  /** 字号 */
  fontSize: number;
}

/** 布局后的气泡节点 */
export interface BubbleLayoutNode extends BubbleLayoutItem {
  /** 半径（面积与 |value| 单调同增） */
  r: number;
  /** 圆心 x */
  cx: number;
  /** 圆心 y */
  cy: number;
  /** |value| */
  magnitude: number;
  /** 气泡内文字（半径放不下时为空数组，交由悬停卡片展示） */
  labels: BubbleLabelLine[];
}

/** 坐标轴刻度 */
export interface BubbleAxisTick {
  /** 刻度值 */
  value: number;
  /** 刻度线 x */
  x: number;
  /** 刻度文案（已格式化） */
  label: string;
}

/** 气泡布局参数 */
export interface BubbleLayoutOptions {
  /** 画布宽度（viewBox 单位） */
  width: number;
  /** 画布最小高度（内容更矮时上下均分留白，避免画布过于扁平） */
  minHeight: number;
  /** 半径下限（|值| 趋 0 时的可读下限） */
  minRadius: number;
  /** 半径上限 */
  maxRadius: number;
  /** 气泡最小间距 */
  gap: number;
  /** 顶部留白 */
  topPadding: number;
  /** 底部留白（放刻度文案） */
  bottomPadding: number;
  /** 向上堆叠的步长（像素） */
  stackStep: number;
  /** 名称字号 */
  nameFontSize: number;
  /** 数值字号 */
  valueFontSize: number;
  /** 刻度数量目标 */
  tickCount: number;
  /** 数值文案格式化（用于气泡内数值行） */
  formatValue: (value: number) => string;
  /**
   * 画布高度上限（可选）：内容超高时按比例收缩 maxRadius 重排
   * （每列泡数近似不变 ⇒ 堆叠高度近似 ∝ 半径）；收缩到 minFitRadius 下限
   * 仍超高则按实际高度返回，由调用方等比缩放兜底（不出现滚动条）
   */
  maxHeight?: number;
  /** 收缩适配时 maxRadius 的下限（保护面积语义的层次感，应大于 minRadius） */
  minFitRadius?: number;
  /**
   * 固定画布高度（可选，高度裁决优先于 minHeight / maxHeight）：
   * 内容不足时上下均分富余；收缩到下限仍超高时退回内容高度防泡出界。
   * 用于「同数据多口径切换时画布高度保持一致」：调用方先算各口径的
   * 适配高度取公共值，再以本参数回灌；收缩目标也随之改用它
   */
  fixedHeight?: number;
}

/** 气泡布局结果（坐标已是最终画布坐标，直接进 viewBox） */
export interface BubbleLayoutResult {
  /** 画布宽度 */
  width: number;
  /** 画布高度 */
  height: number;
  /** 基线 y（气泡从基线向上堆叠） */
  baselineY: number;
  /** 基线左端 x */
  axisStartX: number;
  /** 基线右端 x */
  axisEndX: number;
  /** 刻度（值域跨 0 时必含 0） */
  ticks: BubbleAxisTick[];
  /** 0 值竖线 x（值域未跨 0 时为 null） */
  zeroX: number | null;
  /** 气泡节点（与入参同序） */
  nodes: BubbleLayoutNode[];
}

/**
 * 字符串半宽估算
 *
 * CJK 字符宽约等于字号、数字约 0.55 倍字号，统一取 0.52 倍并留 2px 余量，
 * 宁可少画一行字也不要让文字溢出圆外。
 * @param text 文字
 * @param fontSize 字号
 * @returns 估算半宽（像素）
 */
const estimateHalfWidth = (text: string, fontSize: number): number =>
  text.length * fontSize * 0.52 + 2;

/**
 * 判断若干文字行能否放进半径 r 的圆内
 * @param lines 文字行
 * @param r 圆半径
 * @returns 每行都放得下时为 true
 */
const linesFitCircle = (lines: BubbleLabelLine[], r: number): boolean =>
  lines.every((line) => {
    const halfHeight = line.fontSize / 2;
    // 该行的上下边缘里离圆心更远的一条决定可用弦长
    const maxAbsY = Math.max(
      Math.abs(line.dy - halfHeight),
      Math.abs(line.dy + halfHeight),
    );
    if (maxAbsY >= r) return false;
    const chordHalf = Math.sqrt(r * r - maxAbsY * maxAbsY);
    return chordHalf >= estimateHalfWidth(line.text, line.fontSize);
  });

/**
 * 为气泡挑一套放得下的文字方案（信息量由多到少降级）
 * @param name 名称
 * @param valueText 数值文案
 * @param r 半径
 * @param options 布局参数（取字号）
 * @returns 文字行；都放不下时为空数组
 */
const resolveLabels = (
  name: string,
  valueText: string,
  r: number,
  options: BubbleLayoutOptions,
): BubbleLabelLine[] => {
  const nameSize = options.nameFontSize;
  const valueSize = options.valueFontSize;
  const candidates: BubbleLabelLine[][] = [
    // ① 名称 + 数值：信息最全
    [
      { text: name, dy: -(valueSize * 0.8), fontSize: nameSize },
      { text: valueText, dy: nameSize * 0.9, fontSize: valueSize },
    ],
  ];
  // ② 名称折两行（4 字名 → 2 + 2），牺牲数值换名称
  if (name.length > 2) {
    const cut = Math.ceil(name.length / 2);
    candidates.push([
      { text: name.slice(0, cut), dy: -(nameSize * 0.55), fontSize: nameSize },
      { text: name.slice(cut), dy: nameSize * 0.8, fontSize: nameSize },
    ]);
  }
  // ③ 仅名称一行
  candidates.push([{ text: name, dy: 0, fontSize: nameSize }]);

  for (const lines of candidates) {
    if (linesFitCircle(lines, r)) return lines;
  }
  return [];
};

/**
 * 取「好看」的刻度步长（1 / 2 / 2.5 / 5 / 10 × 10ⁿ）
 * @param span 值域跨度
 * @param tickCount 目标刻度数
 * @returns 步长
 */
const niceStep = (span: number, tickCount: number): number => {
  const rough = span / Math.max(tickCount, 1);
  const power = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / power;
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return factor * power;
};

/**
 * 刻度文案：按步长决定小数位（大步长取整，防出现 `0.0`）
 * @param value 刻度值
 * @param step 步长
 * @returns 文案
 */
const formatTick = (value: number, step: number): string => {
  const digits = step > 0 && step < 1 ? (step < 0.1 ? 2 : 1) : 0;
  return value.toFixed(digits);
};

/**
 * 单轮布局计算（在给定生效 maxRadius 下完整求解）
 * @param items 气泡数据（顺序即返回的 nodes 顺序）
 * @param options 布局参数
 * @param effMaxRadius 本轮生效的半径上限（高度收缩适配会调低它）
 * @returns 布局结果（含 viewBox 尺寸、刻度与节点坐标）
 */
const computeLayout = (
  items: readonly BubbleLayoutItem[],
  options: BubbleLayoutOptions,
  effMaxRadius: number,
): BubbleLayoutResult => {
  if (items.length === 0) {
    return {
      width: options.width,
      height: options.minHeight,
      baselineY: options.minHeight - options.bottomPadding,
      axisStartX: 0,
      axisEndX: options.width,
      ticks: [],
      zeroX: null,
      nodes: [],
    };
  }

  const values = items.map((item) => item.value);
  const maxMagnitude = Math.max(...values.map((value) => Math.abs(value)));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueSpan = maxValue - minValue;

  /* 半径：|值| 越大 → 半径越大（面积单调同增） */
  const radiusSpan = effMaxRadius - options.minRadius;
  const radiusOf = (magnitude: number): number =>
    maxMagnitude > 0
      ? options.minRadius + radiusSpan * Math.sqrt(magnitude / maxMagnitude)
      : options.minRadius;

  /* 横轴：两侧各留一个最大半径，保证最大泡也不越界 */
  const sidePadding = effMaxRadius + options.gap * 2;
  const axisStartX = sidePadding;
  const axisEndX = Math.max(options.width - sidePadding, axisStartX + 1);
  const xOf = (value: number): number =>
    valueSpan > 0
      ? axisStartX + ((value - minValue) / valueSpan) * (axisEndX - axisStartX)
      : (axisStartX + axisEndX) / 2;

  const nodes: BubbleLayoutNode[] = items.map((item) => ({
    ...item,
    magnitude: Math.abs(item.value),
    r: radiusOf(Math.abs(item.value)),
    cx: xOf(item.value),
    cy: 0,
    labels: [],
  }));

  /* 自基线向上堆叠：大泡先落位（贴基线），冲突则整体上移 */
  const placed: Array<{ x: number; y: number; r: number }> = [];
  for (const node of [...nodes].sort((a, b) => b.r - a.r)) {
    let y = -node.r;
    let guard = 0;
    while (
      guard < MAX_STACK_ITERATIONS &&
      placed.some(
        (other) =>
          Math.hypot(other.x - node.cx, other.y - y) <
          other.r + node.r + options.gap,
      )
    ) {
      y -= options.stackStep;
      guard += 1;
    }
    node.cy = y;
    placed.push({ x: node.cx, y, r: node.r });
  }

  /* 画布高度：fixedHeight 优先（多口径统一高度），内容更高时退回内容高度防出界；
     否则内容高度与最小高度取大，富余部分上下均分 */
  const topExtent = Math.min(...placed.map((p) => p.y - p.r));
  const contentHeight = options.topPadding - topExtent + options.bottomPadding;
  const height =
    options.fixedHeight !== undefined
      ? Math.max(options.fixedHeight, contentHeight)
      : Math.max(options.minHeight, contentHeight);
  const baselineY = (height - contentHeight) / 2 + options.topPadding - topExtent;
  for (const node of nodes) {
    node.cy += baselineY;
    node.labels = resolveLabels(
      node.name,
      options.formatValue(node.value),
      node.r,
      options,
    );
  }

  /* 刻度：按值域取整齐步长，跨 0 时补一个 0 刻度 */
  const ticks: BubbleAxisTick[] = [];
  if (valueSpan > 0) {
    const step = niceStep(valueSpan, options.tickCount);
    for (
      let value = Math.ceil(minValue / step) * step;
      value <= maxValue + step * 1e-6;
      value += step
    ) {
      const rounded = Math.abs(value) < step * 1e-9 ? 0 : Number(value.toFixed(6));
      ticks.push({ value: rounded, x: xOf(rounded), label: formatTick(rounded, step) });
    }
  } else {
    ticks.push({ value: minValue, x: xOf(minValue), label: formatTick(minValue, 0) });
  }
  if (minValue < 0 && maxValue > 0 && !ticks.some((tick) => tick.value === 0)) {
    ticks.push({ value: 0, x: xOf(0), label: '0' });
    ticks.sort((a, b) => a.value - b.value);
  }

  return {
    width: options.width,
    height,
    baselineY,
    axisStartX,
    axisEndX,
    ticks,
    zeroX: minValue < 0 && maxValue > 0 ? xOf(0) : null,
    nodes,
  };
};

/**
 * 计算气泡图布局（对外入口）
 *
 * 传了 `maxHeight` 时做高度适配：内容超高 → 按高度比例收缩 maxRadius 重排
 * （每列泡数近似不变 ⇒ 堆叠高度近似 ∝ 半径，线性缩放即可收敛），
 * 收缩到 `minFitRadius` 下限仍超高则按实际高度返回，由调用方等比缩放兜底。
 * 传了 `fixedHeight` 时收缩目标改用它（多口径统一高度的回灌）。
 * @param items 气泡数据（顺序即返回的 nodes 顺序）
 * @param options 布局参数
 * @returns 布局结果（含 viewBox 尺寸、刻度与节点坐标）
 */
export const layoutBubbles = (
  items: readonly BubbleLayoutItem[],
  options: BubbleLayoutOptions,
): BubbleLayoutResult => {
  let effMaxRadius = options.maxRadius;
  let result = computeLayout(items, options, effMaxRadius);
  const heightTarget = options.fixedHeight ?? options.maxHeight;
  if (heightTarget === undefined) return result;

  const floorRadius = Math.max(options.minFitRadius ?? 0, options.minRadius);
  for (
    let iteration = 0;
    iteration < MAX_SHRINK_ITERATIONS &&
    result.height > heightTarget &&
    effMaxRadius > floorRadius;
    iteration += 1
  ) {
    // 单次收缩下限 0.5：宁可多迭代一轮，也不要一步把气泡缩到看不清
    const scale = Math.max(heightTarget / result.height, 0.5);
    const nextRadius = Math.max(Math.round(effMaxRadius * scale), floorRadius);
    if (nextRadius >= effMaxRadius) break;
    effMaxRadius = nextRadius;
    result = computeLayout(items, options, effMaxRadius);
  }
  return result;
};
