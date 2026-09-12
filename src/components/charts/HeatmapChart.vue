<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { CHART_GAP_COLOR, CHART_LABEL_ON_TREND_COLOR } from '../../constants/chart.constants';
import { HEATMAP_VIEW_HEIGHT_PX } from '../../constants/heatmap.constants';
import { formatPercent } from '../../utils/format-percent';
import { getTrendColorCss } from '../../utils/trend-colors';
import { useSettingsStore } from '../../stores/settings';
import type { HeatmapBoard } from '../../types/board.types';
import type { HeatmapDrillView } from '../../types/heatmap.types';
import BaseChart from './BaseChart.vue';

/**
 * 板块热力图（treemap 实现）：面积 = 总市值权重，颜色 = 涨跌语义色阶，标签 = 名称 + 涨跌幅；
 * 色阶读 CSS 变量，随涨跌配色主题即时跟随
 *
 * 下钻状态由父级 useHeatmapDrill 统一管理（与列表视图共享）；
 * 点击链路两层防御，修复切层后点击错位（点个股误触发下钻"切换 Top"）：
 * 1. 关闭动画：杜绝过渡期被移除的旧 cell 延迟销毁但仍可点击
 * 2. 层级成员校验：仅接受当前层数据列表内的点击，错位数据直接忽略
 */
const props = defineProps<{
  /** 板块热力数据 */
  boards: HeatmapBoard[];
  /** 下钻视图状态（null 表示板块总览层），由父级 useHeatmapDrill 提供 */
  drillView: HeatmapDrillView | null;
  /** 成分股拉取中 */
  isDrillLoading: boolean;
  /** 成分股拉取失败的板块名 */
  drillError: string | null;
}>();

const emit = defineEmits<{
  /** 点击成分股 cell（code 为 6 位纯代码） */
  stockClick: [code: string];
  /** 点击板块 cell（请求父级下钻） */
  boardClick: [board: HeatmapBoard];
  /** 点击返回板块 */
  back: [];
}>();

const settingsStore = useSettingsStore();

/** 图表容器高度（像素，与列表视图共用同一常量） */
const CHART_HEIGHT_PX = HEATMAP_VIEW_HEIGHT_PX;

/** 当前渲染的 treemap 数据（板块层或成分股层） */
const cells = computed(() => {
  if (props.drillView) {
    return props.drillView.constituents.map((item) => ({
      name: item.name,
      value: item.amount ?? 0,
      changePercent: item.changePercent ?? 0,
      code: item.code,
      isStock: true,
    }));
  }
  return props.boards.map((board) => ({
    name: board.name,
    value: board.weight,
    changePercent: board.changePercent,
    code: board.code,
    isStock: false,
  }));
});

/**
 * treemap 点击处理：按当前层级做成员校验后分发
 *
 * 成分股层仅接受当前下钻列表内的个股（防切层残留图元把个股点击误解析成板块），
 * 板块层仅接受当前板块列表内的板块（防轮询刷新后点击到已不存在的板块）
 * @param params ECharts click 事件参数
 */
const onChartClick = (params: unknown): void => {
  const data = (params as { data?: { code?: string; isStock?: boolean } }).data;
  if (!data?.code) {
    return;
  }
  if (props.drillView) {
    const isCurrentStock =
      data.isStock === true &&
      props.drillView.constituents.some((item) => item.code === data.code);
    if (isCurrentStock) {
      emit('stockClick', data.code);
    }
    return;
  }
  if (data.isStock !== false) {
    return;
  }
  const board = props.boards.find((item) => item.code === data.code);
  if (board) {
    emit('boardClick', board);
  }
};

const option = computed<EChartsCoreOption>(() => {
  // 依赖 trendTheme：切换涨跌配色后本 computed 重新求值
  void settingsStore.trendTheme;
  return {
    tooltip: {
      formatter: (params: unknown) => {
        const data = (params as { data: { name: string; changePercent: number } }).data;
        return `${data.name}　${formatPercent(data.changePercent)}`;
      },
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        // 关闭动画：避免切层/刷新过渡期旧 cell 延迟销毁但仍可点击导致的点击错位
        animation: false,
        breadcrumb: { show: false },
        itemStyle: { borderColor: CHART_GAP_COLOR, borderWidth: 2, gapWidth: 2 },
        label: {
          show: true,
          color: CHART_LABEL_ON_TREND_COLOR,
          formatter: (params: unknown) => {
            const data = (params as { data: { name: string; changePercent: number } }).data;
            return `${data.name}\n${formatPercent(data.changePercent)}`;
          },
        },
        data: cells.value.map((cell) => ({
          ...cell,
          itemStyle: { color: getTrendColorCss(cell.changePercent) },
        })),
      },
    ],
  };
});
</script>

<template>
  <div>
    <!-- 下钻状态条：返回 + 当前板块名 -->
    <div
      v-if="drillView"
      class="mb-2 flex items-center gap-2 text-sm"
    >
      <button
        type="button"
        class="pressable flex items-center gap-1 rounded-lg px-2 py-1 text-text-secondary hover:bg-flat-weak hover:text-text active:scale-90"
        @click="emit('back')"
      >
        <MenuIcon name="arrowLeft" :size="14" />
        返回板块
      </button>
      <span class="font-medium text-text">{{ drillView.board.name }}</span>
      <span class="text-xs text-text-tertiary">
        成分股 Top{{ drillView.constituents.length }}（按成交额）
      </span>
    </div>
    <div v-if="isDrillLoading" class="flex items-center justify-center py-24">
      <BaseSkeleton />
    </div>
    <!-- 增量合并 + 关动画：动画关闭后无残留可点击元素，校验兜底错位数据 -->
    <BaseChart
      v-else
      :options="option"
      :style="{ height: `${CHART_HEIGHT_PX}px` }"
      @chart-click="onChartClick"
    />
    <p v-if="drillError" class="mt-2 text-xs text-down">
      {{ drillError }} 成分股加载失败，请稍后重试
    </p>
  </div>
</template>
