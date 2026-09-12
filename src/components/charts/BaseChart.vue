<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useDark } from '@vueuse/core';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { init } from 'echarts/core';
import { STORAGE_NS_COLOR_SCHEME } from '../../constants/storage-key.constants';
import { appStorage } from '../../utils/app-local-storage';
import './echarts-setup';

/**
 * ECharts 实例封装：init / setOption（增量合并）/ ResizeObserver / dispose 统一管理
 *
 * - options 变化走 setOption 深度合并（notMerge: false），不整图重建
 * - 暗色切换时 ECharts 不支持热切主题，重建实例
 * - 组件卸载 dispose 防内存泄漏
 */
const props = defineProps<{
  /** ECharts 配置项（echarts/core 的精简类型） */
  options: EChartsCoreOption;
}>();

const emit = defineEmits<{
  /** ECharts 原生 click 事件透传（params 含 seriesName / data 等） */
  chartClick: [params: unknown];
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

/** 用当前 options 渲染（增量合并） */
const render = (): void => {
  chart?.setOption(props.options, { notMerge: false });
};

/** 创建实例并渲染（暗色切换时重建） */
const initChart = (): void => {
  if (!containerRef.value) {
    return;
  }
  chart?.dispose();
  chart = init(containerRef.value, undefined, { renderer: 'svg' });
  chart.on('click', (params) => emit('chartClick', params));
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
