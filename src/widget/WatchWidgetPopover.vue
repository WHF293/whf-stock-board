<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { emit, listen } from '@tauri-apps/api/event';
import MenuIcon from '../components/ui/MenuIcon.vue';
import { HEADER_MARQUEE_TONE_CLASS } from '../constants/header.constants';
import { CHART_LABEL_ON_TREND_COLOR } from '../constants/chart.constants';
import {
  WATCH_WIDGET_EVENTS,
  WATCH_WIDGET_POPOVER_FOOTER_PADDING,
  WATCH_WIDGET_POPOVER_HEADER_HEIGHT,
  WATCH_WIDGET_POPOVER_ROW_HEIGHT,
  WATCH_WIDGET_POPOVER_VIEW,
} from '../plugins/watch-widget/constants';
import { useSettingsStore } from '../stores/settings';
import { formatPercent } from '../utils/format-percent';
import { getTrendColorCss } from '../utils/trend-colors';
import { squarifyLayout } from './watch-heatmap-layout';
import type { TreemapRect } from './watch-heatmap-layout';
import type {
  WatchWidgetHeatmapPayload,
  WatchWidgetIndexesPayload,
  WatchWidgetPopoverView,
  WatchWidgetPopoverViewPayload,
  WatchWidgetRow,
} from '../types/watch-widget.types';

/**
 * 任务栏盯盘小组件 · 气泡（候选列表 / 板块热力 / 大盘走势三视图）
 *
 * - 悬浮在迷你条正上方（位置与尺寸由主窗口插件按视图与行数设定，本窗口只管渲染）；
 * - 数据与迷你条共用同一事件：挂载时发一次快照请求，之后随推送刷新；
 * - 头部图标按「候选列表 → 板块热力 → 大盘走势」循环切换（板块热力 = 市场总览
 *   「板块热力」迷你版：行业板块 Top N；大盘走势 = 上证 / 深证 / 创业板指 / 恒生
 *   四指数行情），切换经 popover-view 事件上报主窗口重算窗口高度；
 * - 挂载时也上报一次当前视图：窗口销毁重建后组件态重置，主窗口侧的视图记忆随之自愈；
 * - 单击列表行 → 主窗口唤起 + 跳详情整页（左列 = 盯盘候选）；
 *   「收起」按钮走与迷你条单击相同的切换事件（展开态下即隐藏）。
 */

/** 候选行（主窗口推送） */
const rows = ref<WatchWidgetRow[]>([]);
/** 热力板块快照（主窗口推送，已按总市值排序取 Top N） */
const heatBoards = ref<WatchWidgetHeatmapPayload['boards']>([]);
/** 大盘指数快照（主窗口推送：上证 / 深证 / 创业板指 / 恒生） */
const indexes = ref<WatchWidgetIndexesPayload['indexes']>([]);
/** 当前内容视图（窗口隐藏复用期间组件不卸载，视图状态天然保持） */
const view = ref<WatchWidgetPopoverView>(WATCH_WIDGET_POPOVER_VIEW.LIST);

/** 涨跌配色主题（色阶读 CSS 变量，切换主题后热力 tile 需重算颜色） */
const settingsStore = useSettingsStore();

const isHeatmap = computed(() => view.value === WATCH_WIDGET_POPOVER_VIEW.HEATMAP);
const isMarket = computed(() => view.value === WATCH_WIDGET_POPOVER_VIEW.MARKET);

/** 头部标题随视图切换（列表带候选计数，另两视图有自己的语义） */
const headerTitle = computed(() => {
  if (isHeatmap.value) return '板块热力';
  if (isMarket.value) return '大盘走势';
  return `自选盯盘 · ${rows.value.length}`;
});

/** 头部切换图标的语义随当前视图（点击切到下一个视图） */
const viewIcon = computed(() => {
  if (isHeatmap.value) return 'flame';
  if (isMarket.value) return 'boards';
  return 'menu';
});

/** 行高 / 头高样式（窗口尺寸按同一组常量计算，两侧必须一致，差 1px 就会滚动或留空） */
const headerStyle = { height: `${WATCH_WIDGET_POPOVER_HEADER_HEIGHT}px` };
const rowStyle = { height: `${WATCH_WIDGET_POPOVER_ROW_HEIGHT}px` };
const footerStyle = { height: `${WATCH_WIDGET_POPOVER_FOOTER_PADDING}px` };

