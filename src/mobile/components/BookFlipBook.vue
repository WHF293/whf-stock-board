<script setup lang="ts">
import { computed, ref, useSlots } from 'vue';
import { showToast } from 'vant';
import {
  MOBILE_BOOK_EDGE_WIDTH,
  MOBILE_BOOK_FLIP_MS,
  MOBILE_BOOK_PAGE_HEIGHT,
  MOBILE_BOOK_SWIPE_PX,
} from '../constants';

/**
 * 书本翻页容器（首页：成交额 / 涨跌分布 / 板块热力 三模块横翻，2026-10-11 王总指定）
 *
 * 翻页机制：纸绕左边缘（书脊）rotateY 翻转，backface-visibility 正反各露一面。
 * 注意：翻转 -180° 后纸的背面落在书脊左侧（视口外、被 overflow 裁掉），露出的区域
 * 是下一张纸的正面——所以每张纸的**正面放一个模块、背面留白纸**，翻一张露一张，
 * 这与掘金《实现一个书本翻页功能》的双页摊开式书本不同（那种背面内容在书内可见）。
 *
 * 交互（2026-10-12 王总定稿，替代 10-11 的滑块拖动方案）：
 * - 底部**通栏手势条**（无滑块）：条上横向滑动按方向切页——右→左下一个、左→右上一个
 *   （阈值 48px、以横向为主，与资金流向页 MobileGesturePager 同一套交互语言），
 *   已在边界再滑 toast 提示；点按条上任意位置仍直达该页；
 * - 左右边缘 40px 透明热区保留（快捷翻一页）；
 * - 翻页动画本身不做拖拽跟手（与 van-pull-refresh / 页面垂直滚动零冲突）。
 * 模块通过具名插槽 face0..faceN 注入，插槽个数即纸张数。
 */

const slots = useSlots();

/** 纸张下标列表（由 face0..faceN 插槽推导，保证顺序） */
const sheetIndexes = computed<number[]>(() =>
  Object.keys(slots)
    .filter((key) => /^face\d+$/.test(key))
    .map((key) => Number(key.slice(4)))
    .sort((a, b) => a - b),
);

/** 纸张总数 */
const sheetCount = computed(() => sheetIndexes.value.length);

/** 已翻过去的纸张数（0 = 第一张纸正面朝上；最大 sheetCount - 1） */
const currentPage = ref(0);
/** 正在翻转的纸下标（置顶用；null = 无翻转） */
const turningSheet = ref<number | null>(null);
/** 翻页动画计时器（重定向翻页时清旧计时） */
let turnTimer = 0;
/** 动画出发点纸张（连跳时保留参与渲染，避免瞬移） */
const lastPage = ref(0);

/**
 * 第 s 张纸是否已翻过去（翻过去后其正面被越过、露出下一张的正面）
 * @param s 纸张下标（0 基）
 * @returns 已翻过返回 true
 */
const isTurned = (s: number): boolean => s < currentPage.value;

/**
 * 第 s 张纸是否需要渲染：当前纸 + 动画出发点纸 + 翻转中的纸，以及三点区间内的纸。
 * 其余纸 visibility: hidden——透明面叠放时多张纸的标题会互相透出重叠
 * （2026-10-11 王总反馈"文字重叠"），非可见纸直接不画。
 * @param s 纸张下标（0 基）
 * @returns 可见返回 true
 */
const isVisible = (s: number): boolean => {
  const lo = Math.min(currentPage.value, lastPage.value);
  const hi = Math.max(currentPage.value, lastPage.value);
  return s >= lo && s <= hi;
};

/**
 * 纸张 z-index：翻转中置顶；未翻纸序号小者在上
 * @param s 纸张下标（0 基）
 * @returns 层叠 z-index
 */
const zOf = (s: number): number => {
  if (turningSheet.value === s) return sheetCount.value * 2 + 10;
  return sheetCount.value - s;
};

/**
 * 翻到指定张（可中途重定向：滑块拖动中松手立即改目标，不设互斥锁，
 * 否则连续操作会被吞——2026-10-11 王总反馈"不跟手"的主因）
 * @param target 目标纸张下标（= 需要翻过去的纸张数）
 */
