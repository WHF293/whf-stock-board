<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import BaseChart from '../charts/BaseChart.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import { fetchThsIndexFlash } from '../../../common/api/ths-index-flash.api.ts';
import { THS_POLLING_INTERVAL, getThsRatingAdvice } from '../../../common/constants/ths-market.constants.ts';
import { CHART_LINE_RED, CHART_TEXT_COLOR } from '../../../common/constants/chart.constants.ts';
import { usePolling } from '../../../common/composables/use-polling';
import { getRatingHistory, recordRatingToday, type RatingHistoryEntry } from '../../../common/utils/rating-history';

/**
 * 大盘评级卡（市场总览新增，数据源同花顺 q 域 indexflash 的 dppj_data）
 *
 * - 环形仪表 0-10 分（得分弧用涨跌语义色：评分本质是「红强绿弱」情绪表达）
 * - 投资建议：同花顺前端写死的五档文案映射（constants 单源）
 * - 近 5 日评分折线（2026-11-02 王总指定由柱状图改折线图）：接口只有当日值，
 *   本地按日落 appStorage 积累（rating-history）；今日点红色放大、其余灰点
 * - 60s 前台轮询（tradingAware）；失败保留旧值，首载失败显示空态
 */
const score = ref<number | null>(null);
/** 首载是否失败（供空态展示） */
const error = ref(false);

/** 近 5 日评分历史（升序；挂载时读一次存量，之后每次拉到评分由写入方回填，保证响应式） */
const history = ref<RatingHistoryEntry[]>(getRatingHistory());

/** 拉取评分：成功后写当日历史（同日覆盖），并回填本地序列驱动折线刷新 */
const load = async (): Promise<void> => {
  try {
    const data = await fetchThsIndexFlash();
    if (data.dppj === null) {
      throw new Error('dppj_data 缺失');
    }
    score.value = data.dppj;
    history.value = recordRatingToday(data.dppj);
    error.value = false;
  } catch (err) {
    // 首载失败才置错误态；轮询间隙抖动保留旧分数
    if (score.value === null) {
      error.value = true;
      console.error('[market-rating] 拉取失败', err);
    }
  }
};

usePolling({ task: load, intervalMs: THS_POLLING_INTERVAL.RATING, tradingAware: true });
onMounted(() => {
  void load();
});

/** 投资建议文案 */
const adviceText = computed(() => getThsRatingAdvice(score.value));

/* === 环形仪表几何 === */
const DONUT_R = 34;
const DONUT_C = 2 * Math.PI * DONUT_R;
/** 得分弧长度（0-10 → 0-整圆） */
const dashLen = computed(() => ((score.value ?? 0) / 10) * DONUT_C);

/** 近 5 日评分折线（0-10 分；今日点红色放大，其余灰点；y 轴固定 0-10 防视觉夸大波动。
 *  2026-11-02 王总指定补充 y 轴刻度（0/5/10，9px 弱色，不画网格线） */
const ratingChartOption = computed<EChartsCoreOption>(() => {
  const list = history.value;
  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      // confine：tooltip 收在图表容器内，不允许飘出卡片（2026-11-02 王总反馈）
      confine: true,
      formatter: (params: unknown) => {
        const point = (params as { axisValue: string; value: number; marker: string }[])[0];
        if (!point) return '';
        return `${point.axisValue}　${point.marker}评分 ${point.value.toFixed(1)}`;
      },
    },
    grid: { left: 26, right: 6, top: 8, bottom: 2 },
    xAxis: {
      type: 'category',
      data: list.map((entry) => entry.date.slice(5)),
      show: false,
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 10,
      interval: 5,
      show: true,
      axisLabel: { fontSize: 9, color: CHART_TEXT_COLOR },
      splitLine: { show: false },
    },
    series: [
      {
        type: 'line',
        data: list.map((entry, index) => ({
          value: entry.score,
          symbolSize: index === list.length - 1 ? 7 : 4,
          itemStyle: {
            color: index === list.length - 1 ? CHART_LINE_RED : CHART_TEXT_COLOR,
          },
        })),
        lineStyle: { width: 1.5, color: CHART_TEXT_COLOR },
        showSymbol: true,
      },
    ],
  };
});
</script>

<template>
  <div v-if="score !== null" class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-4">
      <!-- 环形仪表 -->
      <svg width="92" height="92" viewBox="0 0 92 92" role="img" aria-label="大盘评分">
        <circle cx="46" cy="46" :r="DONUT_R" fill="none" stroke="var(--color-flat-weak)" stroke-width="8" />
        <circle
          cx="46"
          cy="46"
          :r="DONUT_R"
          fill="none"
          stroke="var(--color-up)"
          stroke-width="8"
          stroke-linecap="round"
          :stroke-dasharray="`${dashLen} ${DONUT_C}`"
          transform="rotate(-90 46 46)"
          class="rating-arc"
        />
        <text
          x="46"
          y="44"
          text-anchor="middle"
          class="fill-[var(--color-text)] text-[20px] font-semibold"
          style="font-variant-numeric: tabular-nums"
        >
          {{ score.toFixed(1) }}
        </text>
        <text x="46" y="60" text-anchor="middle" class="fill-[var(--color-text-tertiary)] text-[10px]">大盘评分</text>
      </svg>
      <!-- 投资建议 -->
      <div class="min-w-0 flex-1">
        <p class="text-xs text-text-tertiary">投资建议</p>
        <p class="mt-1 text-sm font-medium leading-relaxed text-text">{{ adviceText ?? '--' }}</p>
      </div>
    </div>

    <!-- 近 5 日评分折线（2026-11-02 王总指定：柱状图改折线图；今日点标红放大，
         其余灰点；y 轴固定 0-10，防止评分 8±1 的正常波动被 scale 拉成悬崖） -->
    <div v-if="history.length > 0" class="mt-auto shrink-0 pt-4">
      <BaseChart :options="ratingChartOption" :style="{ height: '88px' }" />
      <div class="mt-1.5 flex justify-between text-[10px] text-text-tertiary">
        <span>{{ history[0]?.date.slice(5) }} 起</span>
        <span>近 {{ history.length }} 日评分</span>
      </div>
    </div>
  </div>
  <!-- 非交易日 / 首载失败：空态（评分下一交易日生成） -->
  <div v-else-if="error" class="flex h-full min-h-[120px] items-center justify-center text-sm text-text-tertiary">
    评分暂未生成，下一交易日 09:30 更新
  </div>
  <BaseSkeleton v-else class="min-h-[120px]" />
</template>

<style scoped>
/* 得分弧过渡：60s 轮询刷新时平滑走针，prefers-reduced-motion 由全局降级 */
.rating-arc {
  transition: stroke-dasharray 0.6s ease;
}
</style>
