<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { HeatmapBoard } from '../../common/types/board.types';
import { getTrendColorCss } from '../../common/utils/trend-colors';
import { squarifyTreemap } from '../utils/treemap.utils';

/**
 * 板块热力图（移动端）：Squarified treemap 纯 SVG 渲染（无 ECharts 依赖，控制移动包体）
 *
 * 格子面积 = 板块总市值权重，颜色 = 涨跌幅四档色阶（getTrendColorCss，随主题 / 暗色自适应）；
 * 格子足够大时显示 板块名 + 涨跌幅，过小则省略 label。与 PC 市场总览热力图同数据同色口径。
 */

const props = defineProps<{
  /** 热力图数据（Top N 板块，按市值权重） */
  boards: HeatmapBoard[];
  /** 加载中（骨架态） */
  loading?: boolean;
  /** 加载失败态 */
  error?: boolean;
}>();

/** 图高（像素；移动端固定，不做 PC 的多档高度） */
const CHART_HEIGHT = 232;

/** 容器宽（onMounted 量取；resize 重算） */
const boxWidth = ref(358);
const boxEl = ref<HTMLElement | null>(null);

/** name → 板块（布局矩形反查数据用） */
const boardByName = computed(() => new Map(props.boards.map((board) => [board.name, board])));

/** 布局矩形（渲染内缩 1px 间隙；带板块引用供颜色与 label） */
const rects = computed(() =>
  squarifyTreemap(
    props.boards.map((board) => ({ name: board.name, value: board.weight })),
    boxWidth.value,
    CHART_HEIGHT,
  ).map((rect) => {
    const board = boardByName.value.get(rect.name);
    return {
      ...rect,
      x: rect.x + 1,
      y: rect.y + 1,
      w: Math.max(rect.w - 2, 0),
      h: Math.max(rect.h - 2, 0),
      board,
    };
  }),
);

/**
 * 格子填充色（涨跌幅四档色阶，实时读 token——主题 / 涨跌配色自动跟随）
 * @param changePercent 涨跌幅
 * @returns 颜色值
 */
const fillOf = (changePercent: number): string => getTrendColorCss(changePercent);

/**
 * 格子涨跌幅文案（带符号）
 * @param board 格子板块
 * @returns 形如 `+3.25%`
 */
const pctText = (board: HeatmapBoard): string =>
  `${board.changePercent > 0 ? '+' : ''}${board.changePercent.toFixed(2)}%`;

/** 量宽并重排（rAF 合并，避免 resize 抖动） */
const measure = (): void => {
  if (boxEl.value) boxWidth.value = Math.max(boxEl.value.clientWidth, 100);
};
let rafId = 0;
const onResize = (): void => {
  window.cancelAnimationFrame(rafId);
  rafId = window.requestAnimationFrame(measure);
};

onMounted(() => {
  measure();
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => {
  window.cancelAnimationFrame(rafId);
  window.removeEventListener('resize', onResize);
});
</script>

<template>
  <div ref="boxEl">
    <div v-if="props.loading" class="m-state">板块数据加载中…</div>
    <div v-else-if="props.error" class="m-state">板块数据加载失败</div>
    <div v-else-if="props.boards.length === 0" class="m-state">暂无数据</div>
    <svg
      v-else
      :viewBox="`0 0 ${boxWidth} ${CHART_HEIGHT}`"
      :style="{ width: '100%', height: `${CHART_HEIGHT}px`, display: 'block' }"
      role="img"
      aria-label="板块热力图（面积=总市值，颜色=涨跌幅）"
    >
      <g v-for="rect in rects" :key="rect.name">
        <rect
          :x="rect.x"
          :y="rect.y"
          :width="rect.w"
          :height="rect.h"
          rx="3"
          :fill="fillOf(rect.board ? rect.board.changePercent : 0)"
        >
          <title v-if="rect.board">{{ rect.name }} · {{ pctText(rect.board) }}</title>
        </rect>
        <text
          v-if="rect.w > 46 && rect.h > 20"
          :x="rect.x + rect.w / 2"
          :y="rect.y + rect.h / 2 + (rect.h > 42 ? -5 : 4)"
          text-anchor="middle"
          class="hm-name"
        >{{ rect.name }}</text>
        <text
          v-if="rect.w > 64 && rect.h > 42 && rect.board"
          :x="rect.x + rect.w / 2"
          :y="rect.y + rect.h / 2 + 12"
          text-anchor="middle"
          class="hm-pct"
        >{{ pctText(rect.board) }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.hm-name { font-size: 10.5px; font-weight: 700; fill: #fff; pointer-events: none; }
.hm-pct { font-size: 9.5px; font-weight: 600; fill: rgb(255 255 255 / 0.92); pointer-events: none; }
</style>
