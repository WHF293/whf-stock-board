import { computed, ref, watch } from 'vue';

/**
 * 表格行懒加载：初始只渲染 chunkSize 行，滚动接近底部时增量放行
 *
 * 适用于百行级表格（板块排行 / 股池 / 龙虎榜等），
 * 与吸顶表头、首列吸左样式完全兼容；数据源变化时自动重置
 * @param source 完整数据源 getter（响应式）
 * @param chunkSize 每批放行行数
 * @returns rows 当前应渲染行；hasMore 是否还有未渲染行；onScroll 容器滚动处理
 */
export const useLazyRows = <T>(source: () => readonly T[], chunkSize: number) => {
  /** 当前放行行数 */
  const renderedCount = ref(chunkSize);

  /** 总行数 */
  const total = computed(() => source().length);

  /** 当前渲染的行切片 */
  const rows = computed(() => source().slice(0, renderedCount.value));

  /** 是否还有未渲染的行 */
  const hasMore = computed(() => renderedCount.value < total.value);

  // 数据源变化（切 tab / 重新筛选）时重置放行进度
  watch(source, () => {
    renderedCount.value = chunkSize;
  });

  /** 增量放行一批 */
  const loadMore = (): void => {
    if (hasMore.value) {
      renderedCount.value = Math.min(renderedCount.value + chunkSize, total.value);
    }
  };

  /**
   * 容器滚动处理：距底部不足 100px 时增量放行
   * @param event 滚动事件
   */
  const onScroll = (event: Event): void => {
    const el = event.target as HTMLElement;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      loadMore();
    }
  };

  return { rows, total, hasMore, onScroll };
};