const goTo = (target: number): void => {
  const next = Math.max(0, Math.min(target, sheetCount.value - 1));
  if (next === currentPage.value) return;
  lastPage.value = currentPage.value;
  // 向前翻动的是 from 所在的那张纸，向后翻动的是 next 那张
  turningSheet.value = Math.min(lastPage.value, next);
  currentPage.value = next;
  window.clearTimeout(turnTimer);
  turnTimer = window.setTimeout(() => {
    turningSheet.value = null;
    lastPage.value = currentPage.value;
  }, MOBILE_BOOK_FLIP_MS);
};

const goNext = (): void => {
  goTo(currentPage.value + 1);
};
const goPrev = (): void => {
  goTo(currentPage.value - 1);
};

/* ---- 底部通栏手势条（2026-10-12 王总定稿：滑块删除，滑动切向 + 点按直达） ---- */

/** 滑轨元素（点按坐标换算基准） */
const trackEl = ref<HTMLElement | null>(null);
/** 本轮手势起点 */
let gestureStartX = 0;
let gestureStartY = 0;
/** 本轮手势是否已判定为横向滑动（判定即切页，一轮只切一次） */
let swiped = false;

/**
 * 位置（px）换算目标页：取落点中点落在的第几段（点按直达用）
 * @param x 落点位置（px，相对滑轨）
 * @param step 单页步长（px = 轨道宽 / N）
 * @returns 目标页下标（已收敛到 [0, N-1]）
 */
const pageOfX = (x: number, step: number): number =>
  Math.max(0, Math.min(Math.floor((x + step / 2) / step), sheetCount.value - 1));

/**
 * 手势条按下：记录起点（不立即动作，等滑动判定）
 * @param e 指针事件
 */
const onTrackDown = (e: PointerEvent): void => {
  gestureStartX = e.clientX;
  gestureStartY = e.clientY;
  swiped = false;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
};

/**
 * 手势条移动：横向位移过阈值且以横向为主 → 按方向切一页（右→左下一个，左→右上一个）；
 * 已在边界再滑 → toast 提示（与资金流向页翻页同一套交互语言）
 * @param e 指针事件
 */
const onTrackMove = (e: PointerEvent): void => {
  if (swiped) return;
  const dx = e.clientX - gestureStartX;
  const dy = e.clientY - gestureStartY;
  if (Math.abs(dx) < MOBILE_BOOK_SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return;
  swiped = true;
  if (dx < 0) {
    if (currentPage.value >= sheetCount.value - 1) void showToast('已经是最后一个了');
    else goNext();
  } else {
    if (currentPage.value <= 0) void showToast('已经是第一个了');
    else goPrev();
  }
};

/**
 * 手势条抬起：滑动已切页则忽略；否则视为点按，落点在第几段直达第几页
 * @param e 指针事件
 */
const onTrackUp = (e: PointerEvent): void => {
  if (swiped) return;
  const track = trackEl.value;
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const step = rect.width / sheetCount.value;
  goTo(pageOfX(e.clientX - rect.left, step));
};

/** 热区行内样式（宽度走常量） */
const edgeStyle = { width: `${MOBILE_BOOK_EDGE_WIDTH}px` };
</script>

<template>
  <div class="m-book">
    <div class="m-book__wrap" :style="{ height: `${MOBILE_BOOK_PAGE_HEIGHT}px` }">
      <div class="m-book__scene">
        <div
          v-for="s in sheetCount"
          :key="`sheet-${s}`"
          class="m-book__sheet"
          :class="{
            'm-book__sheet--turned': isTurned(s - 1),
            'm-book__sheet--turning': turningSheet === s - 1,
            'm-book__sheet--hidden': !isVisible(s - 1),
          }"
          :style="{ zIndex: zOf(s - 1), transitionDuration: `${MOBILE_BOOK_FLIP_MS}ms` }"
        >
          <div class="m-book__face m-book__face--front">
            <slot :name="`face${s - 1}`" />
          </div>
          <!-- 背面留白纸：翻转后落在书脊左侧视口外，仅在翻页动画中短暂可见 -->
          <div class="m-book__face m-book__face--back" />
        </div>
      </div>
      <!-- 左右翻页热区（透明，仅贴边缘；不影响图区 crosshair 与内部点击） -->
      <button
        v-if="currentPage > 0"
        class="m-book__edge m-book__edge--l"
        :style="edgeStyle"
        aria-label="上一页"
        @click="goPrev"
      />
      <button
        v-if="currentPage < sheetCount - 1"
        class="m-book__edge m-book__edge--r"
        :style="edgeStyle"
        aria-label="下一页"
        @click="goNext"
      />
    </div>
    <!-- 底部通栏手势条（无滑块）：滑动按方向切页，点按直达（2026-10-12 王总定稿） -->
    <div
      ref="trackEl"
      class="m-book__slider"
      @pointerdown="onTrackDown"
      @pointermove="onTrackMove"
      @pointerup="onTrackUp"
      @pointercancel="onTrackUp"
    >
      <!-- 页点提示（纯展示，事件全在条上）：让人一眼看出这是翻页控件 -->
      <span class="m-book__dots">
        <i v-for="s in sheetCount" :key="s" :class="{ on: s - 1 === currentPage }"></i>
      </span>
    </div>
  </div>
