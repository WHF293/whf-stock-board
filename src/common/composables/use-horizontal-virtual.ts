import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';

/**
 * 横向虚拟列表
 *
 * 项目原本只有「纵向懒加载行」（use-lazy-rows），横向无既有实现，故自研：
 * 列宽固定、行数少（31 行）→ 只需切片列，不需要纵向虚拟化。
 * 节点量 = 行数 ×（可视列数 + 2 × overscan），「全部」档（累积数年、上千列）也能流畅滚动。
 */

/** 横向虚拟化选项 */
export interface HorizontalVirtualOptions {
  /** 列宽（像素，固定） */
  columnWidth: number;
  /** 列数取值函数（响应式） */
  columnCount: () => number;
  /** 滚动容器 ref（提供后自动用 ResizeObserver 维护可视宽度） */
  scrollRef?: Ref<HTMLElement | null>;
  /** 视窗左右各多渲染的列数（默认 4，避免快速滚动出现白边） */
  overscan?: number;
}

/** 横向虚拟化返回值 */
export interface HorizontalVirtualReturn {
  /** 可视区起始列下标（含 overscan） */
  startIndex: ComputedRef<number>;
  /** 可视区结束列下标（含 overscan） */
  endIndex: ComputedRef<number>;
  /** 需要渲染的列下标数组 */
  visibleIndexes: ComputedRef<number[]>;
  /** 前置占位宽度（像素），用于撑出滚动条与保持列对齐 */
  offsetX: ComputedRef<number>;
  /** 尾部占位宽度（像素） */
  tailWidth: ComputedRef<number>;
  /** 全部列的总宽度（像素） */
  totalWidth: ComputedRef<number>;
  /** 滚动事件处理（绑定到滚动容器） */
  onScroll: (event: Event) => void;
}

/**
 * 创建横向虚拟化状态
 * @param options 列宽 / 列数 / 容器 ref / overscan
 * @returns 切片下标与占位宽度
 */
export const useHorizontalVirtual = (
  options: HorizontalVirtualOptions,
): HorizontalVirtualReturn => {
  const { columnWidth, overscan = 4 } = options;

  /** 容器已滚动的水平距离（像素） */
  const scrollLeft = ref(0);
  /** 容器可视宽度（像素） */
  const viewportWidth = ref(0);

  const startIndex = computed(() =>
    Math.max(0, Math.floor(scrollLeft.value / columnWidth) - overscan),
  );

  const endIndex = computed(() => {
    const last = Math.max(0, options.columnCount() - 1);
    const visibleEnd = Math.ceil((scrollLeft.value + viewportWidth.value) / columnWidth) + overscan;
    return Math.min(last, Math.max(startIndex.value, visibleEnd));
  });

  const visibleIndexes = computed(() => {
    const result: number[] = [];
    for (let index = startIndex.value; index <= endIndex.value; index += 1) {
      result.push(index);
    }
    return result;
  });

  const offsetX = computed(() => startIndex.value * columnWidth);

  const totalWidth = computed(() => Math.max(0, options.columnCount()) * columnWidth);

  const tailWidth = computed(() =>
    Math.max(0, totalWidth.value - offsetX.value - visibleIndexes.value.length * columnWidth),
  );

  /**
   * 滚动事件：只记录水平偏移，切片由 computed 派生
   * @param event 原生滚动事件
   */
  const onScroll = (event: Event): void => {
    scrollLeft.value = (event.target as HTMLElement).scrollLeft;
  };

  /** ResizeObserver 句柄（容器尺寸变化时重算可视列数） */
  let observer: ResizeObserver | null = null;

  // 容器是 v-if / v-show 控制的，用 watch + flush: 'post' 保证元素出现后再挂观察器
  watch(
    () => options.scrollRef?.value ?? null,
    (element) => {
      observer?.disconnect();
      observer = null;
      if (!element) return;
      viewportWidth.value = element.clientWidth;
      observer = new ResizeObserver(() => {
        viewportWidth.value = element.clientWidth;
      });
      observer.observe(element);
    },
    { immediate: true, flush: 'post' },
  );

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });

  return {
    startIndex,
    endIndex,
    visibleIndexes,
    offsetX,
    tailWidth,
    totalWidth,
    onScroll,
  };
};
