<script setup lang="ts">
import { ref } from 'vue';
import {
  SEESAW_BUCKET_LABELS,
  SEESAW_LINE_COLORS,
  STYLE_DEFENSIVE_BOARD_NAMES,
} from '../../../common/constants/style-seesaw.constants.ts';
import type { SeesawDayPoint } from '../../../common/types/style-seesaw.types.ts';

/**
 * 风格跷跷板快照区（纯展示，2026-11-03 王总指定从独立 Tab 深度并入题材轮动：
 * 剪刀差曲线已并入 bump 图右轴，本组件只保留横幅与两端行业热度榜，
 * 挂在题材轮动主卡详情区下方，与 bump 图共用同一窗口的最新交易日快照）
 *
 * 上 = 跷跷板横幅（最新交易日两端对比：等权涨跌幅 / 成交额 / 涨停家数 / 领涨行业，
 * 中间风险偏好倾向 pill）；下 = 两端行业热度榜（点行业跳板块详情，事件上抛由页面路由）。
 */

const props = defineProps<{
  /** 最新交易日的跷跷板快照（null = 窗口内无数据，整块不渲染） */
  day: SeesawDayPoint | null;
}>();

const emit = defineEmits<{
  /** 行业点击：跳板块详情页（页面处理路由） */
  boardClick: [boardCode: string];
}>();

/** 风险偏好倾向文案 */
const BIAS_LABEL: Record<NonNullable<SeesawDayPoint['bias']>, string> = {
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

/** 口径说明气泡开关 */
const legendOpen = ref(false);
</script>

<template>
  <div v-if="props.day" class="flex flex-col gap-2">
    <!-- 区头：标题 + 口径说明气泡 -->
    <div class="flex items-center gap-2">
      <b class="text-sm text-text">风格跷跷板</b>
      <span class="text-[10px] text-text-tertiary">曲线见上图右轴（窗口首日归零）</span>
      <div class="relative ml-auto">
        <button
          type="button"
          class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
          aria-label="口径说明"
          title="口径说明"
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
          {{ SEESAW_BUCKET_LABELS.AGGRESSIVE }} = 当日达标的情绪主线板块归并后的行业集合
          （逐日可变，与题材轮动上榜门槛联动）；{{ SEESAW_BUCKET_LABELS.DEFENSIVE }} =
          静态老登价值桶（红利核心 + 大消费与地产基建老登，共 {{ STYLE_DEFENSIVE_BOARD_NAMES.length }}
          个申万一级行业）：{{ STYLE_DEFENSIVE_BOARD_NAMES.join(' / ') }}。
          右轴曲线为两桶行业等权涨跌幅的窗口累计（基期归零）：张口 = 风格分化，
          交叉 = 风格切换。两桶冲突日抱团优先（防守端剔除当日达标的老登行业）。
        </div>
      </div>
    </div>

    <!-- 跷跷板横幅：两端对比 + 倾向 pill -->
    <div class="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
      <div class="rounded-card border border-flat-weak bg-surface p-3">
        <p class="mb-1 text-xs font-medium text-text">
          <i
            class="mr-1 inline-block h-2 w-2 rounded-full"
            :style="{ background: SEESAW_LINE_COLORS.AGGRESSIVE }"
          />{{ SEESAW_BUCKET_LABELS.AGGRESSIVE }}
        </p>
        <p
          class="text-xl tabular-nums"
          :class="(props.day.aggressive.changePercentAvg ?? 0) >= 0 ? 'text-up' : 'text-down'"
        >
          {{ fmtPct(props.day.aggressive.changePercentAvg) }}
        </p>
        <p class="mt-1 text-[11px] text-text-tertiary">
          成交 {{ fmtAmount(props.day.aggressive.amountSum) }} · 涨停 {{ props.day.aggressive.limitUpSum }} 家
          <template v-if="props.day.aggressive.boards[0]">
            · 领涨 {{ props.day.aggressive.boards[0]!.name }}
          </template>
        </p>
      </div>
      <div class="flex flex-col items-center justify-center px-2">
        <span
          class="rounded-full px-3 py-1 text-xs font-medium"
          :class="{
            'bg-up-weak text-up': props.day.bias === 'aggressive',
            'bg-down-weak text-down': props.day.bias === 'defensive',
            'bg-flat-weak text-text-tertiary': props.day.bias === 'balanced' || props.day.bias === null,
          }"
        >
          {{ props.day.bias === null ? '缺数' : BIAS_LABEL[props.day.bias] }}
        </span>
        <span class="mt-1 text-[10px] text-text-tertiary">{{ props.day.tradeDate }}</span>
      </div>
      <div class="rounded-card border border-flat-weak bg-surface p-3">
        <p class="mb-1 text-xs font-medium text-text">
          <i
            class="mr-1 inline-block h-2 w-2 rounded-full"
            :style="{ background: SEESAW_LINE_COLORS.DEFENSIVE }"
          />{{ SEESAW_BUCKET_LABELS.DEFENSIVE }}
        </p>
        <p
          class="text-xl tabular-nums"
          :class="(props.day.defensive.changePercentAvg ?? 0) >= 0 ? 'text-up' : 'text-down'"
        >
          {{ fmtPct(props.day.defensive.changePercentAvg) }}
        </p>
        <p class="mt-1 text-[11px] text-text-tertiary">
          成交 {{ fmtAmount(props.day.defensive.amountSum) }} · 涨停 {{ props.day.defensive.limitUpSum }} 家
          <template v-if="props.day.defensive.boards[0]">
            · 领涨 {{ props.day.defensive.boards[0]!.name }}
          </template>
        </p>
      </div>
    </div>

    <!-- 两端行业热度榜 -->
    <div class="grid grid-cols-2 gap-2">
      <div
        v-for="bucket in ([
          ['进攻端 · 当日抱团行业', props.day.aggressive],
          ['防守端 · 老登桶行业', props.day.defensive],
        ] as const)"
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
                :class="(board.changePercent ?? 0) >= 0 ? 'text-up' : 'text-down'"
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
  </div>
</template>
