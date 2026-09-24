<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BoardDetailMatrix from '../components/business/BoardDetailMatrix.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import NoticeBar from '../components/ui/NoticeBar.vue';
import { loadBoardDetailMatrix } from '../api/board-detail.api';
import { getTradingDates } from '../composables/use-board-calendar-sync';
import {
  BOARD_DETAIL_LEGEND,
  BOARD_DETAIL_RANGE_OPTIONS,
  BOARD_DETAIL_SORT,
  BOARD_DETAIL_SORT_DEFAULT,
  BOARD_DETAIL_SORT_OPTIONS,
} from '../constants/board-detail.constants';
import { CALENDAR_BOARDS } from '../constants/board-calendar.constants';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants';
import { ROUTE_PATH } from '../constants/router-meta.constants';
import { useDataCacheStore } from '../stores/data-cache';
import { useSettingsStore } from '../stores/settings';
import type {
  BoardDetailLoadResult,
  BoardDetailRange,
  BoardDetailRow,
  BoardDetailSortBasis,
} from '../types/board-detail.types';
import type { BoardScoreBucket } from '../types/board-calendar.types';
import { getBoardBucketBackground } from '../utils/board-score-colors';
import { formatRelativeTime } from '../utils/format-relative-time';
import { handleSdkError } from '../utils/handle-sdk-error';
import { isAnalysisAborted } from '../utils/map-with-concurrency';
import { sortBoardDetailRows } from '../utils/sort-board-detail-rows';
import { useStockOpen } from '../composables/use-stock-open';

/**
 * 板块日历详情（/board-detail/:code）——「板块成分股 × 交易日」涨跌幅矩阵
 *
 * 从板块日历页点击板块名称进入。行 = 该板块全部成分股，列 = 交易日（降序，最近在左），
 * 格内 = 该股当日涨跌幅；行恒按涨跌幅降序（大的在上，小的在下），
 * 排序基准可在「最新一日 / 指定某日（点列头）/ 区间累计」之间切换。
 *
 * 关于取数成本：一个板块 = 成分股数条请求（腾讯日 K 无批量通道，见 api 文件注释），
 * 小板块 20 条、最大板块 500+ 条。因此本页**不轮询**（守 SERVER_API 的频率红线），
 * 只在进入 / 换范围 / 手动刷新时取数，并靠会话级序列缓存 + 在途去重避免重复请求。
 */

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const dataCache = useDataCacheStore();
const { openSidebar, openPage } = useStockOpen();

/** 板块代码（BKxxxx） */
const boardCode = computed<string>(() => String(route.params.code ?? ''));

/** 板块池里的档案（名称 / 行序）；不在板块池中时为 null */
const boardMeta = computed(() => CALENDAR_BOARDS.find((item) => item.code === boardCode.value) ?? null);

/** 板块展示名（不在板块池中时退回代码） */
const boardName = computed<string>(() => boardMeta.value?.name ?? boardCode.value);

/** 交易日轴（升序，与板块日历页共用同一份采集层缓存） */
const tradingDates = ref<string[]>([]);
/** 成分股矩阵行（未排序；排序口径属于视图层） */
const rows = ref<BoardDetailRow[]>([]);
/** 成分股总数 / 取数失败票数 / 成分股来源 */
const total = ref(0);
const failed = ref(0);
const source = ref<BoardDetailLoadResult['source']>('db');
/** 取数中 / 强制刷新中 */
const isLoading = ref(false);
/** 已完成票数 / 本轮总票数（进度展示；总数在首条进度回调前为 0） */
const progressDone = ref(0);
const progressTotal = ref(0);
/** 页面级错误提示 */
const errorText = ref<string | null>(null);
/** 最近一次成功取数时间 */
const lastUpdatedAt = ref<number | null>(null);

/** 排序基准：默认按某一交易日的涨跌幅 */
const sortBasis = ref<BoardDetailSortBasis>(BOARD_DETAIL_SORT_DEFAULT);
/** 排序基准交易日（null = 跟随最新一个交易日） */
const sortDate = ref<string | null>(null);

/** 当前范围对应的列数 */
const rangeLimit = computed<number>(() => Number(settingsStore.boardDetailRange));

/** 需要展示的交易日（降序，最近在左） */
const selectedDates = computed<string[]>(() => {
  const descending = [...tradingDates.value].reverse();
  return descending.slice(0, rangeLimit.value);
});

/** 实际用于排序的交易日（区间累计口径下为空串，表示「不针对某一列」） */
const effectiveSortDate = computed<string>(() => {
  if (sortBasis.value === BOARD_DETAIL_SORT.CUMULATIVE) return '';
  return sortDate.value ?? selectedDates.value[0] ?? '';
});

/** 排序基准列在 selectedDates 中的下标（区间累计口径下标无效） */
const sortDateIndex = computed<number>(() => selectedDates.value.indexOf(effectiveSortDate.value));

/** 会话缓存键（板块 + 范围：不同范围的单元格窗口不可混用） */
const cacheKey = computed<string>(
  () => `${DATA_CACHE_KEY.BOARD_DETAIL_MATRIX_PREFIX}${boardCode.value}:${settingsStore.boardDetailRange}`,
);