/**
 * 热力视图 SVG 画布尺寸（逻辑像素）：窗口 288×216（头部 40 + 5×34 + 底部 6）
 * 减去根边框 2、头部下边框 1、内容区内边距 12（p-1.5 四边）
 */
const HEATMAP_VIEWBOX_WIDTH = 274;
const HEATMAP_VIEWBOX_HEIGHT = 155;

/** 视图循环顺序：候选列表 → 板块热力 → 大盘走势 → 候选列表 */
const VIEW_CYCLE: readonly WatchWidgetPopoverView[] = [
  WATCH_WIDGET_POPOVER_VIEW.LIST,
  WATCH_WIDGET_POPOVER_VIEW.HEATMAP,
  WATCH_WIDGET_POPOVER_VIEW.MARKET,
];

let unlistenLines: (() => void) | undefined;
let unlistenHeatmap: (() => void) | undefined;
let unlistenIndexes: (() => void) | undefined;

onMounted(() => {
  void (async () => {
    unlistenLines = await listen<{ rows: WatchWidgetRow[] }>(WATCH_WIDGET_EVENTS.LINES, (event) => {
      rows.value = event.payload.rows ?? [];
    });
    unlistenHeatmap = await listen<WatchWidgetHeatmapPayload>(WATCH_WIDGET_EVENTS.HEATMAP, (event) => {
      heatBoards.value = event.payload.boards ?? [];
    });
    unlistenIndexes = await listen<WatchWidgetIndexesPayload>(WATCH_WIDGET_EVENTS.INDEXES, (event) => {
      indexes.value = event.payload.indexes ?? [];
    });
    void emit(WATCH_WIDGET_EVENTS.REQUEST);
    // 挂载自报当前视图：主窗口据此校正视图记忆并按正确口径设定窗口尺寸
    void emit(WATCH_WIDGET_EVENTS.POPOVER_VIEW, { view: view.value } satisfies WatchWidgetPopoverViewPayload);
  })();
});

