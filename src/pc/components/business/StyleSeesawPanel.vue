<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import BaseButton from '../ui/BaseButton.vue';
import BaseChart from '../charts/BaseChart.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import {
  SEESAW_DEFAULT_RANGE,
  SEESAW_RANGES,
} from '../../../common/constants/style-seesaw.constants.ts';
import type { BoardDailyRow } from '../../../common/types/board-calendar.types.ts';
import type {
  SeesawBias,
  SeesawModel,
} from '../../../common/types/style-seesaw.types.ts';
import { buildStyleSeesaw } from '../../../common/utils/build-style-seesaw';

/**
 * 风格跷跷板面板（题材轮动页第 5 个视图 Tab，王总 2026-10-23 确认方向）：
 *
 * 上 = 跷跷板横幅（最新交易日两端对比：等权涨跌幅 / 成交额 / 涨停家数 / 领涨行业，
 * 中间风险偏好倾向 pill）；中 = 近 N 日两桶累计涨跌幅剪刀差曲线（基期归零，
 * 两线张口 = 风格分化，交叉 = 风格切换点）；下 = 两端行业热度榜（点行业跳板块详情）。
 *
 * 两桶口径：进攻端 = 当日达标主线板块归并后的申万一级行业集合（逐日可变，与题材轮动
 * 上榜门槛联动）；防守端 = 红利桶静态行业映射。聚合只走申万一级，零重复计算。
 * 组件只吃 props 不直连数据层；跳转通过事件上抛（boardClick），页面负责路由。
 */

const props = defineProps<{
  /** 板块 × 交易日聚合行（board_daily，已加权口径） */
  dailyRows: BoardDailyRow[];
}>();

const emit = defineEmits<{
  /** 行业点击：跳板块详情页（页面处理路由） */
  boardClick: [boardCode: string];
}>();

/** 展示范围（交易日数；BaseTabs value 为字符串） */
const range = ref<string>(String(SEESAW_DEFAULT_RANGE));

/** 范围切换选项 */
const rangeOptions = SEESAW_RANGES.map((value) => ({ label: `近${value}日`, value: String(value) }));

/* --------------------------------- 模型构建 --------------------------------- */

const fullModel = computed<SeesawModel>(() => buildStyleSeesaw(props.dailyRows));

/** 当前展示窗口内的交易日（模型日期末尾 N 个，升序） */
const windowDays = computed(() => fullModel.value.days.slice(-Number(range.value)));

/** 最新交易日（横幅数据源） */
const latestDay = computed(() => windowDays.value[windowDays.value.length - 1] ?? null);

/** 风险偏好倾向文案 */
const BIAS_LABEL: Record<SeesawBias, string> = {
  aggressive: '进攻占优',
  defensive: '防守占优',
  balanced: '风格均衡',
};

/**
 * 涨跌幅百分比文案（null 显「--」，保留两位小数带正负号）
 * @param value 涨跌幅（%）
 * @returns 展示文案
 */
const fmtPct = (value: number | null): string =>
  value === null ? '--' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

/**
 * 成交额换算文案（亿元，null 显「--」）
 * @param value 成交额（元）
 * @returns 展示文案
 */
const fmtAmount = (value: number | null): string =>
  value === null ? '--' : `${(value / 1e8).toFixed(0)}亿`;

/* --------------------------------- 剪刀差曲线 --------------------------------- */

const chartOptions = computed<EChartsCoreOption>(() => {
  const dates = windowDays.value.map((day) => day.tradeDate);
  return {
    grid: { left: 56, right: 16, top: 28, bottom: 24 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '--'),
    },
    legend: { top: 0, right: 0, itemWidth: 14, textStyle: { fontSize: 11 } },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: '{value}%', fontSize: 10 },
      splitLine: { lineStyle: { opacity: 0.3 } },
    },
    series: [
      {
        name: '进攻端 · 高情绪抱团',
        type: 'line',
        smooth: 0.3,
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 2, color: '#e0592a' },
        itemStyle: { color: '#e0592a' },
        data: windowDays.value.map((day) => day.aggressive.cumulativeChange),
      },
      {
        name: '防守端 · 高股息红利',
        type: 'line',
        smooth: 0.3,
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 2, color: '#3a7bd5' },
        itemStyle: { color: '#3a7bd5' },
        data: windowDays.value.map((day) => day.defensive.cumulativeChange),
      },
    ],
  };
});

