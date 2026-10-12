<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { HeatmapBoard } from '../../common/types/board.types';
import { getTrendColorCss } from '../../common/utils/trend-colors';
import { squarifyTreemap } from '../utils/treemap.utils';

/**
 * 板块热力图（移动端）：Squarified treemap 纯 SVG 渲染（无 ECharts 依赖，控制移动包体）
 *
 * 格子面积 ∝ 板块总市值（√ 压缩，避免头部市值集中导致尾部细条），颜色 = 涨跌幅四档色阶
 * （getTrendColorCss，随主题 / 暗色自适应）；格子足够大时显示 板块名 + 涨跌幅，过小则省略 label。
 */

const props = defineProps<{
  /** 热力图数据（Top N 板块，按市值权重） */
  boards: HeatmapBoard[];
  /** 加载中（骨架态） */
  loading?: boolean;
  /** 加载失败态 */
  error?: boolean;
}>();

/** 点击板块格子（对齐 PC 下钻交互：弹成分股列表） */
const emit = defineEmits<{
  select: [board: HeatmapBoard];
}>();

/** 图高（像素）：默认档；实际渲染随容器（.m-heat-box flex 撑满）量高自适应 */
const CHART_HEIGHT = 232;

/** 容器宽（onMounted 量取；resize 重算） */
const boxWidth = ref(358);
/** 容器高（跟随 flex 撑满的 .m-heat-box 量取） */
const boxHeight = ref(CHART_HEIGHT);
const boxEl = ref<HTMLElement | null>(null);

/** name → 板块（布局矩形反查数据用） */
const boardByName = computed(() => new Map(props.boards.map((board) => [board.name, board])));

/** 布局矩形（渲染内缩 1px 间隙；带板块引用供颜色与 label）
 *  ⚠️ 布局权重 = √总市值：头部板块市值是尾部的 5~10 倍，线性映射会让尾部挤成细条
 *  （王总 2026-10-12 截图反馈）；开方压缩后大小关系与顺序不变，但每格都能占住可读面积 */
const rects = computed(() =>
  squarifyTreemap(
    props.boards.map((board) => ({ name: board.name, value: Math.sqrt(board.weight) })),
    boxWidth.value,
    boxHeight.value,
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

/** 量宽高并重排（rAF 合并，避免 resize 抖动） */
const measure = (): void => {
  if (!boxEl.value) return;
  boxWidth.value = Math.max(boxEl.value.clientWidth, 100);
  boxHeight.value = Math.max(boxEl.value.clientHeight, CHART_HEIGHT);
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
  <div ref="boxEl" class="m-heat-box">
    <div v-if="props.loading" class="m-state m-heat-state">
      <van-loading size="28" />
      板块数据加载中…
    </div>
    <div v-else-if="props.error" class="m-state m-heat-state">
      <van-icon name="warning-o" size="32" />
      板块数据加载失败
    </div>
    <div v-else-if="props.boards.length === 0" class="m-state m-heat-state">
      <van-icon name="chart-trending-o" size="32" />
      暂无数据
    </div>
    <svg
      v-else
      :viewBox="`0 0 ${boxWidth} ${boxHeight}`"
      :style="{ width: '100%', height: `${boxHeight}px`, display: 'block' }"
      role="img"
      aria-label="板块热力图（面积∝总市值，颜色=涨跌幅）"
    >
      <g
        v-for="rect in rects"
        :key="rect.name"
        class="hm-cell"
        @click="rect.board && emit('select', rect.board)"
      >
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
/* 根容器：随 flex 父级（.m-home-heat）撑满卡片剩余高度，状态态居中不空旷 */
.m-heat-box { flex: 1 1 auto; min-height: 232px; }
.m-heat-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-3);
}
.hm-name { font-size: 10.5px; font-weight: 700; fill: #fff; pointer-events: none; }
.hm-pct { font-size: 9.5px; font-weight: 600; fill: rgb(255 255 255 / 0.92); pointer-events: none; }
/* 格子可点（下钻成分股弹窗）：按压轻微提亮反馈 */
.hm-cell { cursor: pointer; }
.hm-cell:active { opacity: 0.85; }
</style>
