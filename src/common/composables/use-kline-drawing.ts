import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import type { Chart, Overlay, Point } from 'klinecharts';
import {
  KLINE_DRAWING_SAVE_DEBOUNCE_MS,
  KLINE_DRAWING_SHAPES,
} from '../constants/kline-drawing.constants.ts';
import { loadKlineDrawings, saveKlineDrawings } from '../api/kline-drawing-db.api.ts';
import type { KlineDrawingRecord, KlineDrawingShape } from '../types/kline-drawing.types.ts';

/**
 * K 线画线工具（useKlineDrawing）：绘制 / 选中删除 / 清空 / 持久化恢复
 *
 * - 走 klinecharts 内置 overlay 注册形状（`chart.createOverlay({ name })`），
 *   成交 BS/T 标注（tradePoint，overlay-trade-point.ts）不在本工具管辖范围；
 * - 持久化口径：锚点存时间戳 + 价格（**不存 K 线索引**——增量补尾后索引错位），
 *   一票一周期整行 upsert（见 kline-drawing-db.api.ts）；
 * - 序列化源 = `chart.getOverlays()` 按本工具形状白名单过滤，排除 tradePoint
 *   与绘制中（currentStep < totalStep）的半成品；
 * - 签名：`(chartRef, symbol, period, enabled)`；enabled=false（分时 / 五日）
 *   时不恢复也不允许开绘，工具条由调用方置灰。
 * @param chartRef klinecharts 实例引用（来自 KlineChart 的 defineExpose）
 * @param symbol 完整符号（响应式）
 * @param period K 线周期（响应式）
 * @param enabled 是否允许画线（candle 模式 true）
 * @returns 工具条状态与动作
 */
