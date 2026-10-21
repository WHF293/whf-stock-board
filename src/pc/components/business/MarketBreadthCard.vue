<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import ArmsTrendChart from '../charts/ArmsTrendChart.vue';
import {
  BREADTH_VIEW,
  BREADTH_VIEW_DAYS,
  BREADTH_VIEW_OPTIONS,
  type BreadthViewKey,
} from '../../../common/constants/market-breadth.constants.ts';
import type {
  BreadthDayBar,
  BreadthPoint,
  MarketBreadth,
} from '../../../common/types/market-breadth.types.ts';
import type { MarketSentiment } from '../../../common/types/market-sentiment.types.ts';
import { readBreadthBars, readBreadthDay } from '../../../common/api/market-breadth-db.api';
import { classifyArms, type ArmsStateResult } from '../../../common/utils/classify-arms';
import { toDayKey } from '../../../common/utils/to-day-key';

/**
 * 市场宽度 · ARMS 卡（PC 市场总览）
 *
 * 左列实时指标面板（涨跌家数 / 涨停跌停 / A/D / ARMS 现值 + 五档状态），
 * 右列曲线：当日分时（本地分钟点积累）/ 近 30 / 60 日（本地日 bar 积累）。
 * 全部数据来自既有 30s 全市场快照轮询（DashboardView fetchMarketBreadth 内 ingest），
 * 零新增上游请求；历史为本地积累，卡片自身只读 appStorage。
 */
const { breadth = null, sentiment = null } = defineProps<{
  /** 当日市场宽度统计（快照轮询写入；null 时左列显示占位） */
  breadth?: MarketBreadth | null;
  /** 市场情绪统计（涨停 / 跌停家数复用其轮询结果） */
  sentiment?: MarketSentiment | null;
}>();

/** 当前视图（当日分时 / 近 30 日 / 近 60 日） */
const view = ref<BreadthViewKey>(BREADTH_VIEW.INTRADAY);

/** 当日分钟点序列（appStorage 读取） */
const todaySeries = ref<BreadthPoint[]>([]);

/** 日 bar 序列（appStorage 读取，日期升序） */
const bars = ref<BreadthDayBar[]>([]);

/** 从本地库刷新序列（每轮快照后快照轻量重读） */
const refreshSeries = (): void => {
  todaySeries.value = readBreadthDay(toDayKey(Date.now()));
  bars.value = readBreadthBars();
};

onMounted(refreshSeries);
watch(
  () => breadth,
  () => refreshSeries(),
);

/** ARMS 五档状态（null 时左列显示「--」） */
const armsState = computed<ArmsStateResult | null>(() => classifyArms(breadth?.arms ?? null));

/** 状态 pill 的语义色（红强 / 绿弱 / 灰平衡，跟随涨跌配色主题） */
const stateStyle = computed<Record<string, string>>(() => {
  const tone = armsState.value?.tone;
  if (tone === 'up') return { color: 'var(--color-up-strong)', background: 'var(--color-up-weak)' };
  if (tone === 'down') return { color: 'var(--color-down-strong)', background: 'var(--color-down-weak)' };
  return { color: 'var(--color-flat)', background: 'var(--color-flat-weak)' };
});

/** 已积累的交易日数（历史冷启动明示） */
const accumDays = computed(() => bars.value.length);

/** 当前视图的日 bar 窗口（分时视图为空数组） */
const windowBars = computed<BreadthDayBar[]>(() => {
  if (view.value === BREADTH_VIEW.INTRADAY) return [];
  const days = BREADTH_VIEW_DAYS[view.value as Exclude<BreadthViewKey, typeof BREADTH_VIEW.INTRADAY>];
  return bars.value.slice(-days);
});

/** 当前视图是否为空态 */
const isViewEmpty = computed(() =>
  view.value === BREADTH_VIEW.INTRADAY ? todaySeries.value.length === 0 : windowBars.value.length === 0,
);

