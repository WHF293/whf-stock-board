<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  BOARD_DETAIL_CLICK_MERGE_MS,
  BOARD_DETAIL_COL_OVERSCAN,
  BOARD_DETAIL_COL_WIDTH,
  BOARD_DETAIL_HEAD_HEIGHT,
  BOARD_DETAIL_NAME_COL_WIDTH,
  BOARD_DETAIL_ROW_CHUNK,
  BOARD_DETAIL_ROW_HEIGHT,
} from '../../constants/board-detail.constants';
import { useHorizontalVirtual } from '../../composables/use-horizontal-virtual';
import { useLazyRows } from '../../composables/use-lazy-rows';
import type { BoardDetailMatrix, BoardDetailRow } from '../../types/board-detail.types';
import { getBoardBucketBackground, getBoardBucketTextColor } from '../../utils/board-score-colors';
import { resolveChangePercentBucket } from '../../utils/change-percent-bucket';
import { formatPercent } from '../../utils/format-percent';

/**
 * 板块日历详情页矩阵（成分股为行 × 交易日为列，格内为该股当日涨跌幅）
 *
 * 结构同 `BoardCalendarGrid`：横向滚动容器内为「表头行 + N 个数据行」，每行是 flex
 * （吸左首列 + 前置 spacer + 可视列 + 尾部 spacer）。两处规模差异决定了另外两个措施：
 *
 * - **列**：可达 120 天 → 横向虚拟化（`useHorizontalVirtual`）
 * - **行**：大板块 500+ 只成分股 → 行懒加载（`useLazyRows`，首屏只渲染 80 行）
 *
 * 色阶：7 档涨跌语义色，档位由 `resolveChangePercentBucket` 按 ±2 / ±5 判定；
 * 颜色返回 `var(--color-*)`，明暗主题与涨跌配色主题切换自动生效。
 */

const props = defineProps<{
  /** 矩阵数据（行已按当前口径降序，日期降序） */
  matrix: BoardDetailMatrix;
  /** 当前用作排序基准的交易日（该列列头高亮）；区间累计口径下传空串 */
  sortDate: string;
  /**
   * 滚动容器类
   *
   * - 默认 `.board-calendar-scroll`：固定 max-height 760px 截断
   * - 详情页传 `.board-calendar-fill`：撑满卡片剩余高度
   */
  scrollClass?: string;
}>();

const emit = defineEmits<{
  /** 点击列头：请求按该交易日排序 */
  columnClick: [tradeDate: string];
  /** 单击成分股：打开右侧个股详情侧栏 */
  stockClick: [row: BoardDetailRow];
  /** 双击成分股：跳转股票详情整页 */
  stockDblclick: [row: BoardDetailRow];
}>();

/** 横向滚动容器（虚拟化测量可视宽度用） */
const scrollRef = ref<HTMLElement | null>(null);

const { visibleIndexes, offsetX, tailWidth, onScroll: onHorizontalScroll } = useHorizontalVirtual({
  columnWidth: BOARD_DETAIL_COL_WIDTH,
  columnCount: () => props.matrix.dates.length,
  scrollRef,
  overscan: BOARD_DETAIL_COL_OVERSCAN,
});

const {
  rows: lazyRows,
  total: rowTotal,
  hasMore,
  onScroll: onVerticalScroll,
} = useLazyRows<BoardDetailRow>(() => props.matrix.rows, BOARD_DETAIL_ROW_CHUNK);

/** 矩阵行数（懒加载提示用；props.matrix.rows 的完整长度） */
const fullRowCount = computed<number>(() => props.matrix.rows.length);

/**
 * 滚动事件：横向虚拟化与行懒加载共用一个滚动容器
 * @param event 原生滚动事件
 */
const handleScroll = (event: Event): void => {
  onHorizontalScroll(event);
  onVerticalScroll(event);
};

/** 星期文案（列头第二行） */
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 列头日期文案（`2026-09-14` → `09-14`）
 * @param date 交易日
 * @returns MM-DD
 */
const shortDate = (date: string): string => date.slice(5);

/**
 * 列头星期文案
 * @param date 交易日
 * @returns 形如「周一」
 */
const weekdayOf = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : (WEEKDAY_LABELS[parsed.getDay()] ?? '');
};

/**
 * 单元格行内样式：背景取档位色，文字色按浅 / 深档自适应
 * @param changePercent 该股该日涨跌幅（null 表示无行情）
 * @returns 行内样式
 */
const cellStyle = (changePercent: number | null): Record<string, string> => {
  const bucket = resolveChangePercentBucket(changePercent);
  return {
    background: getBoardBucketBackground(bucket),
    color: getBoardBucketTextColor(bucket),
  };
};

/** 单击延迟派发定时器（双击合并窗口） */
let pendingClickTimer: number | null = null;

/** 待派发的单击所属股票代码 */
let pendingClickSymbol = '';

/**
 * 成分股单击：延迟派发，窗口内收到双击则取消（与 BaseTable 的 enableDblclickNav 同法）
 * @param row 行数据
 */
const onStockClick = (row: BoardDetailRow): void => {
  if (pendingClickTimer !== null) {
    window.clearTimeout(pendingClickTimer);
  }
  pendingClickSymbol = row.symbol;
  pendingClickTimer = window.setTimeout(() => {
    pendingClickTimer = null;
    emit('stockClick', row);
  }, BOARD_DETAIL_CLICK_MERGE_MS);
};

