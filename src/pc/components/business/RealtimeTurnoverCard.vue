<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import { fetchThsTurnoverDay, fetchThsTurnoverMinute } from '../../../common/api/ths-market-analysis.api.ts';
import { THS_POLLING_INTERVAL } from '../../../common/constants/ths-market.constants.ts';
import { formatAmount } from '../../../common/utils/format-amount';
import { formatYuanWithSign } from '../../../common/utils/format-yuan';
import { computeTurnoverAverage5 } from '../../../common/utils/compute-turnover-averages';
import { usePolling } from '../../../common/composables/use-polling';
import { CHART_LINE_BLUE } from '../../../common/constants/chart.constants.ts';
import type { ThsTurnoverDay, ThsTurnoverMinute } from '../../../common/types/ths-market.types.ts';

/**
 * 实时成交额卡（市场总览新增，数据源同花顺 dq 域 get_chart_data）
 *
 * - 今日实时 / 较上一日（同时刻环比，后端直出）/ 预测全天 / 5日均 / 60日均 / 较5日均
 * - 「当日 vs 昨日同时刻」分时双线（SVG，0-100 归一视窗）
 * - 30s 前台轮询（tradingAware：非交易时段只请求一次，页面隐藏即停）；
 *   失败静默降级为整卡隐藏（下方历史成交额卡仍在，两套并存互不替代）
 */
const minute = ref<ThsTurnoverMinute | null>(null);
const day = ref<ThsTurnoverDay | null>(null);
/** 首载是否完成（骨架期） */
const ready = ref(false);

/** 拉取分时 + 日 K（并行；任一失败不阻塞另一展示） */
const load = async (): Promise<void> => {
  try {
    const [minuteData, dayData] = await Promise.all([
      fetchThsTurnoverMinute(),
      fetchThsTurnoverDay(),
    ]);
    minute.value = minuteData;
    day.value = dayData;
    ready.value = true;
  } catch (error) {
    // 有旧数据时保留展示（轮询间隙的上游抖动不必整卡闪没）；首载失败整卡隐藏
    if (!ready.value) {
      console.error('[realtime-turnover] 首载失败', error);
    }
  }
};

usePolling({ task: load, intervalMs: THS_POLLING_INTERVAL.TURNOVER_MINUTE, tradingAware: true });
onMounted(() => {
  void load();
});

/**
 * 元 → 万（formatAmount 入参口径：万）
 * @param v 金额原值（元；null 透传）
 * @returns 万为单位的金额；null 透传
 */
const toWan = (v: number | null): number | null => (v === null ? null : v / 1e4);

/** 今日实时成交额文案（亿/万亿自动切档） */
const realtimeText = computed(() => {
  const wan = toWan(minute.value?.turnover ?? null);
  return wan === null ? '--' : formatAmount(wan);
});

/** 较上一日（同时刻环比）文案 */
const changeText = computed(() => formatYuanWithSign(minute.value?.turnoverChange ?? null));
const changeCls = computed(() => {
  const v = minute.value?.turnoverChange;
  if (v === null || v === undefined || v === 0) return 'text-text-tertiary';
  return v > 0 ? 'text-up' : 'text-down';
});

/** 预测全天文案 */
const predictText = computed(() => {
  const wan = toWan(minute.value?.predictTurnover ?? null);
  return wan === null ? '--' : formatAmount(wan);
});

/** 5 日均文案（turnover_day 近 5 条本地平均） */
const average5Text = computed(() => {
  const avg = day.value ? computeTurnoverAverage5(day.value.points) : null;
  const wan = toWan(avg);
  return wan === null ? '--' : formatAmount(wan);
});

/** 60 日均文案（后端直出） */
const average60Text = computed(() => {
  const wan = toWan(day.value?.averageTurnover ?? null);
  return wan === null ? '--' : formatAmount(wan);
});

