<script setup lang="ts">
import { ref } from 'vue';
import MenuIcon from '../ui/MenuIcon.vue';
import {
  BOARD_CALENDAR_COL_OVERSCAN,
  BOARD_CALENDAR_COL_WIDTH,
  BOARD_CALENDAR_HEAD_HEIGHT,
  BOARD_CALENDAR_NAME_COL_WIDTH,
  BOARD_CALENDAR_ROW_HEIGHT,
} from '../../constants/board-calendar.constants';
import { useHorizontalVirtual } from '../../composables/use-horizontal-virtual';
import type {
  BoardCalendarCell,
  BoardCalendarMatrix,
  BoardCalendarRow,
} from '../../types/board-calendar.types';
import { getBoardBucketBackground, getBoardBucketTextColor } from '../../utils/board-score-colors';

/**
 * 板块日历矩阵
 *
 * 结构：横向滚动容器（theme.css 提供 max-height / flex 撑高 + overflow）
 * 内为「表头行 + N 个数据行」（N 由「板块过滤器」的勾选决定），每行为 flex：
 * 吸左首列（sticky left）+ 前置 spacer + 可视列（横向虚拟化）+ 尾部 spacer。
 *
 * 为什么不用 BaseTable：本组件是「日期 × 板块」的二维矩阵（列数可达上千、
 * 首列吸左 + 表头吸顶双向固定），BaseTable 的列配置模型不适配。
 *
 * 色阶：返回 `var(--color-*)` 由浏览器级联解析，明暗主题与涨跌配色主题切换
 * 自动生效，无需 JS 监听主题变化。
 */

const props = defineProps<{
  /** 矩阵数据（行已按热门口径降序，日期降序） */
  matrix: BoardCalendarMatrix;
  /**
   * 滚动容器类
   *
   * - 默认 `.board-calendar-scroll`：固定 max-height 760px 截断
   * - 板块日历页传 `.board-calendar-fill`：撑满卡片剩余高度
   *   （页面根部定高 → BaseCard fill → 本容器，链路上每层都要 min-h-0）
   */
  scrollClass?: string;
}>();

const emit = defineEmits<{
  /** 点击单元格（cell 为 null 表示该日无快照） */
  cellClick: [row: BoardCalendarRow, cell: BoardCalendarCell | null, tradeDate: string];
  /** 点击板块名称（跳板块详情页：成分股 × 交易日 涨跌幅矩阵） */
  boardClick: [row: BoardCalendarRow];
}>();

/** 横向滚动容器（虚拟化测量可视宽度用） */
const scrollRef = ref<HTMLElement | null>(null);

const { visibleIndexes, offsetX, tailWidth, onScroll } = useHorizontalVirtual({
  columnWidth: BOARD_CALENDAR_COL_WIDTH,
  columnCount: () => props.matrix.dates.length,
  scrollRef,
  overscan: BOARD_CALENDAR_COL_OVERSCAN,
});

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
 * @param cell 单元格（null 表示无数据）
 * @returns 行内样式
 */
const cellStyle = (cell: BoardCalendarCell | null): Record<string, string> => {
  if (!cell) {
    return {
      background: getBoardBucketBackground('none'),
      color: getBoardBucketTextColor('none'),
    };
  }
  return {
    background: getBoardBucketBackground(cell.bucket),
    color: getBoardBucketTextColor(cell.bucket),
  };
};

/**
 * 单元格提示文案（整格 title：无数据 / 回补日 / 正常）
 * @param cell 单元格
 * @param row 行
 * @param date 交易日
 * @returns 提示文案
 */
const cellTitle = (
  cell: BoardCalendarCell | null,
  row: BoardCalendarRow,
  date: string,
): string => {
  if (!cell) {
    return `${row.name} ${date}：该日无快照`;
  }
  const base =
    `${row.name} ${date}\n涨停 ${cell.limitUp} · 跌停 ${cell.limitDown}\n` +
    `上涨 ${cell.upCount} · 下跌 ${cell.downCount} · 成分股 ${cell.consCount}\n` +
    `得分 ${Math.round(cell.score)}（得分率 ${cell.scoreRate.toFixed(2)}）`;
  return cell.dataLevel === 0 ? `${base}\n该日仅回补到涨跌停数据，不参与色阶` : base;
};
</script>

