<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { HEADER_MARQUEE_TONE_CLASS } from '../constants/header.constants';
import {
  WATCH_WIDGET_CLICK_DELAY_MS,
  WATCH_WIDGET_EVENTS,
  WATCH_WIDGET_ROTATE_MS,
} from '../plugins/watch-widget/constants';
import type { WatchWidgetRow } from '../types/watch-widget.types';

/**
 * 任务栏盯盘小组件 · 迷你条（单行轮播）
 *
 * - 数据：只消费主窗口推送的轮播行，挂载时发一次快照请求（本窗口零上游请求）；
 * - 左侧细条是唯一拖拽区（data-tauri-drag-region），其余区域留给点击 ——
 *   Tauri 的拖拽区会在 mousedown 就接管，与「单击展开气泡」互斥，必须分区；
 * - 单击 = 切换气泡；双击 = 打开当前标的（主窗口跳详情页）。
 *   两者用「单击延迟判定」区分：第一击挂起，延迟窗口内第二击到来即视为双击。
 */

/** 当前轮播行（引擎快照未到达时为空，显示占位文案） */
const rows = ref<WatchWidgetRow[]>([]);

/** 轮播游标（多候选逐条轮播；行数变化时归零，避免位移越界） */
const cursor = ref(0);

const current = computed<WatchWidgetRow | null>(() => rows.value[cursor.value] ?? null);

/** 请求快照 / 拖动上报的事件退订句柄 */
let unlistenLines: (() => void) | undefined;
let unlistenMoved: (() => void) | undefined;

/** 轮播计时器（组件级持有：窗口销毁时组件一起消失，无泄漏） */
let rotateTimer: number | undefined;

/** 单击延迟判定计时器（双击到来时取消单击动作） */
let clickTimer: number | undefined;

onMounted(() => {
  void (async () => {
    unlistenLines = await listen<{ rows: WatchWidgetRow[] }>(WATCH_WIDGET_EVENTS.LINES, (event) => {
      const next = event.payload.rows ?? [];
      if (cursor.value >= next.length) cursor.value = 0;
      rows.value = next;
    });
    void emit(WATCH_WIDGET_EVENTS.REQUEST);

    // 拖动结束上报新位置（防抖；主窗口记忆到设置，下次开启原位恢复）
    let moveTimer: number | undefined;
    unlistenMoved = await getCurrentWindow().onMoved(({ payload }) => {
      if (moveTimer) window.clearTimeout(moveTimer);
      moveTimer = window.setTimeout(() => {
        moveTimer = undefined;
        void emit(WATCH_WIDGET_EVENTS.BAR_MOVED, { x: payload.x, y: payload.y });
      }, WATCH_WIDGET_CLICK_DELAY_MS);
    });
  })();
  rotateTimer = window.setInterval(() => {
    if (rows.value.length > 1) cursor.value = (cursor.value + 1) % rows.value.length;
  }, WATCH_WIDGET_ROTATE_MS);
});

onBeforeUnmount(() => {
  unlistenLines?.();
  unlistenMoved?.();
  if (rotateTimer) window.clearInterval(rotateTimer);
  if (clickTimer) window.clearTimeout(clickTimer);
});
// 行数增删后回到第一行：否则轮播可能落在新列表之外，视窗会空着
watch(
  () => rows.value.length,
  () => {
    cursor.value = 0;
  },
);

/** 单击：延迟执行「切换气泡」；延迟窗口内第二击到来则交给双击处理 */
const onClick = (): void => {
  if (clickTimer) {
    window.clearTimeout(clickTimer);
    clickTimer = undefined;
    return;
  }
  clickTimer = window.setTimeout(() => {
    clickTimer = undefined;
    void emit(WATCH_WIDGET_EVENTS.POPOVER_TOGGLE);
  }, WATCH_WIDGET_CLICK_DELAY_MS);
};

/** 双击：打开当前标的（主窗口唤起 + 跳详情页） */
const onDblclick = (): void => {
  if (clickTimer) {
    window.clearTimeout(clickTimer);
    clickTimer = undefined;
  }
  const symbol = current.value?.symbol;
  if (symbol) void emit(WATCH_WIDGET_EVENTS.OPEN_STOCK, { symbol });
};
</script>

<template>
  <div
    class="flex h-full w-full select-none items-stretch overflow-hidden rounded-lg border border-flat-weak bg-surface/95 text-xs shadow-lg"
  >
    <!-- 左侧细条：唯一拖拽区（拖拽与点击互斥，必须分区） -->
    <div data-tauri-drag-region class="widget-drag-strip w-3.5 shrink-0 border-r border-flat-weak" />
    <!-- 展示区：单击切气泡、双击开详情 -->
    <div
      class="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2"
      :title="current ? `${current.name} 双击打开详情，单击展开候选列表` : '盯盘'"
      @click="onClick"
      @dblclick="onDblclick"
    >
      <template v-if="current">
        <span v-if="current.fired" class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        <span class="min-w-0 flex-1 truncate text-text">{{ current.name }}</span>
        <span class="shrink-0 tabular-nums text-text-secondary">{{ current.price }}</span>
        <span class="shrink-0 tabular-nums" :class="HEADER_MARQUEE_TONE_CLASS[current.tone]">
          {{ current.percent }}
        </span>
      </template>
      <span v-else class="text-text-tertiary">盯盘</span>
    </div>
  </div>
</template>

<style scoped>
/* 拖拽区握把点阵：用 currentColor 点阵表达「可抓取」，不引入规范外色值 */
.widget-drag-strip {
  background-image: radial-gradient(currentColor 1px, transparent 1px);
  background-size: 4px 4px;
  opacity: 0.35;
  cursor: grab;
}
</style>