/** 图例说明气泡开关 */
const legendOpen = ref(false);
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <BaseTabs v-model="range" :options="rangeOptions" />
      <div class="relative ml-auto">
        <button
          type="button"
          class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
          aria-label="图例"
          title="图例"
          @click="legendOpen = !legendOpen"
        >
          <span class="text-xs">?</span>
        </button>
        <div v-if="legendOpen" class="fixed inset-0 z-30" @click="legendOpen = false" />
        <div
          v-if="legendOpen"
          class="absolute right-0 top-full z-40 mt-1 w-72 rounded-lg border border-flat-weak bg-surface p-3 text-[11px] leading-relaxed text-text-tertiary shadow-xl"
          role="tooltip"
        >
          进攻端 = 当日达标的情绪主线板块归并后的行业集合（逐日可变，与题材轮动上榜门槛联动）；
          防守端 = 银行 / 煤炭 / 石油石化 / 公用事业 / 交通运输红利桶。曲线为两桶行业等权
          涨跌幅的累计（基期归零）：张口 = 风格分化，交叉 = 风格切换。两桶冲突日抱团优先。
        </div>
      </div>
    </div>

    <template v-if="latestDay">
      <!-- 跷跷板横幅：两端对比 + 倾向 pill -->
      <div class="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        <div class="rounded-card border border-flat-weak bg-surface p-3">
          <p class="mb-1 text-xs font-medium text-text">
            <i class="mr-1 inline-block h-2 w-2 rounded-full" style="background: #e0592a" />进攻端 · 高情绪抱团
          </p>
          <p class="text-xl tabular-nums" :class="((latestDay.aggressive.changePercentAvg ?? 0) >= 0 ? 'text-up' : 'text-down')">
            {{ fmtPct(latestDay.aggressive.changePercentAvg) }}
          </p>
          <p class="mt-1 text-[11px] text-text-tertiary">
            成交 {{ fmtAmount(latestDay.aggressive.amountSum) }} · 涨停 {{ latestDay.aggressive.limitUpSum }} 家
            <template v-if="latestDay.aggressive.boards[0]">
              · 领涨 {{ latestDay.aggressive.boards[0]!.name }}
            </template>
          </p>
        </div>
        <div class="flex flex-col items-center justify-center px-2">
          <span
            class="rounded-full px-3 py-1 text-xs font-medium"
            :class="{
              'bg-up-weak text-up': latestDay.bias === 'aggressive',
              'bg-down-weak text-down': latestDay.bias === 'defensive',
              'bg-flat-weak text-text-tertiary': latestDay.bias === 'balanced' || latestDay.bias === null,
            }"
          >
            {{ latestDay.bias === null ? '缺数' : BIAS_LABEL[latestDay.bias] }}
          </span>
          <span class="mt-1 text-[10px] text-text-tertiary">{{ latestDay.tradeDate }}</span>
        </div>
        <div class="rounded-card border border-flat-weak bg-surface p-3">
          <p class="mb-1 text-xs font-medium text-text">
            <i class="mr-1 inline-block h-2 w-2 rounded-full" style="background: #3a7bd5" />防守端 · 高股息红利
          </p>
          <p class="text-xl tabular-nums" :class="((latestDay.defensive.changePercentAvg ?? 0) >= 0 ? 'text-up' : 'text-down')">
            {{ fmtPct(latestDay.defensive.changePercentAvg) }}
          </p>
          <p class="mt-1 text-[11px] text-text-tertiary">
            成交 {{ fmtAmount(latestDay.defensive.amountSum) }} · 涨停 {{ latestDay.defensive.limitUpSum }} 家
            <template v-if="latestDay.defensive.boards[0]">
              · 领涨 {{ latestDay.defensive.boards[0]!.name }}
            </template>
          </p>
        </div>
      </div>

      <!-- 剪刀差曲线：两桶累计涨跌幅（基期归零） -->
      <div class="shrink-0 rounded-card bg-surface p-4 shadow-card">
        <div :style="{ width: '100%', height: '300px' }">
          <BaseChart :options="chartOptions" not-merge />
        </div>
      </div>

      <!-- 两端行业热度榜 -->
      <div class="grid grid-cols-2 gap-2">
        <div
          v-for="bucket in ([['进攻端 · 当日抱团行业', latestDay.aggressive], ['防守端 · 红利桶行业', latestDay.defensive]] as const)"
          :key="bucket[0]"
          class="rounded-card border border-flat-weak bg-surface p-3"
        >
          <p class="mb-2 text-xs font-medium text-text">{{ bucket[0] }}</p>
          <p v-if="bucket[1].boards.length === 0" class="py-3 text-center text-xs text-text-tertiary">
            当日无达标行业
          </p>
          <table v-else class="w-full text-xs">
            <thead>
              <tr class="text-left text-text-tertiary">
                <th class="pb-1 font-normal">行业</th>
                <th class="pb-1 text-right font-normal">涨跌幅</th>
                <th class="pb-1 text-right font-normal">成交额</th>
                <th class="pb-1 text-right font-normal">涨停</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="board in bucket[1].boards"
                :key="board.code"
                class="cursor-pointer border-t border-flat-weak hover:bg-flat-weak"
                :title="`查看${board.name}板块详情`"
                @click="emit('boardClick', board.code)"
              >
                <td class="py-1 text-text">{{ board.name }}</td>
                <td
                  class="py-1 text-right tabular-nums"
                  :class="((board.changePercent ?? 0) >= 0 ? 'text-up' : 'text-down')"
                >
                  {{ fmtPct(board.changePercent) }}
                </td>
                <td class="py-1 text-right tabular-nums text-text-tertiary">{{ fmtAmount(board.amount) }}</td>
                <td class="py-1 text-right tabular-nums text-text-tertiary">{{ board.limitUp }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <BaseEmpty v-else text="当前窗口内暂无板块日历数据，请先在其他视图同步板块数据" />

    <div v-if="fullModel.days.length > 0" class="flex justify-end">
      <BaseButton variant="ghost" class="!px-2 !py-1 text-[10px]" @click="legendOpen = !legendOpen">
        口径说明
      </BaseButton>
    </div>
  </div>
</template>
