import type { Chart, YAxis } from 'klinecharts';

/**
 * Y 轴刻度文字着色覆盖层（2026-11-02 王总需求：轴文字上方涨色 / 下方跌色）
 *
 * 为什么需要覆盖层：klinecharts v10 的轴刻度文字**不支持按刻度值分色**——
 * 绘制时全部刻度共用同一个 styles.yAxis.tickText 样式对象（源码 AxisView.drawImp
 * → createFigure({ name: 'text', styles: styles.tickText })），AxisTick 上也没有
 * 样式字段，且所有 y 轴共享一份全局样式（无法按 pane/轴单独设色）。
 *
 * 实现思路（零侵入库内部）：
 * 1. 宿主把 yAxis.tickText.color 设为 'transparent'（show 保持 true）——
 *    刻度文字原生不可见，但 getAutoSize 的自动宽度计算照常生效
 *    （含最新价标 / 十字光标标签的撑宽逻辑），布局与改造前完全一致
 * 2. 本模块用一层铺满图表容器的 pointer-events-none canvas，按帧把每个轴的
 *    刻度文字重画一遍，颜色按刻度值相对基准值取 涨/跌/中性 色
 * 3. 用 requestAnimationFrame + 签名比对做脏检查：轴几何、刻度、基准值、
 *    主题色全都没变时跳过重绘，空闲开销可忽略（rAF 在页签后台自动暂停）
 *
 * 几何来源：轴实例的运行时方法 getBounding()（YAxisImp → 所属轴 widget 包围盒，
 * left/top 为图表根容器坐标系；公开类型未声明，属库内部实现——klinecharts 版本
 * 锁定在 package.json，升级时需回归本模块）。缺失时回退 chart.getSize(paneId,'yAxis')
 */