/** 渲染矩阵：列 = 交易日降序，行 = 按当前口径降序排列的成分股 */
const matrix = computed(() => ({
  dates: selectedDates.value,
  rows: sortBoardDetailRows(
    rows.value,
    sortBasis.value,
    sortDateIndex.value < 0 ? 0 : sortDateIndex.value,
  ),
}));

/** 是否处于「非最新一日」的手动排序（用于显示「回到最新一日」） */
const isManualSortDate = computed<boolean>(
  () => sortBasis.value === BOARD_DETAIL_SORT.DATE && effectiveSortDate.value !== (selectedDates.value[0] ?? ''),
);

/** 取数进度文案（总数取自进度回调：成分股数是取数阶段才知道的，不能用卡片里的旧值） */
const progressText = computed<string>(() =>
  isLoading.value && progressTotal.value > 0
    ? `取数中 ${progressDone.value}/${progressTotal.value} 只`
    : '',
);

/** 卡片标题 */
const cardTitle = computed<string>(
  () =>
    `${boardName.value} ${boardCode.value} · 成分股 ${rows.value.length}` +
    (failed.value > 0 ? `（${failed.value} 只未取到）` : '') +
    ` · ${selectedDates.value.length} 个交易日`,
);

/** 空态文案 */
const emptyText = computed<string>(() =>
  selectedDates.value.length === 0
    ? '暂无交易日轴，请点击右上角「刷新」重试'
    : '暂无成分股数据：该板块成分股尚未同步（桌面端等待采集）或上游不可用',
);

/** 正在进行的一轮取数（换范围 / 换板块时中断上一轮） */
let controller: AbortController | null = null;

/**
 * 载入矩阵数据
 * @param options 载入选项
 * @param options.useCache 是否先用会话缓存播种（进入页面与换范围时为 true，静默刷新时不播种）
 */
const load = async (options?: { useCache?: boolean }): Promise<void> => {
  const code = boardCode.value;
  if (code === '') return;
  if (options?.useCache === true) {
    const cached = dataCache.get<{ result: BoardDetailLoadResult; dates: string[] }>(cacheKey.value);
    if (cached && cached.result.rows.length > 0) {
      rows.value = cached.result.rows;
      total.value = cached.result.total;
      failed.value = cached.result.failed;
      source.value = cached.result.source;
      tradingDates.value = cached.dates;
    }
  }

  controller?.abort();
  const current = new AbortController();
  controller = current;
  isLoading.value = true;
  progressDone.value = 0;
  progressTotal.value = 0;
  try {
    const dates = await getTradingDates(false);
    tradingDates.value = dates;
    const window = selectedDates.value;
    const result = await loadBoardDetailMatrix({
      boardCode: code,
      dates: window,
      signal: current.signal,
      onProgress: (completed) => {
        progressDone.value = completed;
      },
    });
    if (current.signal.aborted) return;
    rows.value = result.rows;
    total.value = result.total;
    failed.value = result.failed;
    source.value = result.source;
    lastUpdatedAt.value = Date.now();
    errorText.value = null;
    dataCache.set(cacheKey.value, { result, dates });
  } catch (error) {
    if (isAnalysisAborted(error) || current.signal.aborted) return;
    console.error('[board-detail]', handleSdkError(error));
    errorText.value = '板块成分股行情取数失败，请检查网络后点击「刷新」重试';
  } finally {
    if (controller === current) {
      isLoading.value = false;
      controller = null;
    }
  }
};

/* ------------------------------- 交互 ------------------------------- */

/**
 * 点击列头：按该交易日涨跌幅降序排（再点一次同一天不做切换，方向恒为降序）
 * @param tradeDate 交易日
 */
const onColumnClick = (tradeDate: string): void => {
  sortBasis.value = BOARD_DETAIL_SORT.DATE;
  sortDate.value = tradeDate;
};

/** 回到「按最新一个交易日」排序 */
const resetSortDate = (): void => {
  sortBasis.value = BOARD_DETAIL_SORT.DATE;
  sortDate.value = null;
};

/**
 * 切换排序基准
 * @param value 新的基准（BaseTabs 给字符串，收敛到 BoardDetailSortBasis）
 */
const onSortBasisChange = (value: string): void => {
  sortBasis.value = value === BOARD_DETAIL_SORT.CUMULATIVE ? BOARD_DETAIL_SORT.CUMULATIVE : BOARD_DETAIL_SORT.DATE;
};

/**
 * 切换展示范围（写设置，随后 watch 触发重新取数）
 * @param value 新的范围
 */
const onRangeChange = (value: string): void => {
  settingsStore.setBoardDetailRange(value as BoardDetailRange);
};

/**
 * 成分股单击：打开右侧个股详情侧栏（全站约定）
 * @param row 行数据
 */
const onStockClick = (row: BoardDetailRow): void => {
  openSidebar(
    row.fullSymbol,
    rows.value.map((item) => ({
      symbol: item.fullSymbol,
      name: item.name,
      price: null,
      changePercent: item.latest,
    })),
  );
};

