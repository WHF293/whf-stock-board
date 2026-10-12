<script setup lang="ts">
import { ref } from 'vue';
import { showToast } from 'vant';
import { FUND_FLOW_PAGER_SWIPE_PX } from '../constants';

/**
 * 手势翻页容器（2026-10-12 三次改版，与首页书本翻页同一套交互语言）：
 *
 * - 一次只渲染当前页，切页做**仿书本翻页**过渡（绕左缘 rotateY，下一页从下方露出 /
 *   上一页从左侧翻回），不做跟手拖拽；
 * - 底部**通栏手势条**（无分段，带页点提示）：滑动手势监听在条上——右→左 = 下一个，
 *   左→右 = 上一个（阈值 48px、以横向为主，与首页 BookFlipBook 底部条同参数）；
 *   已在边界再滑 toast 提示（不循环）；点按条上任意位置按落点段落直达该页；
 * - 内容区不再响应滑动（垂直滚动逐日列表零干扰）
 */
const { total, current, boundaryHint = true } = defineProps<{
  /** 总页数（≤1 时隐藏手势条且不响应手势） */
  total: number;
  /** 当前页下标（0 基，v-model:current） */
  current: number;
  /** 越界滑动是否 toast 提示（默认开） */
  boundaryHint?: boolean;
}>();

const emit = defineEmits<{
  /** 当前页变化（手势切换 / 点按跳页） */
  'update:current': [index: number];
}>();

/** 切页方向（驱动翻页过渡方向：1 = 向后翻，-1 = 向前翻，0 = 跳页淡入） */
const direction = ref<1 | -1 | 0>(0);

/**
 * 跳页（点按 / 手势共用）：记录方向并对外发变更
 * @param index 目标页下标（调用方保证在界内）
 * @param dir 切页方向（1 后翻 / -1 前翻 / 0 直接跳）
 */
const go = (index: number, dir: 1 | -1 | 0): void => {
  if (index === current) {
    return;
  }
  direction.value = dir;
  emit('update:current', index);
};

/* ---- 底部通栏手势条（与首页 BookFlipBook 底部条同款交互） ---- */

/** 手势条元素（点按坐标换算基准） */
const barEl = ref<HTMLElement | null>(null);
/** 本轮手势起点 */
let gestureStartX = 0;
let gestureStartY = 0;
/** 本轮手势是否已判定为横向滑动（判定即切页，一轮只切一次） */
let swiped = false;

/**
 * 位置（px）换算目标页：取落点落在的第几段
 * @param x 落点位置（px，相对手势条）
 * @param step 单页步长（px = 条宽 / N）
 * @returns 目标页下标（已收敛到 [0, N-1]）
 */
const pageOfX = (x: number, step: number): number =>
  Math.max(0, Math.min(Math.floor((x + step / 2) / step), total - 1));

/**
 * 手势条按下：记录起点（不立即动作，等滑动判定）
 * @param e 指针事件
 */
const onBarDown = (e: PointerEvent): void => {
  gestureStartX = e.clientX;
  gestureStartY = e.clientY;
  swiped = false;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
};

/**
 * 手势条移动：横向位移过阈值且以横向为主 → 按方向切一页（右→左下一个，左→右上一个）；
 * 已在边界再滑 → toast 提示（与首页底部条同一套交互语言）
 * @param e 指针事件
 */
