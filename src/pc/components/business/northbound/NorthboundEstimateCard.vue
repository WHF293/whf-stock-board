<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../../common/constants/chart.constants.ts';
import {
  NORTHBOUND_ESTIMATE_ERROR_NOTICE,
  NORTHBOUND_ESTIMATE_NOTICE,
  NORTHBOUND_ESTIMATE_TIP,
} from '../../../../common/constants/mutual-sidebar.constants.ts';
import { DATA_CACHE_KEY } from '../../../../common/constants/data-cache.constants.ts';
import { fetchNorthboundEstimate } from '../../../../common/api/hkex-ccass.api.ts';
import { formatNorthboundAmount } from '../../../../common/utils/format-northbound-amount.ts';
import { readTrendColors } from '../../../../common/utils/trend-colors';
import { useSettingsStore } from '../../../../common/stores/settings';
import { useDataCacheStore } from '../../../../common/stores/data-cache';
import MenuIcon from '../../ui/MenuIcon.vue';
import NoticeBar from '../../ui/NoticeBar.vue';
import BaseCard from '../../ui/BaseCard.vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import BaseChart from '../../charts/BaseChart.vue';
import type { NorthboundEstimateState } from '../../../../common/types/northbound.types.ts';

/**
 * 北向资金流向估算卡（港交所 CCASS 持股差分 × 现价，南北向资金侧边栏）
 *
 * 北向每日净买额自 2024-08-19 停止披露且无公开替代来源（2026-10-30 二次实测）。
 * 2026-11-06 三次实测找到唯一存活的全市场日度来源：港交所披露易 CCASS 沪深股通
 * 持股纪录（东财停采后仍在逐日披露、保留 12 个月）——估算 = 基线季末快照与最新
 * 纪录日的持股数差分 × 现价，即「当前季度进行中净流入」，可每日刷新；
 * 季度滚过时该期差分自动落定为季度点并在本地逐季累积成流向柱图。
 * 数据层（抓取 / 解析 / 快照缓存 / 季度落定）见 hkex-ccass.api.ts；
 * 取数结果经 dataCache 会话缓存：侧边栏反复开合秒出，右上「刷新」强制重拉
 */

/** 图表高度（像素） */
const CHART_HEIGHT_PX = 140;

const settings = useSettingsStore();
const dataCache = useDataCacheStore();

/** 估算拉取结果（当前季度 + 已落定季度序列） */
const state = ref<NorthboundEstimateState | null>(null);

/** 是否加载中 */
const isLoading = ref(false);

/** 是否取数失败（且无缓存兜底） */
const isError = ref(false);

/** 拉取估算（缓存播种秒出，失败置错误态）
 * @param force true = 跳过缓存强制重拉（刷新按钮）
 */
const loadEstimate = async (force = false): Promise<void> => {
  if (!force) {
    const cached = dataCache.get<NorthboundEstimateState>(DATA_CACHE_KEY.NORTHBOUND_ESTIMATE);
    if (cached) {
      state.value = cached;
      return;
    }
  }
  isLoading.value = true;
  try {
    const data = await fetchNorthboundEstimate();
    state.value = data;
    isError.value = false;
    dataCache.set(DATA_CACHE_KEY.NORTHBOUND_ESTIMATE, data);
  } catch (error) {
    console.error('[northbound] CCASS 北向估算取数失败', error);
    isError.value = state.value === null;
  } finally {
    isLoading.value = false;
  }
};

/** 刷新（强制重拉最新 CCASS 纪录） */
const refresh = (): void => {
  void loadEstimate(true);
};

onMounted(() => {
  void loadEstimate();
});

/** 当前季度进行中净流入（元） */
const quarterNetInflow = computed(() => state.value?.quarterNetInflow ?? 0);

/** 涨跌配色（正红负绿；注册 trendTheme 依赖使切主题时重算，颜色本身从 CSS 变量现读） */
const barColors = computed(() => {
  void settings.trendTheme;
  return readTrendColors();
});

/** 当前季度进行中净流入主数字（含符号与单位） */
const quarterNetText = computed(() => formatNorthboundAmount({ value: quarterNetInflow.value, source: 'yuan' }));

/** 主数字颜色类（正 = 涨色 / 负 = 跌色） */
const quarterNetClass = computed(() => (quarterNetInflow.value >= 0 ? barColors.value.up : barColors.value.down));

