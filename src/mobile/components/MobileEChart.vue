<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useDark } from '@vueuse/core';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { init } from 'echarts/core';
import { STORAGE_NS_COLOR_SCHEME } from '../../common/constants/storage-key.constants.ts';
import { appStorage } from '../../common/utils/app-local-storage';
import './echarts-setup';

/**
 * 移动端 ECharts 实例封装（对齐 PC BaseChart 的生命周期管理，独立实现不动 PC）：
 * init / setOption / ResizeObserver / dispose 统一管理；SVG 渲染器；
 * 暗色切换时 ECharts 不支持热切主题，重建实例；卸载 dispose 防泄漏
 */
const props = defineProps<{
  /** ECharts 配置项（echarts/core 的精简类型） */
  options: EChartsCoreOption;
  /** 是否全量替换更新（setOption notMerge）：series 条数可变的图表传 true */
  notMerge?: boolean;
}>();

const containerRef = ref<HTMLDivElement | null>(null);

/** ECharts 实例（挂载后创建，卸载前销毁） */
let chart: EChartsType | null = null;

/** 感知暗色模式（与 useTheme 写同一 storage key，状态一致） */
const isDark = useDark({ storageKey: STORAGE_NS_COLOR_SCHEME, storage: appStorage });

/** 容器尺寸变化时自适应 */
const resizeObserver = new ResizeObserver(() => {
  chart?.resize();
});

/** 用当前 options 渲染（默认增量合并，notMerge 时全量替换） */
const render = (): void => {
  chart?.setOption(props.options, { notMerge: props.notMerge ?? false });
};

/** 创建实例并渲染（暗色切换时重建） */
const initChart = (): void => {
  if (!containerRef.value) {
    return;
  }
  chart?.dispose();
  chart = init(containerRef.value, undefined, { renderer: 'svg' });
  render();
};

watch(
  () => props.options,
  () => render(),
  { deep: true },
);

// 主题切换重建实例
watch(isDark, () => initChart());

onMounted(() => {
  initChart();
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver.disconnect();
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div ref="containerRef" class="h-full w-full" />
</template>