/** 轴 widget 包围盒（图表根容器坐标系） */
interface AxisBounding {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 刻度着色三色：高于基准 / 低于基准 / 基准（含副图轴中性色） */
export interface YAxisTextOverlayColors {
  up: string;
  down: string;
  neutral: string;
}

export interface YAxisTextOverlayOptions {
  /** 取当前图表实例（未初始化时返回 null，覆盖层空转） */
  getChart: () => Chart | null;
  /** 覆盖层画布（须绝对定位铺满图表容器） */
  getCanvas: () => HTMLCanvasElement | null;
  /**
   * 某轴的着色基准值（像素上方的刻度用涨色、下方用跌色、相等用中性色）；
   * 返回 null → 该轴全部用中性色（副图 VOL/MACD 轴传 null）
   */
  resolveBaseline: (paneId: string, axis: YAxis) => number | null;
  /** 涨/跌/中性色（随涨跌主题变化；返回值纳入重绘签名） */
  getColors: () => YAxisTextOverlayColors;
}

/**
 * 取轴 widget 包围盒：优先轴实例运行时 getBounding()（多轴面板各取各的），
 * 回退 chart.getSize(paneId, 'yAxis')（多轴面板只返回首个轴，仅兜底用）
 *
 * @param chart 图表实例
 * @param paneId 轴所在面板 id
 * @param axis 轴实例
 * @returns 包围盒（图表根容器坐标系）；取不到时返回 null
 */
const resolveAxisBounding = (
  chart: Chart,
  paneId: string,
  axis: YAxis,
): AxisBounding | null => {
  const own = axis as unknown as {
    getBounding?: () => AxisBounding | null;
  };
  if (typeof own.getBounding === 'function') {
    const bounding = own.getBounding();
    if (
      bounding &&
      Number.isFinite(bounding.left) &&
      Number.isFinite(bounding.top) &&
      bounding.width > 0 &&
      bounding.height > 0
    ) {
      return bounding;
    }
  }
  const size = chart.getSize(paneId, 'yAxis');
  if (
    size &&
    Number.isFinite(size.left) &&
    Number.isFinite(size.top) &&
    size.width > 0 &&
    size.height > 0
  ) {
    return size;
  }
  return null;
};

/**
 * 启动 Y 轴刻度文字着色覆盖层
 *
 * @param options 覆盖层配置（图表/画布获取器、着色基准解析、主题色）
 * @returns 停止函数（取消 rAF 循环，宿主 onBeforeUnmount 调用）
 */
export const startYAxisTextOverlay = (
  options: YAxisTextOverlayOptions,
): (() => void) => {
  let rafId = 0;
  let lastSignature = '';

  const frame = (): void => {
    rafId = requestAnimationFrame(frame);
    const chart = options.getChart();
    const canvas = options.getCanvas();
    if (!chart || !canvas) return;

    // 画布尺寸同步（CSS 尺寸由布局决定，像素尺寸按 dpr 对齐）
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      lastSignature = '';
    }

    const styles = chart.getStyles();
    const yAxisStyles = styles.yAxis;
    const tickTextStyles = yAxisStyles.tickText;
    const colors = options.getColors();

    // 收集全部面板的全部 y 轴快照（几何 + 刻度 + 基准），供签名比对
    const paneOptions = chart.getPaneOptions();
    const paneList = Array.isArray(paneOptions) ? paneOptions : [];
    const axes: {
      bounding: AxisBounding;
      fromZero: boolean;
      baseline: number | null;
      ticks: { coord: number; value: number; text: string }[];
    }[] = [];
    for (const pane of paneList) {
      for (const axis of chart.getYAxes({ paneId: pane.id })) {
        const ticks = axis.getTicks();
        if (ticks.length === 0) continue;
        const bounding = resolveAxisBounding(chart, pane.id, axis);
        if (!bounding) continue;
        axes.push({
          bounding,
          fromZero: axis.isFromZero(),
          baseline: options.resolveBaseline(pane.id, axis),
          ticks: ticks
            .filter((tick) => Number.isFinite(tick.coord))
            .map((tick) => ({
              coord: tick.coord,
              value: Number(tick.value),
              text: tick.text,
            })),
        });
      }
    }

    // 签名比对：几何 / 刻度 / 基准 / 主题色 / 字体 全部未变则跳过重绘
    const signature = JSON.stringify({
      colors,
      font: [
        tickTextStyles.size,
        tickTextStyles.weight,
        tickTextStyles.family,
        tickTextStyles.marginStart,
        tickTextStyles.marginEnd,
        yAxisStyles.axisLine.show,
        yAxisStyles.axisLine.size,
        yAxisStyles.tickLine.show,
        yAxisStyles.tickLine.length,
      ],
      axes,
    });
    if (signature === lastSignature) return;
    lastSignature = signature;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // 文字定位与库内 YAxisView.createTickTexts 完全同式：
    // 左置轴（isFromZero）文字贴轴区左缘左对齐，右置轴贴右缘右对齐；
    // x 需让出轴线宽 + 刻度线长（marginStart/End 由样式给）
    ctx.font = `${tickTextStyles.weight} ${tickTextStyles.size}px ${tickTextStyles.family}`;
    ctx.textBaseline = 'middle';
    const lineInset =
      (yAxisStyles.axisLine.show ? yAxisStyles.axisLine.size : 0) +
      (yAxisStyles.tickLine.show ? yAxisStyles.tickLine.length : 0);
    for (const axis of axes) {
      ctx.textAlign = axis.fromZero ? 'left' : 'right';
      const x = axis.fromZero
        ? axis.bounding.left + tickTextStyles.marginStart + lineInset
        : axis.bounding.left +
          axis.bounding.width -
          tickTextStyles.marginEnd -
          lineInset;
      const { baseline } = axis;
      // 基准相等判定容差：分时价格轴中刻度由 pre±bound 浮点反推，
      // 与 pre 严格相等不可靠，按量级相对容差判等（远小于文本小数位精度）
      const eps =
        baseline === null ? 0 : Math.max(Math.abs(baseline) * 1e-6, 1e-9);
      for (const tick of axis.ticks) {
        ctx.fillStyle =
          baseline === null || !Number.isFinite(tick.value)
            ? colors.neutral
            : tick.value > baseline + eps
              ? colors.up
              : tick.value < baseline - eps
                ? colors.down
                : colors.neutral;
        ctx.fillText(tick.text, x, axis.bounding.top + tick.coord);
      }
    }
  };

  rafId = requestAnimationFrame(frame);
  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };
};
