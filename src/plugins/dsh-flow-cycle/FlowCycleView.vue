<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseCard from '../../components/ui/BaseCard.vue';
import BaseEmpty from '../../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../../components/ui/BaseSkeleton.vue';
import MenuIcon from '../../components/ui/MenuIcon.vue';
import { YUAN_PER_YI } from '../../constants/format.constants';
import { TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import { formatPercent } from '../../utils/format-percent';
import { fetchFlowCycleHistories, fetchFlowCycleHotBoards } from './api';
import { buildFlowCycleSummary } from './judge';
import {
  FLOW_CYCLE_EMPTY_TEXT,
  FLOW_CYCLE_LOAD_FAILED,
  FLOW_CYCLE_NET_TOTAL_EMPTY,
  FLOW_CYCLE_PAGE_SUBTITLE,
  FLOW_CYCLE_PAGE_TITLE,
  FLOW_CYCLE_PERIODS,
  FLOW_CYCLE_PERIOD_DEFAULT,
  FLOW_CYCLE_PERIOD_LABEL,
  FLOW_CYCLE_PROGRESS_LABEL,
  FLOW_CYCLE_REFRESH_LABEL,
  FLOW_CYCLE_REFRESHING_LABEL,
  FLOW_CYCLE_STAT_BOARDS,
  FLOW_CYCLE_STAT_BOARDS_SUB,
  FLOW_CYCLE_STAT_COMPLETENESS_SUB,
  FLOW_CYCLE_STAT_DATE_RANGE,
  FLOW_CYCLE_STAT_FAILED_SUB,
  FLOW_CYCLE_STAT_NET_TOTAL,
  FLOW_CYCLE_STAT_NET_TOTAL_SUB,
  FLOW_CYCLE_STAT_TRADE_DAYS,
  FLOW_CYCLE_STAT_TRADE_DAYS_SUB,
  FLOW_CYCLE_VIEW_DAILY,
  FLOW_CYCLE_VIEW_DAILY_LABEL,
  FLOW_CYCLE_VIEW_SUMMARY,
  FLOW_CYCLE_VIEW_SUMMARY_LABEL,
} from './constants';
import type {
  FlowCycleBoardHistory,
  FlowCycleHotBoard,
  FlowCycleSummary,
} from './types';

/**
 * 资金周期页面（插件 dsh-flow-cycle）
 *
 * 进入页面自动拉一次（热点名单 2 请求 + 逐日历史 30 请求，并发 3）；
 * 期间切换 / 视图切换纯前端重算不再请求；刷新整场重拉。
 * 会话级缓存跨路由保留（数据为交易日口径，当日有效），二次进页秒出。
 */
import CycleDailyCard from './CycleDailyCard.vue';
import CycleSummaryTable from './CycleSummaryTable.vue';

/** 会话级缓存（跨路由切换保留；当日有效，刷新整场重拉） */
let sessionCache: {
  /** 热点板块名单 */
  hotBoards: FlowCycleHotBoard[];
  /** 板块逐日历史（BK 编号索引，渐进填充） */
  histories: Map<string, FlowCycleBoardHistory>;
} | null = null;

/** 期间档位（交易日数） */
const periodDays = ref<number>(FLOW_CYCLE_PERIOD_DEFAULT);

/** 视图模式（逐日明细 / 区间总览） */
const viewMode = ref<'daily' | 'summary'>(FLOW_CYCLE_VIEW_DAILY);

/** 热点板块名单 */
const hotBoards = ref<FlowCycleHotBoard[]>([]);
/** 板块逐日历史（BK 编号索引） */
const historyMap = ref<Map<string, FlowCycleBoardHistory>>(new Map());
/** 名单加载中 */
const isNameLoading = ref(false);
/** 历史拉取进度（done / total；total 为本轮目标数） */
const progress = ref<{ done: number; total: number } | null>(null);
/** 名单加载失败（整页错误态） */
const isError = ref(false);
/** 本轮取数失败的板块数（可刷新重试） */
const failedCount = ref(0);

/** 热点板块索引（BK 编号 -> 排行行） */
const hotByCode = computed(() => new Map(hotBoards.value.map((row) => [row.code, row])));

/** 期间聚合结果（历史渐进到位即重算） */
const summary = computed<FlowCycleSummary>(() =>
  buildFlowCycleSummary([...historyMap.value.values()], hotByCode.value, periodDays.value),
);

/**
 * 期间档位文案（{days}日）
 * @param days 交易日数
 * @returns 文案
 */
const periodLabel = (days: number): string =>
  FLOW_CYCLE_PERIOD_LABEL.replace('{days}', String(days));

/**
 * 统计卡副文：板块数
 * @returns 副文（含失败提示时拼接）
 */
const boardsSubText = computed(() => {
  const parts = [FLOW_CYCLE_STAT_BOARDS_SUB.replace('{total}', String(hotBoards.value.length))];
  if (failedCount.value > 0) {
    parts.push(FLOW_CYCLE_STAT_FAILED_SUB.replace('{failed}', String(failedCount.value)));
  }
  return parts.join('，');
});

/** 交易日副文 */
const tradeDaysSubText = computed(() =>
  FLOW_CYCLE_STAT_TRADE_DAYS_SUB.replace('{days}', String(periodDays.value)),
);

/** 区间净额展示（仅完整板块参与合计；无完整板块显示 --） */
const netTotalText = computed(() => {
  if (summary.value.boards.length === 0 || summary.value.tradeDays === 0) {
    return FLOW_CYCLE_NET_TOTAL_EMPTY;
  }
  return `${summary.value.netTotal >= 0 ? '+' : ''}${(summary.value.netTotal / YUAN_PER_YI).toFixed(2)}亿`;
});

/** 日期范围展示（基准轴首尾） */
const dateRangeText = computed(() => {
  const { dates } = summary.value;
  if (dates.length === 0) {
    return FLOW_CYCLE_NET_TOTAL_EMPTY;
  }
  return `${dates[0].slice(5)} ~ ${dates[dates.length - 1].slice(5)}`;
});

/** 完整度副文（完整 x · 部分 y） */
const completenessSubText = computed(() => {
  const complete = summary.value.boards.filter(
    (board) => board.completeness === 'complete',
  ).length;
  return FLOW_CYCLE_STAT_COMPLETENESS_SUB.replace(
    '{complete}',
    String(complete),
  ).replace('{partial}', String(summary.value.boards.length - complete));
});

/**
 * 热点 chips 点击：滚动定位到对应逐日卡片
 * @param code 板块代码
 */
const scrollToCard = (code: string): void => {
  document
    .getElementById(`flow-cycle-card-${code}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

/**
 * 加载数据（名单 + 逐日历史；历史渐进合并触发 summary 重算）
 * @param forceRefresh true 时清空缓存整场重拉
 */
const load = async (forceRefresh = false): Promise<void> => {
  if (isNameLoading.value || progress.value) {
    return;
  }
  isError.value = false;
  if (forceRefresh) {
    sessionCache = null;
    hotBoards.value = [];
    historyMap.value = new Map();
    failedCount.value = 0;
  }

  // 会话缓存命中：直接恢复（历史可能仍在补拉中，继续补齐）
  if (sessionCache) {
    hotBoards.value = sessionCache.hotBoards;
    historyMap.value = new Map(sessionCache.histories);
  }

  try {
    if (hotBoards.value.length === 0) {
      isNameLoading.value = true;
      const boards = await fetchFlowCycleHotBoards();
      hotBoards.value = boards;
      sessionCache = { hotBoards: boards, histories: new Map() };
      if (boards.length === 0) {
        return;
      }
    }
    isNameLoading.value = false;

    const targets = hotBoards.value.filter((row) => !historyMap.value.has(row.code));
    if (targets.length === 0) {
      return;
    }
    progress.value = { done: 0, total: targets.length };
    failedCount.value = 0;
    const histories = await fetchFlowCycleHistories(
      targets.map((row) => row.code),
      {
        onHistory: (history) => {
          historyMap.value.set(history.code, history);
          progress.value = {
            done: (progress.value?.done ?? 0) + 1,
            total: progress.value?.total ?? targets.length,
          };
        },
      },
    );
    // 缓存同步（渐进回调已写入 historyMap，这里收敛失败计数）
    failedCount.value = targets.length - histories.length;
    if (sessionCache) {
      for (const history of histories) {
        sessionCache.histories.set(history.code, history);
      }
    }
  } catch (error) {
    isError.value = hotBoards.value.length === 0;
    console.error('[dsh-flow-cycle] load', error);
  } finally {
    isNameLoading.value = false;
    progress.value = null;
  }
};

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="space-y-4">
    <!-- 头部：标题 + 期间切换 + 视图切换 + 刷新 -->
    <BaseCard>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h1 class="flex items-center gap-1.5 text-base font-semibold text-text">
            <MenuIcon name="calendar" :size="16" />
            {{ FLOW_CYCLE_PAGE_TITLE }}
          </h1>
          <p class="mt-1 text-xs leading-relaxed text-text-secondary">
            {{ FLOW_CYCLE_PAGE_SUBTITLE }}
          </p>
        </div>
        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <div class="flex items-center gap-1 rounded-lg bg-flat-weak p-0.5">
            <button
              v-for="days in FLOW_CYCLE_PERIODS"
              :key="days"
              type="button"
              class="pressable rounded-md px-2.5 py-1 text-xs font-medium"
              :class="
                periodDays === days
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-secondary hover:text-text'
              "
              @click="periodDays = days"
            >
              {{ periodLabel(days) }}
            </button>
          </div>
          <div class="flex items-center gap-1 rounded-lg bg-flat-weak p-0.5">
            <button
              type="button"
              class="pressable rounded-md px-2.5 py-1 text-xs font-medium"
              :class="
                viewMode === FLOW_CYCLE_VIEW_DAILY
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-secondary hover:text-text'
              "
              @click="viewMode = FLOW_CYCLE_VIEW_DAILY"
            >
              {{ FLOW_CYCLE_VIEW_DAILY_LABEL }}
            </button>
            <button
              type="button"
              class="pressable rounded-md px-2.5 py-1 text-xs font-medium"
              :class="
                viewMode === FLOW_CYCLE_VIEW_SUMMARY
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-secondary hover:text-text'
              "
              @click="viewMode = FLOW_CYCLE_VIEW_SUMMARY"
            >
              {{ FLOW_CYCLE_VIEW_SUMMARY_LABEL }}
            </button>
          </div>
          <BaseButton variant="ghost" :disabled="isNameLoading || !!progress" @click="load(true)">
            {{ progress ? FLOW_CYCLE_REFRESHING_LABEL : FLOW_CYCLE_REFRESH_LABEL }}
          </BaseButton>
        </div>
      </div>
    </BaseCard>

    <!-- 整页错误（热点名单失败） -->
    <BaseCard v-if="isError">
      <BaseEmpty :text="FLOW_CYCLE_LOAD_FAILED" />
      <div class="mt-3 flex justify-center">
        <BaseButton variant="ghost" @click="load(true)">重试</BaseButton>
      </div>
    </BaseCard>

    <template v-else>
      <!-- 统计卡 -->
      <div class="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        <div class="rounded-card bg-surface p-3 shadow-card">
          <p class="text-xs text-text-tertiary">{{ FLOW_CYCLE_STAT_BOARDS }}</p>
          <p class="mt-1 text-xl font-semibold text-text">{{ hotBoards.length }}</p>
          <p class="mt-0.5 text-[11px] text-text-tertiary">{{ boardsSubText }}</p>
        </div>
        <div class="rounded-card bg-surface p-3 shadow-card">
          <p class="text-xs text-text-tertiary">{{ FLOW_CYCLE_STAT_TRADE_DAYS }}</p>
          <p class="mt-1 text-xl font-semibold text-text">{{ summary.tradeDays }}</p>
          <p class="mt-0.5 text-[11px] text-text-tertiary">{{ tradeDaysSubText }}</p>
        </div>
        <div class="rounded-card bg-surface p-3 shadow-card">
          <p class="text-xs text-text-tertiary">{{ FLOW_CYCLE_STAT_NET_TOTAL }}</p>
          <p
            class="mt-1 text-xl font-semibold tabular-nums"
            :class="summary.netTotal >= 0 ? 'text-up' : 'text-down'"
          >
            {{ netTotalText }}
          </p>
          <p class="mt-0.5 text-[11px] text-text-tertiary">
            {{ FLOW_CYCLE_STAT_NET_TOTAL_SUB }}
          </p>
        </div>
        <div class="rounded-card bg-surface p-3 shadow-card">
          <p class="text-xs text-text-tertiary">{{ FLOW_CYCLE_STAT_DATE_RANGE }}</p>
          <p class="mt-1 text-base font-semibold tabular-nums text-text">
            {{ dateRangeText }}
          </p>
          <p class="mt-0.5 text-[11px] text-text-tertiary">{{ completenessSubText }}</p>
        </div>
      </div>

      <!-- 热点板块 chips（点击滚动定位卡片） -->
      <div v-if="hotBoards.length > 0" class="flex flex-wrap gap-1.5">
        <button
          v-for="board in hotBoards"
          :key="board.code"
          type="button"
          class="pressable flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs text-text shadow-card"
          @click="scrollToCard(board.code)"
        >
          <span
            class="size-1.5 rounded-full"
            :class="(board.net10d ?? 0) >= 0 ? 'bg-up' : 'bg-down'"
          ></span>
          {{ board.name }}
          <span
            v-if="board.changePercent !== null"
            class="tabular-nums"
            :class="TREND_TEXT_CLASS[getTrendByChangePercent(board.changePercent)]"
          >
            {{ formatPercent(board.changePercent) }}
          </span>
        </button>
      </div>

      <!-- 拉取进度条 -->
      <div
        v-if="progress"
        class="flex items-center gap-2 text-xs text-text-tertiary"
      >
        <span class="inline-block size-3 animate-spin rounded-full border-2 border-flat-strong border-t-primary"></span>
        正在拉取板块逐日资金流
        {{ FLOW_CYCLE_PROGRESS_LABEL.replace('{done}', String(progress.done)).replace('{total}', String(progress.total)) }}
      </div>

      <!-- 视图区 -->
      <BaseCard v-if="isNameLoading">
        <BaseSkeleton />
      </BaseCard>
      <template v-else-if="summary.boards.length > 0">
        <!-- 逐日明细：卡片网格 -->
        <div
          v-if="viewMode === FLOW_CYCLE_VIEW_DAILY"
          class="grid grid-cols-1 gap-3 @3xl:grid-cols-2 @5xl:grid-cols-3"
        >
          <div
            v-for="board in summary.boards"
            :id="`flow-cycle-card-${board.code}`"
            :key="board.code"
            class="scroll-mt-20"
          >
            <CycleDailyCard :board="board" />
          </div>
        </div>
        <!-- 区间总览：对比表 -->
        <BaseCard v-else>
          <CycleSummaryTable :boards="summary.boards" />
        </BaseCard>
      </template>
      <BaseCard v-else-if="!progress">
        <BaseEmpty :text="FLOW_CYCLE_EMPTY_TEXT" />
      </BaseCard>
    </template>
  </div>
</template>