const onBarMove = (e: PointerEvent): void => {
  if (swiped) return;
  const dx = e.clientX - gestureStartX;
  const dy = e.clientY - gestureStartY;
  if (Math.abs(dx) < FUND_FLOW_PAGER_SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return;
  swiped = true;
  if (dx < 0) {
    if (current >= total - 1) {
      if (boundaryHint) void showToast('已经是最后一个了');
      return;
    }
    go(current + 1, 1);
  } else {
    if (current <= 0) {
      if (boundaryHint) void showToast('已经是第一个了');
      return;
    }
    go(current - 1, -1);
  }
};

/**
 * 手势条抬起：滑动已切页则忽略；否则视为点按，落点在第几段直达第几页
 * @param e 指针事件
 */
const onBarUp = (e: PointerEvent): void => {
  if (swiped) return;
  const bar = barEl.value;
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  go(pageOfX(e.clientX - rect.left, rect.width / total), 0);
};
</script>

<template>
  <div class="m-gpager">
    <!-- 翻页舞台：perspective 供 rotateY 翻页用；页绝对定位叠放，出入场同时进行 -->
    <div class="m-gpager__stage">
      <Transition
        :name="
          direction === 1 ? 'm-gpager-next' : direction === -1 ? 'm-gpager-prev' : 'm-gpager-fade'
        "
      >
        <div :key="current" class="m-gpager__page">
          <slot />
        </div>
      </Transition>
    </div>

    <!-- 底部通栏手势条（唯一导航件；多页才显示）：滑动按方向切页，点按直达 -->
    <div
      v-if="total > 1"
      ref="barEl"
      class="m-gpager__bar"
      @pointerdown="onBarDown"
      @pointermove="onBarMove"
      @pointerup="onBarUp"
      @pointercancel="onBarUp"
    >
      <!-- 页点提示（纯展示，事件全在条上）：让人一眼看出这是翻页控件 -->
      <span class="m-gpager__dots">
        <i v-for="index in total" :key="index" :class="{ on: index - 1 === current }"></i>
      </span>
    </div>
  </div>
</template>

<style scoped>
.m-gpager {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
/* 翻页舞台：页绝对定位叠放，翻页出入场同时进行 */
.m-gpager__stage {
  position: relative;
  flex: 1;
  min-height: 0;
  perspective: 1200px;
}
.m-gpager__page {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
}
/* 底部通栏手势条：无分段，整条为滑动/点按触达区（2026-10-12 与首页底部条统一） */
.m-gpager__bar {
  position: relative;
  flex-shrink: 0;
  height: 22px;
  margin-top: 8px;
  border-radius: 999px;
  background: var(--color-border);
  touch-action: none;
  cursor: pointer;
}
/* 页点提示（纯展示）：当前页高亮主色 */
.m-gpager__dots {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  pointer-events: none;
}
.m-gpager__dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--m-page-bg);
  transition: background 0.2s ease;
}
.m-gpager__dots i.on {
  background: var(--color-primary);
}

/* 仿书本翻页过渡：绕左缘 rotateY（下一页翻走露出后页 / 上一页从左侧翻回） */
.m-gpager-next-enter-active {
  transition: opacity 0.3s ease;
}
.m-gpager-next-leave-active {
  z-index: 2;
  transform-origin: left center;
  transition: transform 0.42s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.42s ease;
}
.m-gpager-next-enter-from {
  opacity: 0;
}
.m-gpager-next-leave-to {
  transform: rotateY(-72deg);
  opacity: 0;
}
.m-gpager-prev-enter-active {
  z-index: 2;
  transform-origin: left center;
  transition: transform 0.42s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
}
.m-gpager-prev-leave-active {
  transition: opacity 0.3s ease;
}
.m-gpager-prev-enter-from {
  transform: rotateY(-72deg);
  opacity: 0;
}
.m-gpager-prev-leave-to {
  opacity: 0;
}
/* 跳页（点按直达）：直接淡入淡出 */
.m-gpager-fade-enter-active,
.m-gpager-fade-leave-active {
  transition: opacity 0.18s ease;
}
.m-gpager-fade-enter-from,
.m-gpager-fade-leave-to {
  opacity: 0;
}
/* 减少动态效果：直接切换不播动画 */
@media (prefers-reduced-motion: reduce) {
  .m-gpager-next-leave-active,
  .m-gpager-prev-enter-active {
    transition: none;
  }
}
</style>
