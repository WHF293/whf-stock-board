<script setup lang="ts">
import { computed } from 'vue';
import type { BreadthPoint } from '../../common/types/market-breadth.types.ts';
import { ARMS_NEUTRAL_LINE } from '../../common/constants/market-breadth.constants.ts';

/**
 * ARMS 分时 sparkline（移动端首页自绘 SVG，不引 ECharts 控制首屏体积）
 *
 * 曲线 + y=1 平衡虚线 + 末点圆点；配色走 mobile.css 语义 CSS 变量
 * （--color-primary 曲线 / --color-text-3 参考线，暗色自动跟随）
 */
const { points } = defineProps<{
  /** 当日分钟点序列（升序，随快照轮询增长） */
  points: BreadthPoint[];
}>();

/** 视窗尺寸（viewBox；容器按宽度 100% 等比缩放） */
const VIEW_W = 362;
const VIEW_H = 104;
const PAD_L = 30;
const PAD_R = 8;
const PAD_T = 6;
const PAD_B = 8;

/** y 值域（ARMS 极端值裁剪到可视域，防单点拉爆曲线） */
const Y_MIN = 0.6;
const Y_MAX = 1.6;

/**
 * ARMS 值 → y 坐标（域外裁剪）
 * @param value ARMS 值
 * @returns y 像素
 */
const toY = (value: number): number => {
  const clamped = Math.min(Y_MAX, Math.max(Y_MIN, value));
  return PAD_T + (VIEW_H - PAD_T - PAD_B) * (1 - (clamped - Y_MIN) / (Y_MAX - Y_MIN));
};

/** 平衡线 y 坐标 */
const neutralY = toY(ARMS_NEUTRAL_LINE);

/** 曲线 path（null 点断开：分段 M/L，connectNulls 语义） */
const linePath = computed(() => {
  const usable = points.filter((point) => point.arms !== null);
  if (usable.length === 0) return '';
  const step = (VIEW_W - PAD_L - PAD_R) / Math.max(1, points.length - 1);
  const x = (index: number): number =>
    PAD_L + step * (points.length < 2 ? 0.5 : points.indexOf(usable[index]!) / (points.length - 1));
  let d = '';
  let pen = false;
  usable.forEach((point, index) => {
    const cmd = pen ? 'L' : 'M';
    d += `${cmd}${x(index).toFixed(1)},${toY(point.arms!).toFixed(1)}`;
    pen = true;
  });
  return d;
});

/** 末点坐标（arms 非 null 才有） */
const endDot = computed(() => {
  const last = [...points].reverse().find((point) => point.arms !== null);
  if (!last || points.length < 2) return null;
  const step = (VIEW_W - PAD_L - PAD_R) / (points.length - 1);
  return {
    x: PAD_L + step * (points.indexOf(last) / (points.length - 1)),
    y: toY(last.arms!),
  };
});

/** y 轴刻度（三档：下限 / 1.0 / 上限） */
const yTicks = computed(() => [
  { value: Y_MIN, y: toY(Y_MIN), label: Y_MIN.toFixed(1) },
  { value: ARMS_NEUTRAL_LINE, y: neutralY, label: ARMS_NEUTRAL_LINE.toFixed(1) },
  { value: Y_MAX, y: toY(Y_MAX), label: Y_MAX.toFixed(1) },
]);
</script>

<template>
  <svg :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" preserveAspectRatio="none" class="m-arms-svg">
    <!-- 横向网格 -->
    <g stroke="var(--color-border)" stroke-width="1" vector-effect="non-scaling-stroke">
      <line
        v-for="tick in yTicks"
        :key="tick.value"
        x1="30"
        :y1="tick.y"
        :x2="VIEW_W - PAD_R"
        :y2="tick.y"
        :opacity="tick.value === ARMS_NEUTRAL_LINE ? 0 : 1"
        style="vector-effect: non-scaling-stroke"
      />
    </g>
    <!-- y 轴刻度文案 -->
    <text
      v-for="tick in yTicks"
      :key="`t-${tick.value}`"
      :x="PAD_L - 4"
      :y="tick.y + 3"
      text-anchor="end"
      class="m-arms-tick"
    >
      {{ tick.label }}
    </text>
    <!-- 平衡线 1.0（虚线） -->
    <line
      :x1="PAD_L"
      :y1="neutralY"
      :x2="VIEW_W - PAD_R"
      :y2="neutralY"
      stroke="var(--color-text-3)"
      stroke-width="1"
      stroke-dasharray="4 3"
      style="vector-effect: non-scaling-stroke"
    />
    <!-- ARMS 曲线 -->
    <path
      v-if="linePath"
      :d="linePath"
      fill="none"
      stroke="var(--color-primary)"
      stroke-width="1.6"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <!-- 末点 -->
    <circle v-if="endDot" :cx="endDot.x" :cy="endDot.y" r="2.6" fill="var(--color-primary)" />
  </svg>
</template>

<style scoped>
.m-arms-svg {
  display: block;
  width: 100%;
  height: auto;
}
.m-arms-tick {
  font-size: 8.5px;
  font-weight: 600;
  fill: var(--color-text-3);
}
</style>