<template>
  <div :class="scrollClass ?? 'board-calendar-scroll'" ref="scrollRef" @scroll="onScroll">
    <!-- 表头行：sticky top；首列另 sticky left（左上角双向固定，层级最高） -->
    <div
      class="flex border-b border-flat-weak"
      :style="{ height: `${BOARD_CALENDAR_HEAD_HEIGHT}px` }"
    >
      <div
        class="sticky left-0 top-0 z-30 flex shrink-0 items-center border-r border-flat-weak bg-surface px-3 text-xs font-medium text-text-secondary"
        :style="{ width: `${BOARD_CALENDAR_NAME_COL_WIDTH}px` }"
      >
        板块（{{ matrix.rows.length }}）
      </div>
      <div class="shrink-0" :style="{ width: `${offsetX}px` }" />
      <div
        v-for="index in visibleIndexes"
        :key="matrix.dates[index]"
        class="sticky top-0 z-20 flex shrink-0 flex-col items-center justify-center gap-0.5 bg-surface"
        :style="{ width: `${BOARD_CALENDAR_COL_WIDTH}px` }"
      >
        <span class="text-xs font-medium text-text">{{ shortDate(matrix.dates[index]) }}</span>
        <span class="text-[10px] text-text-tertiary">{{ weekdayOf(matrix.dates[index]) }}</span>
      </div>
      <div class="shrink-0" :style="{ width: `${tailWidth}px` }" />
    </div>

    <!-- 数据行：行高固定，不需要纵向虚拟化（36 行 × ~25 可视列 ≈ 900 节点） -->
    <div
      v-for="row in matrix.rows"
      :key="row.code"
      class="flex border-b border-flat-weak last:border-0"
      :style="{ height: `${BOARD_CALENDAR_ROW_HEIGHT}px` }"
    >
      <div
        class="sticky left-0 z-10 shrink-0 border-r border-flat-weak bg-surface"
        :style="{ width: `${BOARD_CALENDAR_NAME_COL_WIDTH}px` }"
      >
        <button
          type="button"
          class="pressable flex h-full w-full flex-col justify-center px-3 text-left hover:bg-flat-weak"
          :title="`${row.name} 成分股涨跌幅矩阵（点击进入板块详情）`"
          @click="emit('boardClick', row)"
        >
          <span class="bc-name truncate text-sm font-medium text-text">{{ row.name }}</span>
          <span class="truncate text-[10px] text-text-tertiary">
            {{ row.code }} · 近5日涨停 {{ row.heatLimitUp }}
          </span>
        </button>
      </div>
      <div class="shrink-0" :style="{ width: `${offsetX}px` }" />
      <button
        v-for="index in visibleIndexes"
        :key="`${row.code}-${matrix.dates[index]}`"
        type="button"
        class="bc-cell pressable flex shrink-0 flex-col items-center justify-center gap-0.5 border-r border-flat-weak text-[11px] leading-tight"
        :class="row.cells[index] ? 'cursor-pointer' : 'cursor-default'"
        :style="[{ width: `${BOARD_CALENDAR_COL_WIDTH}px` }, cellStyle(row.cells[index] ?? null)]"
        :title="cellTitle(row.cells[index] ?? null, row, matrix.dates[index])"
        :aria-label="`${row.name} ${matrix.dates[index]} 详情`"
        :disabled="!row.cells[index]"
        @click="emit('cellClick', row, row.cells[index] ?? null, matrix.dates[index])"
      >
        <template v-if="row.cells[index]">
          <span class="font-medium tabular-nums">涨停 {{ row.cells[index]?.limitUp }}</span>
          <span class="tabular-nums opacity-80">跌停 {{ row.cells[index]?.limitDown }}</span>
          <MenuIcon
            v-if="row.cells[index]?.dataLevel === 0"
            name="info"
            :size="10"
            class="absolute right-1 top-1 opacity-70"
          />
        </template>
        <span v-else class="text-[11px]">--</span>
      </button>
      <div class="shrink-0" :style="{ width: `${tailWidth}px` }" />
    </div>
  </div>
</template>

<style scoped>
/* 单元格需要相对定位承载右上角的「回补日」标记 */
.bc-cell {
  position: relative;
  transition: filter 0.15s ease;
}
.bc-cell:not(:disabled):hover {
  filter: brightness(1.12);
}

/* 首列可点击的暗示：hover 时板块名加下划线（与板块详情页首列同一套反馈） */
.bc-name {
  text-decoration-color: transparent;
  text-underline-offset: 2px;
  transition: text-decoration-color 0.15s ease;
}
button:hover .bc-name {
  text-decoration: underline;
  text-decoration-color: currentColor;
}
</style>