/** 较 5 日均（实时 − 5日均）/ 5日均，本地计算 */
const vsAverage5Text = computed(() => {
  const realtime = minute.value?.turnover ?? null;
  const avg = day.value ? computeTurnoverAverage5(day.value.points) : null;
  if (realtime === null || avg === null || avg === 0) return null;
  const pct = ((realtime - avg) / avg) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
});
const vsAverage5Cls = computed(() => {
  const realtime = minute.value?.turnover ?? null;
  const avg = day.value ? computeTurnoverAverage5(day.value.points) : null;
  if (realtime === null || avg === null) return 'text-text-tertiary';
  return realtime >= avg ? 'text-up' : 'text-down';
});

/* === 分时双线（当日累计 vs 昨日同时刻累计，亿元） === */
const SPARK_H = 40;

/** 双线 path + y 归一域（取两序列最大值定标） */
const spark = computed(() => {
  const points = minute.value?.points ?? [];
  if (points.length < 2) return null;
  const yi = (v: number | null): number => (v ?? 0) / 1e8;
  const max = Math.max(...points.map((p) => Math.max(yi(p.turnover), yi(p.pre))), 1);
  const toPath = (pick: (p: (typeof points)[number]) => number | null): string =>
    points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * 100;
        const y = SPARK_H - (yi(pick(p)) / max) * (SPARK_H - 2) - 1;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  return {
    today: toPath((p) => p.turnover),
    pre: toPath((p) => p.pre),
  };
});
</script>

<template>
  <div v-if="ready" class="flex min-w-0 flex-col">
    <!-- 实时大数字 + 较上一日 / 预测全天 -->
    <div class="flex flex-wrap items-end gap-x-5 gap-y-2">
      <div>
        <p class="text-xs text-text-tertiary">今日实时</p>
        <p class="mt-0.5 text-2xl font-semibold tabular-nums text-text">{{ realtimeText }}</p>
      </div>
      <div>
        <p class="text-xs text-text-tertiary">较上一日</p>
        <p class="mt-0.5 text-sm font-medium tabular-nums" :class="changeCls">{{ changeText }}</p>
      </div>
      <div>
        <p class="text-xs text-text-tertiary">预测全天</p>
        <p class="mt-0.5 text-sm font-medium tabular-nums text-text-secondary">{{ predictText }}</p>
      </div>
    </div>

    <!-- 分时双线：当日 vs 昨日同时刻 -->
    <div v-if="spark" class="mt-3 flex-1">
      <div class="flex items-center gap-3 text-[11px] text-text-tertiary">
        <span><i class="mr-1 inline-block h-0.5 w-3 align-middle" :style="{ background: CHART_LINE_BLUE }" />今日累计</span>
        <span><i class="mr-1 inline-block h-0 w-3 align-middle border-t border-dashed border-text-tertiary" />昨日同时刻</span>
      </div>
      <svg
        class="mt-1.5 h-[52px] w-full"
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        role="img"
        aria-label="市场成交额分时对比"
      >
        <path
          :d="spark.pre"
          fill="none"
          stroke="var(--color-text-tertiary)"
          stroke-width="1"
          stroke-dasharray="2 2"
          vector-effect="non-scaling-stroke"
          opacity="0.7"
        />
        <path
          :d="spark.today"
          fill="none"
          :stroke="CHART_LINE_BLUE"
          stroke-width="1.6"
          vector-effect="non-scaling-stroke"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <!-- 均值行（shrink-0：卡片被压缩时保底不溢出） -->
    <div class="mt-3 grid shrink-0 grid-cols-3 gap-4 border-t border-flat-weak pt-3">
      <div>
        <p class="text-xs text-text-tertiary">5日均</p>
        <p class="mt-0.5 text-sm font-medium tabular-nums text-text-secondary">{{ average5Text }}</p>
      </div>
      <div>
        <p class="text-xs text-text-tertiary">60日均</p>
        <p class="mt-0.5 text-sm font-medium tabular-nums text-text-secondary">{{ average60Text }}</p>
      </div>
      <div>
        <p class="text-xs text-text-tertiary">较 5 日均</p>
        <p class="mt-0.5 text-sm font-medium tabular-nums" :class="vsAverage5Cls">
          {{ vsAverage5Text ?? '--' }}
        </p>
      </div>
    </div>
  </div>
  <BaseSkeleton v-else class="min-h-[150px]" />
</template>
