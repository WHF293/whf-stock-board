<script setup lang="ts">
import {
  BOARD_DATA_LEVEL,
  BOARD_MAINLINE_COL_WIDTH,
  BOARD_MAINLINE_RANK_COL_WIDTH,
  BOARD_MAINLINE_ROW_HEIGHT,
  BOARD_MAINLINE_TOP_N,
} from '../../constants/board-calendar.constants';
import type { BoardMainlineCell, BoardMainlineMatrix } from '../../types/board-calendar.types';
import {
  getBoardBucketBackground,
  getBoardBucketTextColor,
  resolveBoardScoreBucket,
} from '../../utils/board-score-colors';

/**
 * 板块分析面板：行 = 每日得分绝对值名次位（1~N），列 = 交易日
 *
 * 读法：同一板块连续多天停在同一片区域 = 资金集中做主线；
 * 各列板块名频繁变换 = 市场在快速轮动。多空方向由色阶正负区分。
 * 单元格文案 =「板块名-涨停数/跌停数」，点击整格跳板块详情（页面处理路由）。
 *
 * 样式与「列表」视图的日历矩阵同款：平铺色块格 + 边框分隔 +
 * 吸顶表头 / 吸左名次列，hover 提亮（不用 BaseTable 的胶囊块）。
 */
defineProps<{
  /** 主线矩阵（dates 降序最近在左，ranks 与之按列对齐） */
  matrix: BoardMainlineMatrix;
}>();

const emit = defineEmits<{
  /** 单元格点击：携带该格板块数据，由页面负责跳转板块详情 */
  cellClick: [cell: BoardMainlineCell];
}>();

/** 星期文案（表头第二行，与日历矩阵一致） */
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 交易日 → 表头短文案（YYYY-MM-DD → MM-DD）
 * @param iso 交易日（ISO 日期）
 * @returns 月-日 文案
 */
const formatDayLabel = (iso: string): string => iso.slice(5);

/**
 * 列头星期文案
 * @param iso 交易日（ISO 日期）
 * @returns 形如「周一」
 */
const weekdayOf = (iso: string): string => {
  const parsed = new Date(`${iso}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : (WEEKDAY_LABELS[parsed.getDay()] ?? '');
};

/**
 * 单元格得分档位（回补日归为中性 = 无色，与日历矩阵同口径）
 * @param cell 单元格数据
 * @returns 色阶档位背景 / 文字色
 */
const cellStyle = (cell: BoardMainlineCell): Record<string, string> => {
  const scoreRate = cell.dataLevel === BOARD_DATA_LEVEL.FULL ? cell.scoreRate : 0;
  const bucket = resolveBoardScoreBucket(scoreRate);
  return {
    background: getBoardBucketBackground(bucket),
    color: getBoardBucketTextColor(bucket),
  };
};

/**
 * 单元格悬浮提示（完整口径：得分 / 得分率 / 涨跌停家数）
 * @param cell 单元格数据
 * @returns 提示文案
 */
const cellTitle = (cell: BoardMainlineCell): string =>
  `${cell.tradeDate} ${cell.boardName}\n` +
  `涨停 ${cell.limitUp} · 跌停 ${cell.limitDown}\n` +
  `得分 ${cell.score}（得分率 ${cell.scoreRate.toFixed(2)}）\n` +
  '点击查看板块详情';
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <p class="shrink-0 text-xs text-text-tertiary" role="note">
      每个交易日按得分绝对值取前 {{ BOARD_MAINLINE_TOP_N }} 名（无论多空，强弱由颜色区分），
      行 = 名次、列 = 日期（最近在左）；单元格 =「板块名-涨停数/跌停数」。
      同一板块连续在榜说明资金集中，各日频繁换名说明在快速轮动。点击单元格进板块详情。
    </p>
    <!-- 撑满卡片剩余高度：高度链由 theme.css 的 .board-calendar-fill 提供（flex 链上每层已 min-h-0） -->
    <div class="board-calendar-fill">
      <!-- 表头行：吸顶；名次列吸左（左上角双向固定） -->
      <div class="flex min-w-max border-b border-flat-weak">
        <div
          class="sticky left-0 top-0 z-30 flex shrink-0 items-center justify-center border-r border-flat-weak bg-surface text-xs font-medium text-text-secondary"
          :style="{ width: `${BOARD_MAINLINE_RANK_COL_WIDTH}px` }"
        >
          名次
        </div>
        <div
          v-for="date in matrix.dates"
          :key="date"
          class="sticky top-0 z-20 flex shrink-0 flex-col items-center justify-center gap-0.5 bg-surface"
          :style="{ width: `${BOARD_MAINLINE_COL_WIDTH}px` }"
        >
          <span class="text-xs font-medium text-text tabular-nums">{{ formatDayLabel(date) }}</span>
          <span class="text-[10px] text-text-tertiary">{{ weekdayOf(date) }}</span>
        </div>
      </div>

      <!-- 数据行：每行一个名次位 -->
      <div
        v-for="(cells, rankIndex) in matrix.ranks"
        :key="rankIndex"
        class="flex min-w-max border-b border-flat-weak last:border-0"
        :style="{ height: `${BOARD_MAINLINE_ROW_HEIGHT}px` }"
      >
        <div
          class="sticky left-0 z-10 flex shrink-0 items-center justify-center border-r border-flat-weak bg-surface text-xs font-medium text-text-tertiary tabular-nums"
          :style="{ width: `${BOARD_MAINLINE_RANK_COL_WIDTH}px` }"
        >
          {{ rankIndex + 1 }}
        </div>
        <button
          v-for="(date, dateIndex) in matrix.dates"
          :key="date"
          type="button"
          class="bc-cell pressable flex shrink-0 flex-col items-center justify-center gap-0.5 border-r border-flat-weak text-[11px] leading-tight"
          :class="cells[dateIndex] ? 'cursor-pointer' : 'cursor-default'"
          :style="
            cells[dateIndex]
              ? [{ width: `${BOARD_MAINLINE_COL_WIDTH}px` }, cellStyle(cells[dateIndex]!)]
              : { width: `${BOARD_MAINLINE_COL_WIDTH}px` }
          "
          :title="cells[dateIndex] ? cellTitle(cells[dateIndex]!) : `${date} 无该名次数据`"
          :disabled="!cells[dateIndex]"
          @click="cells[dateIndex] && emit('cellClick', cells[dateIndex]!)"
        >
          <template v-if="cells[dateIndex]">
            <span class="max-w-full truncate px-1 font-medium">{{ cells[dateIndex]!.boardName }}</span>
            <span class="tabular-nums opacity-90">
              {{ cells[dateIndex]!.limitUp }}/{{ cells[dateIndex]!.limitDown }}
            </span>
          </template>
          <span v-else class="text-[11px] text-text-tertiary">--</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 单元格 hover 提亮（与日历矩阵同款反馈） */
.bc-cell {
  transition: filter 0.15s ease;
}
.bc-cell:not(:disabled):hover {
  filter: brightness(1.12);
}
</style>