export const useKlineDrawing = (
  chartRef: Ref<Chart | null> | ComputedRef<Chart | null>,
  symbol: Ref<string>,
  period: Ref<string>,
  enabled: Ref<boolean>,
) => {
  /** 当前待绘制形状（null = 未进入绘制态） */
  const activeShape = ref<KlineDrawingShape | null>(null);

  /** 本工具形状是否整体可见（隐藏 = removeOverlay 全部并保留数据，恢复时重建） */
  const drawingVisible = ref(true);

  /** 最近选中的 overlay id（点击画线时记录，删除按钮消费） */
  const lastSelectedId = ref<string | null>(null);

  /** 当前票当前周期的形状数（工具条徽标） */
  const shapeCount = ref(0);

  /** 本工具形状名白名单（过滤 getOverlays 结果用） */
  const SHAPE_NAMES = new Set<string>(KLINE_DRAWING_SHAPES.map((shape) => shape.name));

  /**
   * 半成品过滤：绘制中的 overlay（currentStep 未走完）不参与序列化
   * @param overlay 待判定 overlay
   * @returns 是否为已完成的本工具形状
   */
  const isCompletedDrawing = (overlay: Overlay): boolean =>
    SHAPE_NAMES.has(overlay.name) &&
    typeof overlay.totalStep === 'number' &&
    overlay.currentStep >= overlay.totalStep;

  /**
   * 从图表实例序列化当前画线（过滤白名单 + 完成态）
   * @returns 形状快照数组
   */
  const serializeShapes = (): KlineDrawingRecord[] => {
    const chart = chartRef.value;
    if (chart === null) return [];
    const records: KlineDrawingRecord[] = [];
    for (const overlay of chart.getOverlays()) {
      if (!isCompletedDrawing(overlay)) continue;
      const points = overlay.points
        .filter(
          (point): point is Point =>
            typeof point.timestamp === 'number' && typeof point.value === 'number',
        )
        .map((point) => ({ timestamp: point.timestamp, value: point.value }));
      if (points.length === 0) continue;
      records.push({ id: overlay.id, name: overlay.name as KlineDrawingShape, points });
    }
    return records;
  };

  /** 防抖落库（绘制过程频繁触发，整批序列化一次写入） */
  const debouncedSave = useDebounceFn(() => {
    const shapes = serializeShapes();
    shapeCount.value = shapes.length;
    void saveKlineDrawings(symbol.value, period.value, shapes);
  }, KLINE_DRAWING_SAVE_DEBOUNCE_MS);

  /** 绘制结束 / 增删改后的统一收尾：刷新计数并防抖保存 */
  const afterChange = (): void => {
    debouncedSave();
  };

  /**
   * 工具条点选形状：进入绘制态（再点同形状 = 取消）
   * @param shape 形状名
   */
  const startDrawing = (shape: KlineDrawingShape): void => {
    const chart = chartRef.value;
    if (chart === null || !enabled.value) return;
    if (activeShape.value === shape) {
      activeShape.value = null;
      return;
    }
    activeShape.value = shape;
    void chart.createOverlay({
      name: shape,
      mode: 'normal',
      onDrawEnd: () => {
        activeShape.value = null;
        afterChange();
      },
      onClick: (event) => {
        lastSelectedId.value = event.overlay.id;
      },
    });
  };

  /** 删除最近选中的画线（无选中时 no-op） */
  const removeSelected = (): void => {
    const chart = chartRef.value;
    if (chart === null || lastSelectedId.value === null) return;
    chart.removeOverlay({ id: lastSelectedId.value });
    lastSelectedId.value = null;
    afterChange();
  };

  /** 清空当前票当前周期的全部画线（立即落库） */
  const clearAll = (): void => {
    const chart = chartRef.value;
    if (chart === null) return;
    for (const overlay of chart.getOverlays()) {
      if (SHAPE_NAMES.has(overlay.name)) chart.removeOverlay({ id: overlay.id });
    }
    lastSelectedId.value = null;
    shapeCount.value = 0;
    void saveKlineDrawings(symbol.value, period.value, []);
  };

  /**
   * 恢复持久化画线（切票 / 切周期 / 挂载后调用）
   */
  const restore = async (): Promise<void> => {
    const chart = chartRef.value;
    if (chart === null || !enabled.value) return;
    const records = await loadKlineDrawings(symbol.value, period.value);
    // 异步间隙票又切了：丢弃本次恢复，交给下一次
    if (chartRef.value !== chart) return;
    const existing = new Set(
      chart
        .getOverlays()
        .filter((overlay) => SHAPE_NAMES.has(overlay.name))
        .map((overlay) => overlay.id),
    );
    for (const record of records) {
      if (existing.has(record.id)) continue;
      chart.createOverlay({
        id: record.id,
        name: record.name,
        mode: 'normal',
        lock: !drawingVisible.value ? true : undefined,
        visible: drawingVisible.value,
        points: record.points,
        onClick: (event) => {
          lastSelectedId.value = event.overlay.id;
        },
      });
    }
    shapeCount.value = records.length;
  };

  /**
   * 显隐切换：隐藏 = 移除全部本工具 overlay（数据留在库里）；显示 = 重新恢复
   */
  const toggleVisible = (): void => {
    drawingVisible.value = !drawingVisible.value;
    if (!drawingVisible.value) {
      const chart = chartRef.value;
      if (chart !== null) {
        for (const overlay of chart.getOverlays()) {
          if (SHAPE_NAMES.has(overlay.name)) chart.removeOverlay({ id: overlay.id });
        }
      }
      lastSelectedId.value = null;
    } else {
      void restore();
    }
  };

  // 切票 / 切周期 / 模式开关：重置选中态并恢复该组合的持久化画线
  watch([symbol, period, enabled], () => {
    lastSelectedId.value = null;
    activeShape.value = null;
    if (drawingVisible.value) void restore();
    else void 0;
  });

  // 挂载初期 chart 实例就绪后补一次恢复（watch 先于 chart init 触发的场景）
  watch(chartRef, (chart) => {
    if (chart !== null && drawingVisible.value) void restore();
  });

  return {
    /** 当前待绘制形状（null = 未绘制；工具条高亮用） */
    activeShape: computed(() => activeShape.value),
    /** 画线整体可见 */
    drawingVisible: computed(() => drawingVisible.value),
    /** 当前票当前周期的形状数 */
    shapeCount: computed(() => shapeCount.value),
    /** 是否有可删除的选中项 */
    hasSelection: computed(() => lastSelectedId.value !== null),
    /** 点选形状进入绘制 / 再点取消 */
    startDrawing,
    /** 删除最近选中 */
    removeSelected,
    /** 清空当前票当前周期 */
    clearAll,
    /** 显隐切换 */
    toggleVisible,
  };
};
