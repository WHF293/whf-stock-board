<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../../common/constants/chart.constants.ts';
import { CHART_LINE_BLUE, CHART_LINE_PURPLE } from '../../../../common/constants/chart.constants.ts';
import BaseChart from '../../charts/BaseChart.vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import { useTzzbAnalysisStore } from '../../../../common/stores/tzzb-analysis';

/**
 * 投资账本 · 行为诊断卡（操作复盘阶段 3 新增，方案 §4.2）
 *
 * 官方只标 BS 位置、从不评价买得好不好；本卡回答「你的操作习惯值多少钱」：
 * - 处置比率徽章：盈利单 vs 亏损单平均持有天数（<1 = 拿不住盈利、死扛亏损）；
 * - 追涨指数 / 低吸占比徽章：买入金额中分位 ≥70 占比 / 分位 ≤30 笔数占比；
 * - 买卖点分位直方图：每笔成交价在 ±20 交易日 qfq 高低区间里的分位（10 桶）。
 * 数据由 tzzb-analysis store「生成分析」触发（错峰拉 K 线），本卡只消费 + 发起。
 */
const emit = defineEmits<{
  /** 点击「生成分析」（父级组装入参调 store.generate） */
  generate: [];
}>();

const store = useTzzbAnalysisStore();

/** 是否无流水可分析（父级在无账户数据时整卡不渲染，这里兜底空态） */
const idle = computed(() => store.status === 'idle');

/** 运行中进度文案 */
const progressLabel = computed(() =>
  store.status === 'running' ? `${store.progressDone} / ${store.progressTotal} 只已完成` : '',
);

/** 处置比率解读文案 */
const disposalNote = computed(() => {
  const r = store.behavior?.disposalRatio;
  if (r === null || r === undefined) return '样本不足';
  if (r < 0.7) return '拿不住盈利、死扛亏损';
  if (r < 1) return '盈利单卖得偏快';
  if (r <= 1.5) return '盈亏持有均衡';
  return '能拿住盈利单';
});

/** 追涨指数徽章解读 */
const chaseNote = computed(() => {
  const r = store.behavior?.chaseIndex;
  if (r === null || r === undefined) return '无买入样本';
  if (r < 0.15) return '基本不追高';
  if (r < 0.35) return '偶有追高';
  return '追高倾向明显';
});

/** 持有天数对比条基准（两组中较大者） */
const holdMax = computed(() =>
  Math.max(store.behavior?.avgHoldWin ?? 0, store.behavior?.avgHoldLoss ?? 0, 1),
);

/** 直方图柱标签 */
const HIST_LABELS = Array.from({ length: 10 }, (_, i) => `${i * 10}`);

/** 分位直方图配置（买 / 卖两组；蓝=买入 紫=卖出，与资产曲线双色一致） */
const histOption = computed<EChartsCoreOption | null>(() => {
  const b = store.behavior;
  if (!b || b.scoredBuys + b.scoredSells === 0) return null;
  return {
    grid: { left: 32, right: 8, top: 20, bottom: 22 },
    legend: { show: true, top: 0, right: 0, textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 } },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: HIST_LABELS,
      name: '分位',
      nameTextStyle: { color: CHART_TEXT_COLOR, fontSize: 9 },
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 9 },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 9 },
    },
    series: [
      {
        name: '买入',
        type: 'bar',
        barCategoryGap: '25%',
        data: b.buyHist,
        itemStyle: { color: CHART_LINE_BLUE, opacity: 0.85, borderRadius: [2, 2, 0, 0] },
      },
      {
        name: '卖出',
        type: 'bar',
        barCategoryGap: '25%',
        data: b.sellHist,
        itemStyle: { color: CHART_LINE_PURPLE, opacity: 0.85, borderRadius: [2, 2, 0, 0] },
      },
    ],
  };
});
</script>

