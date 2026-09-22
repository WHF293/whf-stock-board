<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { emit, listen } from '@tauri-apps/api/event';
import { HEADER_MARQUEE_TONE_CLASS } from '../constants/header.constants';
import {
  WATCH_WIDGET_EVENTS,
  WATCH_WIDGET_POPOVER_FOOTER_PADDING,
  WATCH_WIDGET_POPOVER_HEADER_HEIGHT,
  WATCH_WIDGET_POPOVER_ROW_HEIGHT,
} from '../plugins/watch-widget/constants';
import type { WatchWidgetRow } from '../types/watch-widget.types';

/**
 * 任务栏盯盘小组件 · 气泡（全部盯盘候选列表）
 *
 * - 悬浮在迷你条正上方（位置与尺寸由主窗口插件按行数设定，本窗口只管渲染）；
 * - 数据与迷你条共用同一事件：挂载时发一次快照请求，之后随推送刷新；
 * - 单击任意一行 → 主窗口唤起 + 跳详情整页（左列 = 盯盘候选）；
 *   「收起」按钮走与迷你条单击相同的切换事件（展开态下即隐藏）。
 */

/** 候选行（主窗口推送） */
const rows = ref<WatchWidgetRow[]>([]);

/** 行高 / 头高样式（窗口尺寸按同一组常量计算，两侧必须一致，差 1px 就会滚动或留空） */
const headerStyle = { height: `${WATCH_WIDGET_POPOVER_HEADER_HEIGHT}px` };
const rowStyle = { height: `${WATCH_WIDGET_POPOVER_ROW_HEIGHT}px` };
const footerStyle = { height: `${WATCH_WIDGET_POPOVER_FOOTER_PADDING}px` };

let unlistenLines: (() => void) | undefined;

onMounted(() => {
  void (async () => {
    unlistenLines = await listen<{ rows: WatchWidgetRow[] }>(WATCH_WIDGET_EVENTS.LINES, (event) => {
      rows.value = event.payload.rows ?? [];
    });
    void emit(WATCH_WIDGET_EVENTS.REQUEST);
  })();
});

onBeforeUnmount(() => {
  unlistenLines?.();
});

/**
 * 单击一行：打开该标的（主窗口唤起 + 跳详情页）
 * @param row 被点的候选行
 */
const onPick = (row: WatchWidgetRow): void => {
  if (row.symbol) void emit(WATCH_WIDGET_EVENTS.OPEN_STOCK, { symbol: row.symbol });
};

/** 收起气泡（走切换事件：展开态下即隐藏） */
const onClose = (): void => {
  void emit(WATCH_WIDGET_EVENTS.POPOVER_TOGGLE);
};
</script>

<template>
  <div
    class="flex h-full w-full select-none flex-col overflow-hidden rounded-xl border border-flat-weak bg-surface text-xs shadow-2xl"
  >
    <!-- 头部：候选计数 + 收起 -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-flat-weak px-3"
      :style="headerStyle"
    >
      <p class="text-text">自选盯盘 · {{ rows.length }}</p>
      <button class="pressable text-text-tertiary hover:text-text" @click="onClose">收起</button>
    </div>
    <!-- 列表：全部盯盘候选（超出行数上限时滚动） -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="rows.length === 0" class="px-3 py-4 leading-relaxed text-text-tertiary">
        还没有盯盘候选：在自选股「操作」列点「盯盘」，标的就会出现在这里
      </p>
      <button
        v-for="row in rows"
        :key="row.symbol"
        class="pressable flex w-full items-center gap-2 px-3 hover:bg-flat-weak/60"
        :style="rowStyle"
        :title="`${row.name} 单击打开详情页`"
        @click="onPick(row)"
      >
        <span v-if="row.fired" class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        <span class="min-w-0 flex-1 truncate text-left text-text">{{ row.name }}</span>
        <span class="shrink-0 tabular-nums text-text-secondary">{{ row.price }}</span>
        <span class="w-14 shrink-0 text-right tabular-nums" :class="HEADER_MARQUEE_TONE_CLASS[row.tone]">
          {{ row.percent }}
        </span>
      </button>
    </div>
    <div class="shrink-0" :style="footerStyle" />
  </div>
</template>
