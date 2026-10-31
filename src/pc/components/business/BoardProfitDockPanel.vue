<script setup lang="ts">
import { computed } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BoardProfitBubblePanel from './BoardProfitBubblePanel.vue';
import { applyBoardScoreWeights } from '../../../common/utils/apply-board-score-weights';
import { BOARD_DATA_LEVEL } from '../../../common/constants/board-calendar.constants.ts';
import { useDataCacheStore } from '../../../common/stores/data-cache';
import { useSettingsStore } from '../../../common/stores/settings';
import { DATA_CACHE_KEY } from '../../../common/constants/data-cache.constants.ts';
import type { BoardDailyRow } from '../../../common/types/board-calendar.types.ts';

/**
 * 赚钱效应气泡图 · 右侧停靠面板内容（2026-10-31 王总指定）
 *
 * 原「赚钱效应」主区 tab 迁入：日期选择器（本地有数据日可选）+ 聚焦日
 * 「回到最新快照」+ 气泡图。数据源与页面解耦——直接读 data-cache 的
 * board_daily 会话缓存（页内轮询持续刷新）并按自定义权重重算，
 * 打开面板不依赖板块分析页当前状态（可与其它页共存）。
 *
 * 聚焦日语义沿用：打开即聚焦传入日；选回最新快照或点「回到最新快照」清除。
 */

const props = defineProps<{
  /** 聚焦交易日（YYYY-MM-DD；空串 = 最新完整快照日） */
  tradeDate: string;
}>();

const emit = defineEmits<{
  /** 日期选择器切换聚焦日（写入 dock store 的 profitDate） */
  focusChange: [tradeDate: string];
  /** 清除聚焦日（回到最新完整快照日） */
  focusReset: [];
}>();

const settingsStore = useSettingsStore();
const dataCache = useDataCacheStore();

/** 会话缓存的板块日聚合（页内轮询持续写入） */
const cachedRows = computed<BoardDailyRow[]>(() =>
  dataCache.get<BoardDailyRow[]>(DATA_CACHE_KEY.BOARD_CALENDAR_MATRIX) ?? [],
);

/** 应用自定义权重后的日聚合（与页面同口径） */
const weightedRows = computed<BoardDailyRow[]>(() =>
  applyBoardScoreWeights(cachedRows.value, settingsStore.boardScoreWeights),
);

/** 本地有数据的交易日（升序；日期选择器可用项判定） */
const datesWithData = computed<string[]>(() =>
  [...new Set(weightedRows.value.map((row) => row.tradeDate))].sort(),
);

/** 最新完整快照日（无完整快照时退最新日，与原页面口径一致） */
const latestSnapshotDate = computed<string>(() => {
  const byDate = new Map<string, BoardDailyRow[]>();
  for (const row of weightedRows.value) {
    const list = byDate.get(row.tradeDate);
    if (list) list.push(row);
    else byDate.set(row.tradeDate, [row]);
  }
  const dates = [...byDate.keys()].sort();
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    const dayRows = byDate.get(dates[index] ?? '') ?? [];
    if (dayRows.some((row) => row.dataLevel === BOARD_DATA_LEVEL.FULL)) {
      return dates[index] ?? '';
    }
  }
  return dates[dates.length - 1] ?? '';
});

/** 当前聚焦日（空串 = 最新快照日） */
const focusDate = computed<string>(() => props.tradeDate || latestSnapshotDate.value);

/** 当前渲染的日聚合行（聚焦日；窗口外为空数组由气泡图空态兜底） */
const viewRows = computed<BoardDailyRow[]>(() =>
  weightedRows.value.filter((row) => row.tradeDate === focusDate.value),
);

/** 该日是否完整快照 */
const isFullSnapshot = computed<boolean>(
  () =>
    viewRows.value.length > 0 &&
    viewRows.value.every((row) => row.dataLevel === BOARD_DATA_LEVEL.FULL),
);

/** 有数据日集合（select 置灰判定用） */
const withData = computed<Set<string>>(() => new Set(datesWithData.value));

/**
 * 日期选择器切换聚焦日
 * @param event select change 事件
 */
const onDateSelect = (event: Event): void => {
  emit('focusChange', (event.target as HTMLSelectElement).value);
};
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <!-- 日期选择器 + 聚焦清除 -->
    <div class="flex shrink-0 items-center gap-2">
      <select
        :value="focusDate"
        class="h-7 rounded-lg border border-flat-weak bg-surface px-2 text-xs text-text"
        aria-label="选择交易日"
        @change="onDateSelect"
      >
        <option
          v-for="date in datesWithData"
          :key="date"
          :value="date"
          :disabled="!withData.has(date)"
        >
          {{ date }}
        </option>
      </select>
      <BaseButton v-if="tradeDate !== ''" variant="ghost" @click="emit('focusReset')">
        回到最新快照
      </BaseButton>
      <span class="ml-auto text-xs text-text-tertiary">宽度可拖拽</span>
    </div>
    <div class="min-h-0 flex-1">
      <BoardProfitBubblePanel
        :rows="viewRows"
        :trade-date="focusDate"
        :is-full-snapshot="isFullSnapshot"
      />
    </div>
  </div>
</template>
