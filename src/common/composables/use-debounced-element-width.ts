import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

/**
 * 实测容器宽度（ResizeObserver + trailing 防抖）
 *
 * 背景（2026-10-30 板块分析改造，王总指定）：赚钱效应气泡图迁入可拖宽侧边栏后，
 * 布局须跟随侧边栏宽度重排；拖拽会连续触发 ResizeObserver 回调，逐帧重排
 * 浪费且抖动，故对实测宽度做 trailing 防抖合并（拖拽全程至多触发一次布局重算，
 * 过渡期旧布局经 SVG preserveAspectRatio 等比缩放，视觉连续）。
 *
 * @param options 防抖选项
 * @param options.debounceMs trailing 防抖毫秒
 * @returns target（绑到模板函数 ref 的容器元素）/ width（实测宽 ref，未测得为 0）
 * @example
 * const { target, width } = useDebouncedElementWidth({ debounceMs: 160 });
 * // <div :ref="target">…</div>，布局 computed 依赖 width
 */
export function useDebouncedElementWidth(options: { debounceMs: number }): {
  target: (el: unknown) => void;
  width: Ref<number>;
} {
  const { debounceMs } = options;
  const elRef = ref<HTMLElement | null>(null);
  const width = ref(0);

  let observer: ResizeObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** 防抖落点：读一次实测宽写入 ref（仅在宽度真的变化时触发下游重算） */
  const measure = (): void => {
    const el = elRef.value;
    if (!el) return;
    const next = el.clientWidth;
    if (next > 0 && next !== width.value) {
      width.value = next;
    }
  };

  const onResize = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(measure, debounceMs);
  };

  watch(elRef, (el, prev) => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (prev === el) return;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(onResize);
      observer.observe(el);
      measure();
    }
  });

  onBeforeUnmount(() => {
    if (timer !== undefined) clearTimeout(timer);
    observer?.disconnect();
  });

  /**
   * 模板函数 ref（`:ref="target"`）：登记 / 注销容器元素
   * @param el 模板节点
   */
  const target = (el: unknown): void => {
    elRef.value = el instanceof Element ? (el as HTMLElement) : null;
  };

  return { target, width };
}