/**
 * 成分股双击：进入股票详情整页
 * @param row 行数据
 */
const onStockDblclick = (row: BoardDetailRow): void => {
  openPage(
    row.fullSymbol,
    rows.value.map((item) => ({
      symbol: item.fullSymbol,
      name: item.name,
      price: null,
      changePercent: item.latest,
    })),
  );
};

/** 返回板块日历看板（用 push 而非 back：直接打开本页 / 刷新后 back 会退出应用） */
const goBack = (): void => {
  void router.push(ROUTE_PATH.BOARD_CALENDAR);
};

/**
 * 图例色块样式（背景取档位色，随主题级联自动变化）
 * @param bucket 色阶档位
 * @returns 行内样式
 */
const legendSwatchStyle = (bucket: BoardScoreBucket): Record<string, string> => ({
  background: getBoardBucketBackground(bucket),
});

// 范围变化 → 重新取数（会话缓存按「板块 + 范围」分键，同范围切回可秒出）
watch(() => settingsStore.boardDetailRange, () => {
  void load({ useCache: true });
});

onMounted(() => {
  void load({ useCache: true });
});

onBeforeUnmount(() => {
  controller?.abort();
  controller = null;
});

/** 口径说明（文案随常量推导，改阈值自动同步） */
const NOTICE_TEXT =
  '格内为成分股当日涨跌幅（腾讯前复权日 K 相邻收盘比，除权日不失真）。' +
  '行恒按涨跌幅降序：默认取最新一个交易日，点任意列头改按那天排，「区间累计」按窗口内累计涨跌幅排。' +
  '逐票取数（腾讯日 K 无批量通道，一个板块 = 成分股数条请求），故本页不轮询 —— 需要最新数据请点「刷新」。' +
  '成分为当前成分，历史成分变动（新股 / 剔除）不在还原范围内。';
</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] min-h-0 flex-col gap-4">
    <!-- 控制条：返回 / 板块标识 / 排序基准 / 范围 -->
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <BaseButton variant="ghost" title="返回板块日历" @click="goBack">
          <MenuIcon name="arrowLeft" :size="14" />
          板块日历
        </BaseButton>
        <span class="text-sm font-semibold text-text">{{ boardName }}</span>
        <span class="text-xs text-text-tertiary">{{ boardCode }}</span>
        <BaseTabs
          :model-value="sortBasis"
          :options="BOARD_DETAIL_SORT_OPTIONS"
          @update:model-value="onSortBasisChange"
        />
        <BaseTabs
          :model-value="settingsStore.boardDetailRange"
          :options="BOARD_DETAIL_RANGE_OPTIONS"
          @update:model-value="onRangeChange"
        />
        <button
          v-if="isManualSortDate"
          type="button"
          class="pressable rounded-lg px-1.5 py-1 text-xs text-primary hover:underline"
          title="回到按最新一个交易日排序"
          @click="resetSortDate"
        >
          回到最新一日
        </button>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-text-tertiary">
          <template v-if="progressText">{{ progressText }} · </template>
          <template v-else-if="lastUpdatedAt">更新于 {{ formatRelativeTime(lastUpdatedAt) }} · </template>
          按 {{ effectiveSortDate || '区间累计' }} 排序
        </span>
        <BaseButton variant="ghost" :disabled="isLoading" @click="load()">
          <MenuIcon name="refresh" :size="14" />
          {{ isLoading ? '取数中…' : '刷新' }}
        </BaseButton>
      </div>
    </div>

    <NoticeBar :text="NOTICE_TEXT" />

    <p v-if="source === 'upstream'" class="text-xs text-text-tertiary" role="note">
      当前成分股取自上游实时成分（本地库尚未建立该板块映射）：历史区间内的成分变动不会被还原。
    </p>

    <p v-if="errorText" class="text-xs text-down" role="alert">{{ errorText }}</p>

    <!-- 矩阵卡片：矩阵是卡片的直接 flex 子项，用 board-calendar-fill 吃满剩余高度 -->
    <BaseCard fill class="min-h-0 flex-1" :title="cardTitle">
      <template #extra>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-tertiary">
          <span v-for="item in BOARD_DETAIL_LEGEND" :key="item.bucket" class="flex items-center gap-1">
            <i class="inline-block h-3 w-3 rounded-sm" :style="legendSwatchStyle(item.bucket)" />
            {{ item.label }} {{ item.hint }}
          </span>
          <span class="flex items-center gap-1">
            <i class="inline-block h-3 w-3 rounded-sm border border-dashed border-flat-weak" />
            无行情
          </span>
        </div>
      </template>

      <BaseSkeleton v-if="isLoading && matrix.rows.length === 0" />
      <BaseEmpty
        v-else-if="matrix.rows.length === 0 || matrix.dates.length === 0"
        :text="emptyText"
      />
      <BoardDetailMatrix
        v-else
        :matrix="matrix"
        :sort-date="effectiveSortDate"
        scroll-class="board-calendar-fill"
        @column-click="onColumnClick"
        @stock-click="onStockClick"
        @stock-dblclick="onStockDblclick"
      />
    </BaseCard>
  </div>
</template>
