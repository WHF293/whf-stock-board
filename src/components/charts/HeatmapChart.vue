<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { CHART_GAP_COLOR, CHART_LABEL_ON_TREND_COLOR } from '../../constants/chart.constants';
import { HEATMAP_DRILL_STOCK_COUNT } from '../../constants/heatmap.constants';
import { fetchIndustryConstituents } from '../../api/board.api';
import { formatPercent } from '../../utils/format-percent';
import { getTrendColorCss } from '../../utils/trend-colors';
import { useSettingsStore } from '../../stores/settings';
import type { HeatmapBoard, HeatmapStockCell } from '../../types/board.types';
import BaseChart from './BaseChart.vue';

/**
 * 板块热力图（treemap 实现）：面积 = 总市值权重，颜色 = 涨跌语义色阶，标签 = 名称 + 涨跌幅；
 * 色阶读 CSS 变量，随涨跌配色主题即时跟随
 *
 * 支持下钻：点击板块 cell 拉取成分股（重接口，用户主动触发），切换到成分股视图；
 * 成分股 cell 点击 emit stock-click 由父组件跳个股详情；顶部提供返回按钮
 */
const props = defineProps<{
  /** 板块热力数据 */
  boards: HeatmapBoard[];
}>();

const emit = defineEmits<{
  /** 点击成分股 cell（code 为 6 位纯代码） */
  stockClick: [code: string];
}>();

const settingsStore = useSettingsStore();

/** 图表容器高度（像素） */
const CHART_HEIGHT_PX = 320;

/** 当前视图层级：board = 板块总览，stock = 某板块成分股 */
const drillView = ref<{ board: HeatmapBoard; stocks: HeatmapStockCell[] } | null>(null);

/** 成分股拉取中 */
const isDrillLoading = ref(false);

/** 成分股拉取失败的板块名（展示重试提示） */
const drillError = ref<string | null>(null);

/** 当前渲染的 treemap 数据（板块层或成分股层） */
const cells = computed(() => {
  if (drillView.value) {
    return drillView.value.stocks.map((stock) => ({
      name: stock.name,
      value: stock.weight,
      changePercent: stock.changePercent,
      code: stock.code,
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
 * treemap 点击处理：板块层下钻拉成分股；成分股层上报跳详情
 * @param params ECharts click 事件参数
 */
const onChartClick = async (params: unknown): Promise<void> => {
  const data = (params as { data?: { code?: string; isStock?: boolean } }).data;
  if (!data?.code) {
    return;
  }
  if (data.isStock) {
    emit('stockClick', data.code);
    return;
  }
  const board = props.boards.find((item) => item.code === data.code);
  if (!board || isDrillLoading.value) {
    return;
  }
  isDrillLoading.value = true;
  drillError.value = null;
  try {
    const constituents = await fetchIndustryConstituents(board.code);
    drillView.value = {
      board,
      stocks: constituents
        .filter((item) => item.changePercent !== null && (item.amount ?? 0) > 0)
        .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
        .slice(0, HEATMAP_DRILL_STOCK_COUNT)
        .map((item) => ({
          code: item.code,
          name: item.name,
          changePercent: item.changePercent ?? 0,
          weight: item.amount ?? 0,
        })),
    };
  } catch (error) {
    console.error('[heatmap-drill]', error);
    drillError.value = board.name;
  } finally {
    isDrillLoading.value = false;
  }
};

/** 返回板块总览 */
const backToBoards = (): void => {
  drillView.value = null;
  drillError.value = null;
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
        @click="backToBoards"
      >
        <MenuIcon name="arrowLeft" :size="14" />
        返回板块
      </button>
      <span class="font-medium text-text">{{ drillView.board.name }}</span>
      <span class="text-xs text-text-tertiary">
        成分股 Top{{ drillView.stocks.length }}（按成交额）
      </span>
    </div>
    <div v-if="isDrillLoading" class="flex items-center justify-center py-24">
      <BaseSkeleton />
    </div>
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