</template>

<style scoped>
.m-book {
  margin-top: 2px;
}
/* 裁掉翻出视口的左堆叠纸张，避免产生横向滚动 */
.m-book__wrap {
  position: relative;
  overflow: hidden;
}
.m-book__scene {
  position: absolute;
  inset: 0;
  perspective: 1800px;
}
.m-book__sheet {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  transform-origin: left center;
  transition: transform cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
}
.m-book__sheet--turned {
  transform: rotateY(-180deg);
}
/* 非当前纸不渲染：透明面叠放会互相透出内容（标题重叠），仅当前纸 + 翻转中纸可见 */
.m-book__sheet--hidden {
  visibility: hidden;
}
/* 翻转中的纸给不透明纸面色：常态正面透明（与页面底色一致，2026-10-11 王总反馈纯黑突兀），
   动画期间若仍透明会看穿到下一张纸，故仅翻转中上纸面色 */
.m-book__sheet--turning .m-book__face {
  background: var(--color-surface);
}
.m-book__face {
  position: absolute;
  inset: 0;
  overflow: hidden;
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  /* 透出页面底色：模块卡片自带 surface 背景，不用纯黑（2026-10-11 王总反馈） */
  background: transparent;
}
.m-book__face--back {
  transform: rotateY(180deg);
  box-shadow: inset 12px 0 18px -14px rgba(0, 0, 0, 0.5);
}
/* 面内纵向布局：面板卡（含加载失败/骨架占位）撑满剩余页高（2026-10-11 王总反馈占位图不撑满） */
.m-book__face--front {
  display: flex;
  flex-direction: column;
}
.m-book__face--front > :slotted(.m-home-panel),
.m-book__face--front > :slotted(.m-card) {
  flex: 1 1 auto;
}
/* 底部手势条内嵌到卡片底部（王总 2026-10-12，同板块历史净流入的条效果）：
   卡片底部留出 28px 内嵌区，条上移 24px 盖住卡片底圆角，左右内缩 12px */
.m-book__face--front > :slotted(.m-home-panel),
.m-book__face--front > :slotted(.m-card) {
  margin-bottom: 0;
  padding-bottom: 28px;
}
/* 面板内部也纵向排布：成交额图区自动拉伸撑满（2026-10-11 王总反馈成交额下方太空） */
.m-book__face--front > :slotted(.m-home-panel) {
  display: flex;
  flex-direction: column;
}
.m-book__face--front :slotted(.m-home-chart) {
  flex: 1 1 auto;
  height: auto;
  /* 240 → 200（2026-10-13）：实时摘要并入后内容变高，允许图区收缩保住 x 轴不被手势条遮挡；
     内容不满页时 flex 仍会拉伸图区占满剩余高度 */
  min-height: 200px;
}
/* 左右翻页热区：透明贴边条 */
.m-book__edge {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 40;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.m-book__edge--l { left: 0; }
.m-book__edge--r { right: 0; }
/* 底部通栏手势条：内嵌卡片底部（同板块历史净流入的条），track 底色与卡面区分；
   上移盖住卡片底圆角，整条为滑动/点按触达区（2026-10-12 王总定稿） */
.m-book__slider {
  position: relative;
  z-index: 5;
  height: 22px;
  margin: -24px 24px 12px;
  border-radius: 999px;
  background: var(--color-border);
  touch-action: none;
  cursor: pointer;
}
/* 页点提示（纯展示）：当前页高亮主色，点数 = 纸张数 */
.m-book__dots {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  pointer-events: none;
}
.m-book__dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--m-page-bg);
  transition: background 0.2s ease;
}
.m-book__dots i.on {
  background: var(--color-primary);
}
/* 减少动态效果：直接切换不播动画 */
@media (prefers-reduced-motion: reduce) {
  .m-book__sheet { transition: none !important; }
}
</style>