<template>
  <div v-if="idle" class="flex flex-col items-center gap-1">
    <BaseEmpty text="基于逐笔流水 × 前复权日 K 的操作习惯诊断（处置效应 / 买卖点评分 / 追涨指数）" />
    <button
      type="button"
      class="pressable -mt-4 rounded-lg bg-primary px-4 py-1.5 text-sm text-white hover:opacity-90"
      @click="emit('generate')"
    >
      生成分析
    </button>
  </div>

  <div v-else-if="store.status === 'running'" class="flex h-full flex-col justify-center gap-2 px-4">
    <p class="text-sm text-text-secondary">正在错峰拉取个股前复权日 K（并发 3 · 间隔 500ms，结果自动缓存）…</p>
    <div class="h-2 overflow-hidden rounded-full bg-flat-weak">
      <div
        class="h-full rounded-full bg-primary transition-all"
        :style="{ width: `${store.progressTotal === 0 ? 0 : (store.progressDone / store.progressTotal) * 100}%` }"
      />
    </div>
    <p class="font-mono text-xs text-text-tertiary">{{ progressLabel }}</p>
  </div>

  <div v-else-if="store.status === 'error'" class="flex h-full flex-col items-center justify-center gap-2">
    <p class="text-sm text-down">生成失败：{{ store.errorMessage || '未知错误' }}</p>
    <button
      type="button"
      class="pressable rounded-lg bg-primary px-4 py-1.5 text-sm text-white hover:opacity-90"
      @click="emit('generate')"
    >
      重试
    </button>
  </div>

  <div v-else-if="store.behavior" class="flex flex-col gap-3">
    <!-- 徽章行：处置比率 / 追涨指数 / 低吸占比 / 评分覆盖 -->
    <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
      <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
        <p class="text-xs text-text-tertiary">处置比率</p>
        <p class="mt-0.5 font-mono text-base font-semibold tabular-nums text-text">
          {{ store.behavior.disposalRatio === null ? '—' : store.behavior.disposalRatio.toFixed(2) }}
        </p>
        <p class="mt-0.5 text-xs text-text-tertiary">{{ disposalNote }}</p>
      </div>
      <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
        <p class="text-xs text-text-tertiary">追涨指数</p>
        <p class="mt-0.5 font-mono text-base font-semibold tabular-nums text-text">
          {{ store.behavior.chaseIndex === null ? '—' : `${(store.behavior.chaseIndex * 100).toFixed(0)}%` }}
        </p>
        <p class="mt-0.5 text-xs text-text-tertiary">{{ chaseNote }}</p>
      </div>
      <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
        <p class="text-xs text-text-tertiary">低吸占比</p>
        <p class="mt-0.5 font-mono text-base font-semibold tabular-nums text-text">
          {{ store.behavior.dipRatio === null ? '—' : `${(store.behavior.dipRatio * 100).toFixed(0)}%` }}
        </p>
        <p class="mt-0.5 text-xs text-text-tertiary">买入分位 ≤30 的笔数占比</p>
      </div>
      <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
        <p class="text-xs text-text-tertiary">评分覆盖</p>
        <p class="mt-0.5 font-mono text-base font-semibold tabular-nums text-text">
          {{ store.behavior.scoredBuys + store.behavior.scoredSells }} 笔
        </p>
        <p class="mt-0.5 text-xs text-text-tertiary">
          买 {{ store.behavior.scoredBuys }} / 卖 {{ store.behavior.scoredSells }} · 未计分 {{ store.behavior.unscored }}
        </p>
      </div>
    </div>

    <!-- 持有天数对比 + 分位直方图 -->
    <div class="grid gap-3 md:grid-cols-3">
      <div class="flex flex-col justify-center gap-2 rounded-lg bg-flat-weak/40 px-3 py-3">
        <p class="text-xs text-text-tertiary">盈利单 vs 亏损单 平均持有天数</p>
        <div class="flex items-center gap-2">
          <span class="w-10 shrink-0 text-xs text-up">盈利</span>
          <span class="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-flat-weak">
            <span
              class="block h-full rounded-full bg-up"
              :style="{ width: `${Math.max(2, ((store.behavior.avgHoldWin ?? 0) / holdMax) * 100)}%` }"
            />
          </span>
          <span class="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-text">
            {{ store.behavior.avgHoldWin === null ? '—' : `${store.behavior.avgHoldWin.toFixed(1)} 天` }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-10 shrink-0 text-xs text-down">亏损</span>
          <span class="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-flat-weak">
            <span
              class="block h-full rounded-full bg-down"
              :style="{ width: `${Math.max(2, ((store.behavior.avgHoldLoss ?? 0) / holdMax) * 100)}%` }"
            />
          </span>
          <span class="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-text">
            {{ store.behavior.avgHoldLoss === null ? '—' : `${store.behavior.avgHoldLoss.toFixed(1)} 天` }}
          </span>
        </div>
        <p class="text-xs text-text-tertiary">区间已清仓周期口径（处置效应经典对照）</p>
      </div>
      <div v-if="histOption" class="h-44 md:col-span-2">
        <BaseChart :options="histOption" />
      </div>
    </div>

    <p v-if="store.missingSymbols.length > 0" class="text-xs text-text-tertiary">
      {{ store.missingSymbols.length }} 只票 K 线拉取失败已跳过（{{ store.missingSymbols.join('、') }}），相关笔数未计分
    </p>
  </div>
</template>