/** 距下一档窗口还差几个交易日（日线空态文案） */
const daysToFill = computed(() => {
  if (view.value === BREADTH_VIEW.INTRADAY) return 0;
  const days = BREADTH_VIEW_DAYS[view.value as Exclude<BreadthViewKey, typeof BREADTH_VIEW.INTRADAY>];
  return Math.max(0, days - accumDays.value);
});

/** ARMS 现值文案（null 显「--」） */
const armsText = computed(() => (breadth?.arms === null || breadth === null ? '--' : breadth.arms!.toFixed(2)));

/** A/D 文案（null 显「--」） */
const adText = computed(() => (breadth?.ad === null || breadth === null ? '--' : breadth.ad!.toFixed(2)));
</script>

<template>
  <BaseCard title="市场宽度 · ARMS">
    <template #extra>
      <span
        class="rounded-full px-2.5 py-1 text-xs font-bold"
        style="color: var(--color-primary); background: var(--color-primary-weak)"
      >
        已积累 {{ accumDays }} 个交易日
      </span>
    </template>

    <div class="flex flex-wrap items-stretch gap-5">
      <!-- 左：实时指标面板 -->
      <div class="flex w-[236px] shrink-0 flex-col gap-2">
        <div
          class="rounded-xl p-3"
          :style="{ background: 'linear-gradient(135deg, var(--color-up-weak), transparent 70%)' }"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-text-secondary">ARMS 现值</span>
            <span
              v-if="armsState"
              class="rounded-full px-2.5 py-0.5 text-xs font-bold"
              :style="stateStyle"
            >
              {{ armsState.label }}
            </span>
          </div>
          <div class="mt-0.5 text-3xl font-extrabold tabular-nums" style="letter-spacing: -0.5px">
            {{ armsText }}
          </div>
        </div>
        <div class="flex items-center justify-between rounded-lg bg-flat-weak px-3 py-2 text-xs text-text-secondary">
          <span>上涨</span>
          <b class="tabular-nums text-up">{{ (breadth?.upCount ?? 0).toLocaleString() }}</b>
        </div>
        <div class="flex items-center justify-between rounded-lg bg-flat-weak px-3 py-2 text-xs text-text-secondary">
          <span>下跌</span>
          <b class="tabular-nums text-down">{{ (breadth?.downCount ?? 0).toLocaleString() }}</b>
        </div>
        <div class="flex items-center justify-between rounded-lg bg-flat-weak px-3 py-2 text-xs text-text-secondary">
          <span>平盘</span>
          <b class="tabular-nums text-text">{{ (breadth?.flatCount ?? 0).toLocaleString() }}</b>
        </div>
        <div class="flex items-center justify-between rounded-lg bg-flat-weak px-3 py-2 text-xs text-text-secondary">
          <span>涨停 / 跌停</span>
          <b class="tabular-nums text-text">
            <span class="text-up">{{ sentiment?.limitUpCount ?? '--' }}</span>
            /
            <span class="text-down">{{ sentiment?.limitDownCount ?? '--' }}</span>
          </b>
        </div>
        <div class="flex items-center justify-between rounded-lg bg-flat-weak px-3 py-2 text-xs text-text-secondary">
          <span>涨跌比 A/D</span>
          <b class="tabular-nums text-text">{{ adText }}</b>
        </div>
      </div>

      <!-- 右：曲线 -->
      <div class="min-w-0 flex-1">
        <BaseTabs v-model="view" :options="BREADTH_VIEW_OPTIONS" />
        <BaseEmpty
          v-if="isViewEmpty"
          :text="
            view === BREADTH_VIEW.INTRADAY
              ? '今日暂无采样（交易日盘中随行情快照自动积累）'
              : `历史按本地逐日积累，距 ${view === BREADTH_VIEW.D30 ? 30 : 60} 日还差 ${daysToFill} 个交易日`
          "
        />
        <ArmsTrendChart v-else :view="view" :points="todaySeries" :bars="bars" />
      </div>
    </div>
  </BaseCard>
</template>