/**
 * 成分股双击：取消未派发的单击，直接派发双击
 * @param row 行数据
 */
const onStockDblclick = (row: BoardDetailRow): void => {
  if (pendingClickTimer !== null) {
    window.clearTimeout(pendingClickTimer);
    pendingClickTimer = null;
  }
  if (pendingClickSymbol === row.symbol) {
    pendingClickSymbol = '';
  }
  emit('stockDblclick', row);
};
</script>

<template>
  <div :class="scrollClass ?? 'board-calendar-scroll'" ref="scrollRef" @scroll="handleScroll">
    <!-- 表头行：sticky top；首列另 sticky left（左上角双向固定，层级最高） -->
    <div
      class="flex border-b border-flat-weak"
      :style="{ height: `${BOARD_DETAIL_HEAD_HEIGHT}px` }"
    >
      <div
        class="sticky left-0 top-0 z-30 flex shrink-0 items-center border-r border-flat-weak bg-surface px-3 text-xs font-medium text-text-secondary"
        :style="{ width: `${BOARD_DETAIL_NAME_COL_WIDTH}px` }"
      >
        成分股（{{ fullRowCount }}）
      </div>
      <div class="shrink-0" :style="{ width: `${offsetX}px` }" />
      <button
        v-for="index in visibleIndexes"
        :key="matrix.dates[index]"
        type="button"
        class="pressable sticky top-0 z-20 flex shrink-0 flex-col items-center justify-center gap-0.5 hover:bg-flat-weak"
        :class="
          matrix.dates[index] === sortDate
            ? 'bg-primary-weak font-semibold text-primary'
            : 'bg-surface text-text'
        "
        :style="{ width: `${BOARD_DETAIL_COL_WIDTH}px` }"
        :title="`按 ${matrix.dates[index]} 涨跌幅排序（降序）`"
        @click="emit('columnClick', matrix.dates[index])"
      >
        <span class="text-xs font-medium">{{ shortDate(matrix.dates[index]) }}</span>
        <span class="text-[10px] opacity-70">{{ weekdayOf(matrix.dates[index]) }}</span>
      </button>
      <div class="shrink-0" :style="{ width: `${tailWidth}px` }" />
    </div>

    <!-- 数据行：高度固定（横向虚拟化 + 行懒加载的前提），首列 sticky left -->
    <div
      v-for="row in lazyRows"
      :key="row.symbol"
      class="flex items-stretch border-b border-flat-weak last:border-0"
      :style="{ height: `${BOARD_DETAIL_ROW_HEIGHT}px` }"
    >
      <div
        class="sticky left-0 z-10 shrink-0 border-r border-flat-weak bg-surface"
        :style="{ width: `${BOARD_DETAIL_NAME_COL_WIDTH}px` }"
      >
        <button
          type="button"
          class="pressable flex h-full w-full items-center gap-2 px-3 text-left hover:bg-flat-weak"
          :title="`${row.name} ${row.symbol}（单击查看侧栏详情，双击进入详情页）`"
          @click="onStockClick(row)"
          @dblclick="onStockDblclick(row)"
        >
          <span class="bd-name truncate text-xs font-medium text-text">{{ row.name }}</span>
          <span class="shrink-0 text-[10px] text-text-tertiary">{{ row.symbol }}</span>
        </button>
      </div>
      <div class="shrink-0" :style="{ width: `${offsetX}px` }" />
      <div
        v-for="index in visibleIndexes"
        :key="`${row.symbol}-${matrix.dates[index]}`"
        class="flex shrink-0 items-center justify-center border-r border-flat-weak text-[11px] tabular-nums"
        :class="matrix.dates[index] === sortDate ? 'bc-sort-col' : ''"
        :style="[{ width: `${BOARD_DETAIL_COL_WIDTH}px` }, cellStyle(row.cells[index] ?? null)]"
        :title="`${row.name} ${matrix.dates[index]}：${formatPercent(row.cells[index] ?? null)}`"
      >
        {{ formatPercent(row.cells[index] ?? null) }}
      </div>
      <div class="shrink-0" :style="{ width: `${tailWidth}px` }" />
    </div>

    <!-- 行懒加载提示（首屏只渲染前 N 行，滚动到底部继续放行） -->
    <div
      v-if="hasMore"
      class="flex h-8 items-center justify-center text-[11px] text-text-tertiary"
    >
      已显示 {{ lazyRows.length }} / {{ rowTotal }} 只，向下滚动继续加载
    </div>
  </div>
</template>

<style scoped>
/* 排序基准列的纵向引导线：滚动到深处时不至于看不清「按哪一天排的」 */
.bc-sort-col {
  box-shadow:
    inset 1px 0 0 0 var(--color-primary),
    inset -1px 0 0 0 var(--color-primary);
}

/* 首列可点击的暗示：hover 时名称加下划线（不额外塞图标，避免 500 行的视觉噪音） */
.bd-name {
  text-decoration-color: transparent;
  text-underline-offset: 2px;
  transition: text-decoration-color 0.15s ease;
}
button:hover .bd-name {
  text-decoration: underline;
  text-decoration-color: currentColor;
}
</style>