onBeforeUnmount(() => {
  unlistenLines?.();
  unlistenHeatmap?.();
  unlistenIndexes?.();
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

/** 头部图标：list → heatmap → market 循环互切（主窗口按新视图重算窗口高度） */
const onToggleView = (): void => {
  const next = (VIEW_CYCLE.indexOf(view.value) + 1) % VIEW_CYCLE.length;
  view.value = VIEW_CYCLE[next] ?? WATCH_WIDGET_POPOVER_VIEW.LIST;
  void emit(WATCH_WIDGET_EVENTS.POPOVER_VIEW, { view: view.value } satisfies WatchWidgetPopoverViewPayload);
};

/** 热力 tile 视图模型 */
interface HeatTile {
  /** 截断后的板块名（窄 tile 自动省略） */
  name: string;
  /** 涨跌幅文案 */
  percent: string;
  /** 涨跌语义色（随涨跌配色主题） */
  color: string;
  /** 内缩后的绘制矩形（tile 间留 2px 视觉缝） */
  rect: TreemapRect;
  /** 是否有空间显示名称行 */
  showName: boolean;
  /** 是否有空间显示涨跌幅行 */
  showPercent: boolean;
}

/**
 * 板块名按 tile 宽度截断（中文字宽 ≈ 字号，按 11px/字估算）
 * @param name 原始板块名
 * @param width tile 可用宽度
 * @returns 截断后的名称（放不下两个字时返回空串）
 */
const truncateName = (name: string, width: number): string => {
  const maxChars = Math.floor((width - 10) / 11);
  if (maxChars < 2) return '';
  return name.length <= maxChars ? name : `${name.slice(0, maxChars - 1)}…`;
};

/** 热力 tile 序列：面积 = 总市值权重（降序排布更方正），颜色 = 涨跌语义色阶 */
const heatTiles = computed<HeatTile[]>(() => {
  // 依赖 trendTheme：切换涨跌配色后本 computed 重新求值（色阶读 CSS 变量）
  void settingsStore.trendTheme;
  const boards = heatBoards.value;
  if (boards.length === 0) return [];
  const ordered = [...boards].sort((a, b) => b.totalMarketCap - a.totalMarketCap);
  const rects = squarifyLayout(
    ordered.map((board) => board.totalMarketCap),
    HEATMAP_VIEWBOX_WIDTH,
    HEATMAP_VIEWBOX_HEIGHT,
  );
  return ordered.map((board, index) => {
    const raw = rects[index] ?? { x: 0, y: 0, w: 0, h: 0 };
    const rect: TreemapRect = {
      x: raw.x + 1,
      y: raw.y + 1,
      w: Math.max(raw.w - 2, 0),
      h: Math.max(raw.h - 2, 0),
    };
    return {
      name: truncateName(board.name, rect.w),
      percent: formatPercent(board.changePercent),
      color: getTrendColorCss(board.changePercent),
      rect,
      showName: rect.h >= 22 && rect.w >= 26,
      showPercent: rect.h >= 38 && rect.w >= 32,
    };
  });
});
</script>

<template>
  <div
    class="flex h-full w-full select-none flex-col overflow-hidden rounded-xl border border-flat-weak bg-surface text-xs shadow-2xl"
  >
    <!-- 头部：标题随视图（候选计数 / 板块热力 / 大盘走势）+ 循环切换图标 + 收起 -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-flat-weak px-3"
      :style="headerStyle"
    >
      <div class="flex min-w-0 items-center gap-1">
        <p class="text-text">{{ headerTitle }}</p>
        <button
          class="pressable rounded-md p-1 leading-none"
          :class="view === VIEW_CYCLE[0] ? 'text-text-tertiary hover:text-text' : 'text-primary'"
          :title="isMarket ? '大盘走势' : isHeatmap ? '板块热力' : '自选盯盘'"
          @click="onToggleView"
        >
          <MenuIcon :name="viewIcon" :size="14" />
        </button>
      </div>
      <button class="pressable text-text-tertiary hover:text-text" @click="onClose">收起</button>
    </div>
    <!-- 列表视图：全部盯盘候选（超出行数上限时滚动） -->
    <div v-if="!isHeatmap && !isMarket" class="min-h-0 flex-1 overflow-y-auto">
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
        <span class="w-16 shrink-0 text-right tabular-nums text-text-secondary">{{ row.price }}</span>
        <span class="w-14 shrink-0 text-right tabular-nums" :class="HEADER_MARQUEE_TONE_CLASS[row.tone]">
          {{ row.percent }}
        </span>
      </button>
    </div>
    <!-- 热力视图：市场总览「板块热力」迷你版（行业板块 Top N，仅展示无任何交互） -->
    <div v-else-if="isHeatmap" class="min-h-0 flex-1 p-1.5">
      <svg
        v-if="heatTiles.length > 0"
        class="block h-full w-full"
        :viewBox="`0 0 ${HEATMAP_VIEWBOX_WIDTH} ${HEATMAP_VIEWBOX_HEIGHT}`"
        preserveAspectRatio="none"
      >
        <g v-for="(tile, index) in heatTiles" :key="index">
          <rect
            :x="tile.rect.x"
            :y="tile.rect.y"
            :width="tile.rect.w"
            :height="tile.rect.h"
            rx="3"
            :fill="tile.color"
          />
          <text
            v-if="tile.showName"
            :x="tile.rect.x + 5"
            :y="tile.rect.y + 14"
            :fill="CHART_LABEL_ON_TREND_COLOR"
            font-size="11"
          >
            {{ tile.name }}
          </text>
          <text
            v-if="tile.showPercent"
            :x="tile.rect.x + 5"
            :y="tile.rect.y + 28"
            :fill="CHART_LABEL_ON_TREND_COLOR"
            font-size="10"
            opacity="0.92"
          >
            {{ tile.percent }}
          </text>
        </g>
      </svg>
      <p v-else class="px-3 py-4 leading-relaxed text-text-tertiary">
        暂无板块数据：宿主 app:market 服务未就绪或上游拉取失败，稍后再试
      </p>
    </div>
    <!-- 大盘走势视图：上证 / 深证 / 创业板指 / 恒生四指数行情（仅展示无任何交互） -->
    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="indexes.length === 0" class="px-3 py-4 leading-relaxed text-text-tertiary">
        暂无指数数据：宿主 app:market 服务未就绪或上游拉取失败，稍后再试
      </p>
      <div
        v-for="row in indexes"
        :key="row.code"
        class="flex w-full items-center gap-2 px-3"
        :style="rowStyle"
      >
        <span class="min-w-0 flex-1 truncate text-left text-text">{{ row.name }}</span>
        <span class="w-16 shrink-0 text-right tabular-nums text-text-secondary">{{ row.price }}</span>
        <span class="w-14 shrink-0 text-right tabular-nums" :class="HEADER_MARQUEE_TONE_CLASS[row.tone]">
          {{ row.percent }}
        </span>
      </div>
    </div>
    <div class="shrink-0" :style="footerStyle" />
  </div>
</template>
