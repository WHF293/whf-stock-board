import {
  computed,
  onBeforeUnmount,
  ref,
  type ComponentPublicInstance,
  type CSSProperties,
} from 'vue';

/** 判定「同一行」的纵向容差（px）：亚像素抖动不当作换行 */
const ROW_TOLERANCE_PX = 4;

/**
 * 栅格「首行裁剪」：收起态只露第一行，展开态露全部，两者之间做高度过渡动画
 *
 * 设计要点：
 * - 收起**不卸载**卡片（DOM 始终完整），只把容器高度固定为「首行高度」并裁切溢出，
 *   于是「一行放几张」完全交给 CSS 栅格：容器变窄 → 首行只剩 2~3 张 → 多出来的卡
 *   自动被裁掉（联动地，窗口拉宽首行能放更多，甚至全部），无需任何 JS 断点。
 * - 高度取实测值（首行高 ⇄ 栅格总高），因此必须挂 ResizeObserver：窗口缩放、
 *   侧栏折叠、右侧停靠面板开合（主区是 @container）都会改变这两个值。
 * @returns setGridRef 须绑在栅格元素上（`:ref="setGridRef"`，其父元素为裁剪容器）；isExpanded 展开态；hasOverflow 首行之外是否还有卡片；clampStyle 裁剪容器内联样式；toggle 切换展开/收起
 */
export const useRowClamp = () => {
  /** 被测量的栅格元素（裁剪容器的直接子元素） */
  const gridRef = ref<HTMLElement | null>(null);

  /** 首行高度（收起态容器高度） */
  const rowHeight = ref(0);

  /** 栅格总高度（展开态容器高度） */
  const fullHeight = ref(0);

  /** 展开态（局部状态，不持久化） */
  const isExpanded = ref(false);

  /** 首行之外是否真的还有卡片（没有则不必裁剪，也不显示展开开关） */
  const hasOverflow = computed<boolean>(() => fullHeight.value - rowHeight.value > 1);

  /** 容器高度：收起露首行 / 展开露全部 */
  const visibleHeight = computed<number>(() =>
    isExpanded.value ? fullHeight.value : rowHeight.value,
  );

  /** 裁剪容器内联高度；首帧尚未实测时不写死高度，避免从 0 高跳一下 */
  const clampStyle = computed<CSSProperties>(() =>
    rowHeight.value > 0 ? { height: `${visibleHeight.value}px` } : {},
  );

  /** 实测首行高度与栅格总高（子元素按 top 分组，第一组即首行） */
  const measure = (): void => {
    const grid = gridRef.value;
    if (!grid) {
      return;
    }
    const gridRect = grid.getBoundingClientRect();
    // 元素被隐藏时（KeepAlive 缓存页 / 抽屉关闭）尺寸恒为 0，保留上次实测值，
    // 否则会先写成「不裁剪」再在恢复显示时跳一下
    if (gridRect.width === 0) {
      return;
    }
    const children = Array.from(grid.children);
    if (children.length === 0) {
      rowHeight.value = 0;
      fullHeight.value = 0;
      return;
    }
    const rects = children.map((child) => child.getBoundingClientRect());
    const firstTop = Math.min(...rects.map((rect) => rect.top));
    const firstRowBottom = Math.max(
      ...rects
        .filter((rect) => rect.top - firstTop < ROW_TOLERANCE_PX)
        .map((rect) => rect.bottom),
    );
    rowHeight.value = Math.round(firstRowBottom - firstTop);
    fullHeight.value = Math.round(gridRect.height);
  };

  /** 切换展开 / 收起 */
  const toggle = (): void => {
    isExpanded.value = !isExpanded.value;
  };

  let observer: ResizeObserver | null = null;

  /**
   * 函数式模板 ref：栅格一挂载就实测并开始观察，卸载即断开
   *
   * 用函数 ref（`:ref="setGridRef"`）而不是字符串 ref：字符串 ref 只是运行时约定，
   * 静态检查会认为这个变量从未被读取。
   * @param el 模板元素（卸载时为 null）
   */
  const setGridRef = (el: Element | ComponentPublicInstance | null): void => {
    const next = el instanceof HTMLElement ? el : null;
    if (next === gridRef.value) {
      return;
    }
    observer?.disconnect();
    observer = null;
    gridRef.value = next;
    if (!next) {
      return;
    }
    // ref 回调发生在元素插入 DOM 之后、浏览器绘制之前 → 首帧就是裁好的样子
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      // 只观察栅格本身：观察父容器会被自己写入的高度反过来触发回调
      observer = new ResizeObserver(measure);
      observer.observe(next);
    }
  };

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });

  return { setGridRef, isExpanded, hasOverflow, clampStyle, toggle };
};
