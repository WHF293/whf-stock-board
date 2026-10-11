<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';

/**
 * Dock 面板通用拖拽手柄（仿 Ant Design Splitter）：
 *
 * - 视觉：双竖线 grip icon + 浅色背景卡片，骑在挂载元素左缘、垂直居中
 * - 交互：长按 ≥ LONG_PRESS_MS 出现贯穿全屏竖线 + 锁定 body 选择；
 *   移动改写宽度（鼠标 X 即面板右缘），松手 commit
 * - 通用：父级通过 setWidth 回调把鼠标位置换算成宽度并经 store 持久化；
 *   不绑定具体面板内容（个股 / 基金 / 期货等均适用）
 *
 * 父级需提供：
 * - setWidth(px: number) — 夹取到合法区间后写入
 * - 当前宽度由父级容器内联 style 渲染（不挂在 store 也可）
 *
 * 配合 <Teleport to="body"> 的贯穿竖线建议同组件一并渲染，避免跨组件 ref
 */

const props = withDefaults(
  defineProps<{
    /** 父级调用方：把当前鼠标 X 换算成面板宽度并写入（建议内部 clamp） */
    onResize?: (clientX: number) => void;
  }>(),
  { onResize: undefined },
);

const emit = defineEmits<{
  /** 拖拽结束（pointerup）：父级可在此触发依赖最终宽度的重绘 */
  'resize-end': [];
}>();

/** 长按触发阈值（毫秒） */
const LONG_PRESS_MS = 120;

/** 拖拽中视觉态：是否在拖拽 */
const isDragging = ref(false);
/** 竖线当前 X 坐标（屏幕坐标） */
const dragLineX = ref(0);

/** 拖拽中标记 */
let dragging = false;
/** 长按定时器 */
let longPressTimer: number | null = null;

/**
 * 手柄按下：启动长按定时器；达到阈值后进入拖拽态
 * @param event
 */
const onPointerDown = (event: PointerEvent): void => {
  if (event.button !== 0) return;
  event.preventDefault();
  longPressTimer = window.setTimeout(() => {
    longPressTimer = null;
    enterDrag(event.clientX);
  }, LONG_PRESS_MS);
  document.addEventListener('pointerup', onPointerUpEarly, { once: true });
  document.addEventListener('pointermove', onPointerMoveEarly);
};

/** 长按未达成前若移动：取消（视为误触） */
const onPointerMoveEarly = (): void => {
  if (longPressTimer === null) return;
  longPressTimer = null;
  document.removeEventListener('pointermove', onPointerMoveEarly);
  document.removeEventListener('pointerup', onPointerUpEarly);
};

/** 长按达成前松开：取消长按 */
const onPointerUpEarly = (): void => {
  if (longPressTimer === null) return;
  window.clearTimeout(longPressTimer);
  longPressTimer = null;
  document.removeEventListener('pointermove', onPointerMoveEarly);
};

/**
 * 进入拖拽态
 * @param startX
 */
const enterDrag = (startX: number): void => {
  dragging = true;
  isDragging.value = true;
  dragLineX.value = startX;
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd, { once: true });
};

/**
 * 拖拽中：转交父级处理
 * @param event
 */
const onDragMove = (event: PointerEvent): void => {
  if (!dragging) return;
  dragLineX.value = event.clientX;
  props.onResize?.(event.clientX);
};

/** 拖拽结束 */
const onDragEnd = (): void => {
  dragging = false;
  isDragging.value = false;
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
  document.removeEventListener('pointermove', onDragMove);
  emit('resize-end');
};

onBeforeUnmount(() => {
  if (longPressTimer !== null) {
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (dragging) {
    onDragEnd();
  }
});
</script>

<template>
  <!-- 手柄：长按出现贯穿竖线，垂直居中骑在父容器左缘 -->
  <button
    type="button"
    class="pressable absolute left-0 top-1/2 z-30 flex"
    aria-label="长按拖动调整面板宽度"
    @pointerdown="onPointerDown"
  >
    <span class="block h-3 w-px rounded-full bg-current" />
    <span class="block h-3 w-px rounded-full bg-current" />
  </button>

  <!-- 拖拽中贯穿竖线（Teleport 到 body 避免被父级 overflow 裁剪） -->
  <Teleport to="body">
    <div
      v-if="isDragging"
      class="pointer-events-none fixed inset-y-0 z-[60] w-px bg-primary"
      :style="{ left: `${dragLineX}px` }"
    />
  </Teleport>
</template>