/** 进行中区间的季度标签（如 2026Q4） */
const quarterLabel = computed(() => {
  const date = state.value?.baselineDate;
  if (!date) return '';
  return `${date.slice(0, 4)}Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
});

/** 进行中区间说明（基线 → 最新） */
const periodText = computed(() => {
  if (!state.value) return '';
  return `${state.value.baselineDate} → ${state.value.latestDate}（CCASS 最新纪录）`;
});

/** 覆盖信息元行（差分只数 / 快照覆盖） */
const coverageText = computed(() => {
  if (!state.value) return '';
  return `参与差分 ${state.value.stockCount} 只 · 最新快照覆盖 ${state.value.snapshotCount} 只`;
});

/** 已落定季度估算序列（旧 → 新） */
const committedRows = computed(() => state.value?.estimates ?? []);

/** 图表 option（已落定季度净流入估算柱，正红负绿；序列本身旧 → 新） */
const option = computed<EChartsCoreOption>(() => {
  const list = committedRows.value;
  return {
    animation: false,
    grid: { left: 8, right: 8, top: 10, bottom: 0, containLabel: true },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const item = (params as { axisValue: string; value: number | null }[])[0];
        const row = list.find(
          (entry) => `${entry.date.slice(2, 4)}Q${Math.ceil(Number(entry.date.slice(5, 7)) / 3)}` === item?.axisValue,
        );
        if (!row) return item?.axisValue ?? '';
        return [
          `${row.prevDate} ~ ${row.date}`,
          `估算净流入：${formatNorthboundAmount({ value: row.estimatedNetInflow, source: 'yuan' })}`,
          `差分 ${row.stockCount} 只${row.approxPriced ? ' · 收盘价为落定时现价近似' : ''}`,
        ].join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: list.map((row) => `${row.date.slice(2, 4)}Q${Math.ceil(Number(row.date.slice(5, 7)) / 3)}`),
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: {
        color: CHART_TEXT_COLOR,
        fontSize: 10,
        formatter: (value: number) =>
          formatNorthboundAmount({ value, source: 'yuan' }).replace(' ', ''),
      },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: [
      {
        name: '季度估算净流入',
        type: 'bar',
        data: list.map((row) => ({
          value: row.estimatedNetInflow,
          itemStyle: {
            color: row.estimatedNetInflow >= 0 ? barColors.value.up : barColors.value.down,
          },
        })),
        barMaxWidth: 28,
      },
    ],
  };
});

</script>

<template>
  <BaseCard title="北向资金流向估算（季度）" :tip="NORTHBOUND_ESTIMATE_TIP">
    <template #extra>
      <button
        type="button"
        class="pressable flex items-center rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:bg-flat-weak hover:text-primary"
        :disabled="isLoading"
        @click="refresh"
      >
        <MenuIcon name="refresh" :size="13" class="mr-0.5" :class="{ 'animate-spin': isLoading }" />
        刷新
      </button>
    </template>

    <NoticeBar :text="NORTHBOUND_ESTIMATE_NOTICE" tone="warn" class="mb-2 shrink-0" />
    <BaseSkeleton v-if="isLoading && !state" class="h-[280px]" />
    <BaseEmpty v-else-if="isError && !state" :text="NORTHBOUND_ESTIMATE_ERROR_NOTICE" />
    <template v-else>
      <!-- 当前季度进行中估算：主数字 -->
      <div class="flex flex-col items-center py-1">
        <p class="text-xs text-text-tertiary">
          {{ quarterLabel }} 进行中估算净流入（{{ periodText }}）
        </p>
        <p class="mt-1 text-2xl font-semibold tabular-nums" :class="quarterNetClass">
          {{ quarterNetText }}
        </p>
        <p class="mt-0.5 text-[10px] text-text-tertiary">{{ coverageText }}</p>
      </div>

      <!-- 增减持 Top 榜 -->
      <div class="mt-2 grid grid-cols-2 gap-2">
        <div class="rounded bg-flat-weak/40 p-2">
          <p class="mb-1 text-[10px] font-medium text-up">本季增持 Top5</p>
          <div
            v-for="mover in state?.topBuys ?? []"
            :key="mover.code"
            class="flex items-center justify-between py-0.5 text-[11px]"
          >
            <span class="truncate text-text">{{ mover.name }}</span>
            <span class="num font-medium text-up">
              {{ mover.amount !== null ? formatNorthboundAmount({ value: mover.amount, source: 'yuan' }) : '--' }}
            </span>
          </div>
        </div>
        <div class="rounded bg-flat-weak/40 p-2">
          <p class="mb-1 text-[10px] font-medium text-down">本季减持 Top5</p>
          <div
            v-for="mover in state?.topSells ?? []"
            :key="mover.code"
            class="flex items-center justify-between py-0.5 text-[11px]"
          >
            <span class="truncate text-text">{{ mover.name }}</span>
            <span class="num font-medium text-down">
              {{ mover.amount !== null ? formatNorthboundAmount({ value: mover.amount, source: 'yuan' }) : '--' }}
            </span>
          </div>
        </div>
      </div>

      <!-- 已落定季度序列（逐季累积；空序列隐藏） -->
      <template v-if="committedRows.length > 0">
        <p class="mt-3 text-[10px] text-text-tertiary">季度估算序列（随季末滚动落定，本地逐季累积）</p>
        <BaseChart :options="option" :style="{ height: `${CHART_HEIGHT_PX}px` }" class="mt-1" />
      </template>
    </template>
  </BaseCard>
</template>
