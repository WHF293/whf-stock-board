<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { STORAGE_NS_MOBILE_DEBUG_BALL } from '../../common/constants/storage-key.constants.ts';
import { appStorage } from '../../common/utils/app-local-storage.ts';
import {
  DEBUG_BALL_DEFAULT_INSET,
  DEBUG_BALL_DRAG_SLOP_PX,
  DEBUG_BALL_SIZE,
} from '../constants';

/**
 * 调试悬浮球（fixed，全局唯一，随 DebugOverlay 挂载）
 *
 * 指针拖动换位（clamp 在视口内），位移超过 DEBUG_BALL_DRAG_SLOP_PX 视为拖动
 * 并持久化落点；否则视为点按，emit activate 打开网络面板。
 * 坐标存 appStorage（mobile.debugBall 命名空间），重启恢复上次位置。
 */
const emit = defineEmits<{ activate: [] }>();

/** 悬浮球位置（球体左上角的视口 px 坐标） */
interface BallPos {
  x: number;
  y: number;
}

/**
 * 默认落点：右缘内缩、底部上移避开 TabBar
 * @returns 悬浮球初始位置
 */
const defaultPos = (): BallPos => ({
  x: window.innerWidth - DEBUG_BALL_DEFAULT_INSET.x - DEBUG_BALL_SIZE,
  y: window.innerHeight - DEBUG_BALL_DEFAULT_INSET.y - DEBUG_BALL_SIZE,
});

/**
 * 读取持久化位置（损坏 / 越界时回落默认值，挂载时再 clamp 一次）
 * @returns 悬浮球位置
 */
const readPos = (): BallPos => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_MOBILE_DEBUG_BALL);
    if (raw) return JSON.parse(raw) as BallPos;
  } catch {
    // 解析失败回落默认位置
  }
  return defaultPos();
};

const pos = ref<BallPos>(readPos());

/**
 * 把位置夹回视口内
 * @param p 任意位置
 * @returns 夹紧后的合法位置
 */
const clampPos = (p: BallPos): BallPos => ({
  x: Math.min(Math.max(0, p.x), window.innerWidth - DEBUG_BALL_SIZE),
  y: Math.min(Math.max(0, p.y), window.innerHeight - DEBUG_BALL_SIZE),
});

/** 持久化当前位置 */
const persistPos = (): void => {
  appStorage.setItem(STORAGE_NS_MOBILE_DEBUG_BALL, JSON.stringify(pos.value));
};

let pointerId = -1;
let startPX = 0;
let startPY = 0;
let baseX = 0;
let baseY = 0;
let moved = false;

/**
 * 指针按下：记录起点，接管后续指针事件
 * @param event 指针事件
 */
const onPointerDown = (event: PointerEvent): void => {
  pointerId = event.pointerId;
  startPX = event.clientX;
  startPY = event.clientY;
  baseX = pos.value.x;
  baseY = pos.value.y;
  moved = false;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
};

/**
 * 指针移动：超阈值进入拖动态并实时换位（clamp 防止拖出视口）
 * @param event 指针事件
 */
const onPointerMove = (event: PointerEvent): void => {
  if (event.pointerId !== pointerId) return;
  const dx = event.clientX - startPX;
  const dy = event.clientY - startPY;
  if (Math.abs(dx) > DEBUG_BALL_DRAG_SLOP_PX || Math.abs(dy) > DEBUG_BALL_DRAG_SLOP_PX) {
    moved = true;
  }
  if (moved) pos.value = clampPos({ x: baseX + dx, y: baseY + dy });
};

/**
 * 指针抬起：拖动则落点持久化，点按则打开面板
 * @param event 指针事件
 */
const onPointerUp = (event: PointerEvent): void => {
  if (event.pointerId !== pointerId) return;
  pointerId = -1;
  if (moved) persistPos();
  else emit('activate');
};

onMounted(() => {
  pos.value = clampPos(pos.value);
});
</script>

<template>
  <div
    class="m-dbg-ball"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${DEBUG_BALL_SIZE}px`, height: `${DEBUG_BALL_SIZE}px` }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    ⚙
  </div>
</template>

<style scoped>
.m-dbg-ball {
  position: fixed;
  z-index: 3000; /* 高于 van-popup（~2000+）与 TabBar */
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #fff;
  background: color-mix(in srgb, var(--color-primary) 88%, transparent);
  border-radius: 50%;
  box-shadow: var(--m-card-shadow);
  touch-action: none; /* 拖动期间禁掉页面滚动/手势 */
  user-select: none;
  -webkit-user-select: none;
  cursor: grab;
}
</style>
