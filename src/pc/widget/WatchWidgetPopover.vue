<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { emit, listen } from '@tauri-apps/api/event';
import MenuIcon from '../components/ui/MenuIcon.vue';
import { HEADER_MARQUEE_TONE_CLASS } from '../../common/constants/header.constants.ts';
import { CHART_LABEL_ON_TREND_COLOR, CHART_LINE_BLUE } from '../../common/constants/chart.constants.ts';
import {
  MARKET_BOARD_SOURCES,
  MARKET_BOARD_SOURCE_DEFAULT,
  MARKET_NEWS_SOURCES,
  MARKET_NEWS_SOURCE_DEFAULT,
} from '../../common/constants/market-data.constants.ts';
import {
  WATCH_WIDGET_COLOR_CYCLE,
  WATCH_WIDGET_COLOR_DEFAULT,
  WATCH_WIDGET_COLOR_HEX,
  WATCH_WIDGET_EVENTS,
  WATCH_WIDGET_POPOVER_COLLAPSED_STORAGE_KEY,
  WATCH_WIDGET_POPOVER_FOOTER_PADDING,
  WATCH_WIDGET_POPOVER_HEADER_HEIGHT,
  WATCH_WIDGET_POPOVER_ROW_HEIGHT,
  WATCH_WIDGET_POPOVER_VIEW,
  WATCH_WIDGET_POPOVER_VIEW_OPTIONS,
} from '../plugins/watch-widget/constants';
import { useSettingsStore } from '../../common/stores/settings';
import { useWatchlistStore } from '../../common/stores/watchlist';
import { formatPercent } from '../../common/utils/format-percent';
import { getTrendColorCss } from '../../common/utils/trend-colors';
import { squarifyLayout } from './watch-heatmap-layout';
import type { TreemapRect } from './watch-heatmap-layout';
import type {
  WatchWidgetAlertPayload,
  WatchWidgetBoardPayload,
  WatchWidgetColorPayload,
  WatchWidgetHeatmapPayload,
  WatchWidgetIndexesPayload,
  WatchWidgetNewsItem,
  WatchWidgetNewsPayload,
  WatchWidgetOpenUrlPayload,
  WatchWidgetPopoverView,
  WatchWidgetPopoverViewPayload,
  WatchWidgetRow,
  WatchWidgetTurnoverPayload,
  WatchWidgetViewSourcePayload,
} from '../../common/types/watch-widget.types.ts';

/**
 * 任务栏盯盘小组件 · 气泡（六视图：候选列表 / 板块热力 / 大盘走势 / 成交额 / 热点新闻 / 今天炒什么）
 *
 * - 悬浮在迷你条正上方（位置与尺寸由主窗口插件按视图与行数设定，本窗口只管渲染）；
 * - 列表 / 热力 / 大盘数据与迷你条共用同一事件；成交额 / 新闻 / 热榜由主窗口经
 *   app:market-data 服务取数后推送（气泡窗口是最小权限，不发网络请求）；
 * - 2.3.0 起头部改用 select 下拉切换视图（视图扩到 6 个后 icon 循环不可用），
 *   切换经 popover-view 事件上报主窗口重算窗口高度；挂载时也上报一次当前视图；
 * - 候选列表按自选分组归组渲染（组头可展开 / 收起，默认全展开，收起记忆落 localStorage）；
 *   一票多组在每个所属组下都出现，与自选股页语义一致；
 * - 热点新闻支持六源切换、今天炒什么支持五平台切换（select 经 view-source 事件
 *   交主窗口记忆 + 重拉，主窗口推送载荷里的 source 是唯一权威回显）；
 * - 新闻标题单击走与热点新闻页一致的窗口逻辑打开原文（open-url 事件交主窗口执行）；
 * - 热榜行与候选行单击同样跳个股详情（open-stock）；
 *   单击行首分类颜色圆点 → 循环切换颜色并上报主窗口持久化；
 *   单击行尾阈值铃铛 → 行下展开内联阈值编辑器，保存 / 清除经 set-alert 事件交
 *   主窗口写候选仓储（与顶栏盯盘面板同一份候选，两端口径天然同步）；
 *   「收起」按钮走与迷你条单击相同的切换事件（展开态下即隐藏）。
 */

/** 候选行（主窗口推送） */
const rows = ref<WatchWidgetRow[]>([]);
/** 热力板块快照（主窗口推送，已按总市值排序取 Top N） */
const heatBoards = ref<WatchWidgetHeatmapPayload['boards']>([]);
/** 大盘指数快照（主窗口推送：市场总览同款 10 指数，上游缺行自动缺省） */
const indexes = ref<WatchWidgetIndexesPayload['indexes']>([]);
/** 成交额快照（主窗口推送，文案已按宿主口径造好） */
const turnover = ref<WatchWidgetTurnoverPayload | null>(null);
/** 新闻标题快照（主窗口推送：当前源的标题行） */
const news = ref<WatchWidgetNewsPayload | null>(null);
/** 热榜快照（主窗口推送：当前平台的榜单行） */
const board = ref<WatchWidgetBoardPayload | null>(null);
/** 当前内容视图（窗口隐藏复用期间组件不卸载，视图状态天然保持） */
const view = ref<WatchWidgetPopoverView>(WATCH_WIDGET_POPOVER_VIEW.LIST);
/** 新闻源（本地选择乐观更新；主窗口推送载荷里的 source 是权威回显） */
const newsSource = ref<string>(MARKET_NEWS_SOURCE_DEFAULT);
/** 热榜平台（同上） */
const boardSource = ref<string>(MARKET_BOARD_SOURCE_DEFAULT);

/** 涨跌配色主题（色阶读 CSS 变量，切换主题后热力 tile 需重算颜色） */
const settingsStore = useSettingsStore();
/** 自选分组（列表视图按它归组；气泡窗口与主窗口同源同 store） */
const watchlistStore = useWatchlistStore();

const isHeatmap = computed(() => view.value === WATCH_WIDGET_POPOVER_VIEW.HEATMAP);
const isMarket = computed(() => view.value === WATCH_WIDGET_POPOVER_VIEW.MARKET);
const isTurnover = computed(() => view.value === WATCH_WIDGET_POPOVER_VIEW.TURNOVER);
const isNews = computed(() => view.value === WATCH_WIDGET_POPOVER_VIEW.NEWS);

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

// ---------- 候选列表分组（按自选分组归组，默认全展开） ----------

/** 无法归入任何自选分组的候选落到这个兜底桶（理论不出现：候选 ∩ 自选恒有组） */
const UNGROUPED_BUCKET_ID = '__ungrouped__';

/** 分组后的列表段（组头 + 组内候选行） */
interface PopoverRowGroup {
  /** 分组 id（收起记忆的 key；兜底桶用 UNGROUPED_BUCKET_ID） */
  id: string;
  /** 分组名 */
  name: string;
  /** 组内候选行（一只候选属于多个分组时在每组都出现） */
  rows: WatchWidgetRow[];
}

/** 按自选分组归组候选行：组序跟随自选页分组顺序，空组不渲染 */
const groupedRows = computed<PopoverRowGroup[]>(() => {
  const result: PopoverRowGroup[] = [];
  const grouped = new Set<string>();
  for (const group of watchlistStore.groups) {
    const groupRows = rows.value.filter((row) =>
      group.stocks.some((stock) => stock.symbol === row.symbol),
    );
    if (groupRows.length === 0) continue;
    for (const row of groupRows) grouped.add(row.symbol);
    result.push({ id: group.id, name: group.name, rows: groupRows });
  }
  const rest = rows.value.filter((row) => !grouped.has(row.symbol));
  if (rest.length > 0) result.push({ id: UNGROUPED_BUCKET_ID, name: '未分组', rows: rest });
  return result;
});

/**
 * 从 localStorage 读收起记忆（损坏 / 不可用时回落全展开）
 * @returns 收起中的分组 id 列表
 */
const readCollapsedIds = (): string[] => {
  try {
    const raw = localStorage.getItem(WATCH_WIDGET_POPOVER_COLLAPSED_STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

/** 收起中的分组 id 集合（默认全展开） */
const collapsedIds = ref<Set<string>>(new Set(readCollapsedIds()));

/**
 * 查询分组是否收起
 * @param id 分组 id
 * @returns 是否收起
 */
const isCollapsed = (id: string): boolean => collapsedIds.value.has(id);

/**
 * 切换分组展开 / 收起（记忆落 localStorage，应用重启后保持）
 * @param id 分组 id
 */
const toggleGroup = (id: string): void => {
  const next = new Set(collapsedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedIds.value = next;
  try {
    localStorage.setItem(
      WATCH_WIDGET_POPOVER_COLLAPSED_STORAGE_KEY,
      JSON.stringify([...next]),
    );
  } catch {
    // 存储不可用（隐私模式等）只影响记忆，不影响本次交互
  }
};

// ---------- 视图与源切换 ----------

/** 头部 select 切视图：上报主窗口重算窗口高度（与旧 icon 切换同一事件通道） */
const onViewSelect = (): void => {
  void emit(WATCH_WIDGET_EVENTS.POPOVER_VIEW, { view: view.value } satisfies WatchWidgetPopoverViewPayload);
};

/** 切新闻源：乐观更新本地回显，主窗口记忆 + 立即重拉（推送载荷到达后以 source 为准） */
const onNewsSourceChange = (): void => {
  void emit(WATCH_WIDGET_EVENTS.VIEW_SOURCE, {
    newsSource: newsSource.value,
  } satisfies WatchWidgetViewSourcePayload);
};

/** 切热榜平台（同上） */
const onBoardSourceChange = (): void => {
  void emit(WATCH_WIDGET_EVENTS.VIEW_SOURCE, {
    boardSource: boardSource.value,
  } satisfies WatchWidgetViewSourcePayload);
};

let unlistenLines: (() => void) | undefined;
let unlistenHeatmap: (() => void) | undefined;
let unlistenIndexes: (() => void) | undefined;
let unlistenTurnover: (() => void) | undefined;
let unlistenNews: (() => void) | undefined;
let unlistenBoard: (() => void) | undefined;

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
    unlistenTurnover = await listen<WatchWidgetTurnoverPayload>(WATCH_WIDGET_EVENTS.TURNOVER, (event) => {
      turnover.value = event.payload ?? null;
    });
    unlistenNews = await listen<WatchWidgetNewsPayload>(WATCH_WIDGET_EVENTS.NEWS, (event) => {
      news.value = event.payload ?? null;
      // 主窗口是源选择的权威：回显它的当前值（覆盖本地乐观值）
      if (event.payload?.source) newsSource.value = event.payload.source;
    });
    unlistenBoard = await listen<WatchWidgetBoardPayload>(WATCH_WIDGET_EVENTS.HOTBOARD, (event) => {
      board.value = event.payload ?? null;
      if (event.payload?.source) boardSource.value = event.payload.source;
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
  unlistenTurnover?.();
  unlistenNews?.();
  unlistenBoard?.();
});

/**
 * 单击候选 / 热榜行：打开该标的（主窗口唤起 + 跳详情页）
 * @param symbol 完整符号
 */
const onPickStock = (symbol: string): void => {
  if (symbol) void emit(WATCH_WIDGET_EVENTS.OPEN_STOCK, { symbol });
};

/**
 * 单击新闻标题：交主窗口用与热点新闻页一致的窗口逻辑打开原文
 * （气泡窗口 focusable:false 且无 shell 权限，自己开不了）
 * @param item 被点的标题行
 */
const onOpenNews = (item: WatchWidgetNewsItem): void => {
  if (!item.url) return;
  void emit(WATCH_WIDGET_EVENTS.OPEN_URL, { url: item.url } satisfies WatchWidgetOpenUrlPayload);
};

/**
 * 点击行首分类圆点：按固定顺序循环切换颜色并上报主窗口持久化
 * （`@click.stop` 阻断行点击，不会顺带打开详情页）
 * @param row 被点的候选行
 */
const onCycleColor = (row: WatchWidgetRow): void => {
  if (!row.symbol) return;
  // 旧载荷可能缺 color 字段：按默认白色起算，保证循环永远有下一个
  const order = WATCH_WIDGET_COLOR_CYCLE;
  const current = order.indexOf(row.color ?? WATCH_WIDGET_COLOR_DEFAULT);
  const next = order[(current + 1) % order.length] ?? WATCH_WIDGET_COLOR_DEFAULT;
  void emit(WATCH_WIDGET_EVENTS.SET_COLOR, {
    symbol: row.symbol,
    color: next,
  } satisfies WatchWidgetColorPayload);
};

// ---------- 阈值提醒编辑（set-alert：气泡端编辑，主窗口写候选仓储后随 lines 回推） ----------

/** 正在编辑阈值的候选符号（null = 编辑器收起；同时只编辑一个） */
const editingAlertSymbol = ref<string | null>(null);

/** 编辑中的阈值类型（价格 / 涨跌幅；与面板端 AlertEditor 同语义，清除走单独按钮） */
const alertKind = ref<'price' | 'change'>('price');

/** 编辑中的比较方向（true = 涨到 / 涨幅达到） */
const alertAbove = ref(true);

/** 阈值数值的输入原文（字符串承接，避免输入中途被 Number 吃掉小数点） */
const alertValueText = ref('');

/**
 * 打开某行的阈值编辑器并用行载荷播种（旧载荷缺字段时按默认值起算）
 * @param row 被点铃铛的候选行
 */
const openAlertEditor = (row: WatchWidgetRow): void => {
  editingAlertSymbol.value = row.symbol;
  alertKind.value = row.alertKind === 'change' ? 'change' : 'price';
  alertAbove.value = row.alertAbove !== false;
  alertValueText.value = row.alertValue == null ? '' : String(row.alertValue);
};

/** 编辑中的阈值是否为价格型 */
const isPriceKind = computed(() => alertKind.value === 'price');

/** 方向选项文案（随阈值类型变化：价格说「涨到 / 跌到」、涨跌幅说「涨幅达到 / 跌幅达到」） */
const alertDirectionLabels = computed(() =>
  isPriceKind.value
    ? { above: '涨到', below: '跌到' }
    : { above: '涨幅达到', below: '跌幅达到' },
);

/** 数值输入框占位文案 */
const alertValuePlaceholder = computed(() =>
  isPriceKind.value ? '如 1700.00' : '如 5.00',
);

/**
 * 全角数字 / 全角小数点归一为半角（中文输入法下打出来的「１０」也能识别）
 * @param text 输入框原文
 * @returns 归一后的半角文本
 */
const normalizeHalfWidth = (text: string): string =>
  text.replace(/[０-９．]/g, (ch) =>
    ch === '．' ? '.' : String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );

/** 输入解析出的数值（必须为正数；非法为 null，主窗口侧还会再校验一次） */
const alertParsedValue = computed<number | null>(() => {
  const trimmed = normalizeHalfWidth(alertValueText.value).trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
});

/** 保存按钮可用性 */
const alertCanSave = computed(() => alertParsedValue.value !== null);

/**
 * 保存阈值：经 set-alert 交主窗口写候选仓储（armed 由引擎复位，气泡不必关心）
 */
const onSaveAlert = (): void => {
  const symbol = editingAlertSymbol.value;
  const value = alertParsedValue.value;
  if (!symbol || value === null) return;
  void emit(WATCH_WIDGET_EVENTS.SET_ALERT, {
    symbol,
    kind: alertKind.value,
    above: alertAbove.value,
    value,
  } satisfies WatchWidgetAlertPayload);
  editingAlertSymbol.value = null;
};

/**
 * 清除阈值（编辑器随之收起）
 */
const onClearAlert = (): void => {
  const symbol = editingAlertSymbol.value;
  if (!symbol) return;
  void emit(WATCH_WIDGET_EVENTS.SET_ALERT, { symbol, clear: true } satisfies WatchWidgetAlertPayload);
  editingAlertSymbol.value = null;
};

/** 收起气泡（走切换事件：展开态下即隐藏） */
const onClose = (): void => {
  void emit(WATCH_WIDGET_EVENTS.POPOVER_TOGGLE);
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
    <!-- 头部：视图 select 下拉（2.3.0 起替代 icon 循环）+ 收起 -->
    <div
      class="flex shrink-0 items-center justify-between gap-2 border-b border-flat-weak px-3"
      :style="headerStyle"
    >
      <select
        v-model="view"
        class="h-7 max-w-[170px] rounded-md border border-flat-weak bg-flat-weak/60 px-1.5 text-xs text-text outline-none"
        aria-label="切换气泡视图"
        @change="onViewSelect"
      >
        <option
          v-for="option in WATCH_WIDGET_POPOVER_VIEW_OPTIONS"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
      <button class="pressable text-text-tertiary hover:text-text" @click="onClose">收起</button>
    </div>

    <!-- 候选列表视图：按自选分组归组（组头可展开 / 收起，默认全展开；超出行数上限时滚动） -->
    <div v-if="view === WATCH_WIDGET_POPOVER_VIEW.LIST" class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="rows.length === 0" class="px-3 py-4 leading-relaxed text-text-tertiary">
        还没有盯盘候选：在自选股「操作」列点「盯盘」，标的就会出现在这里
      </p>
      <div v-for="group in groupedRows" v-else :key="group.id">
        <button
          type="button"
          class="pressable flex w-full items-center gap-1 px-3 py-1 text-[11px] text-text-tertiary hover:bg-flat-weak/40 hover:text-text"
          :title="isCollapsed(group.id) ? '展开该分组' : '收起该分组'"
          @click="toggleGroup(group.id)"
        >
          <MenuIcon :name="isCollapsed(group.id) ? 'chevronRight' : 'chevronDown'" :size="12" />
          <span class="min-w-0 truncate">{{ group.name }}</span>
          <span class="shrink-0 tabular-nums">· {{ group.rows.length }}</span>
        </button>
        <template v-if="!isCollapsed(group.id)">
          <template v-for="row in group.rows" :key="row.symbol">
            <button
              class="pressable flex w-full items-center gap-2 px-3 hover:bg-flat-weak/60"
              :style="rowStyle"
              :title="`${row.name} 单击打开详情页`"
              @click="onPickStock(row.symbol)"
            >
              <span v-if="row.fired" class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <!-- 分类颜色圆点：点击循环切换（白 → 红 → 橙 → 黄 → 蓝 → 绿 → 紫 → 粉），不触发行点击 -->
              <span
                class="h-2 w-2 shrink-0 cursor-pointer rounded-full border border-flat-weak"
                :style="{ backgroundColor: WATCH_WIDGET_COLOR_HEX[row.color] }"
                title="点击切换分类颜色（持仓 / 关注 / 其他）"
                @click.stop="onCycleColor(row)"
              />
              <span class="min-w-0 flex-1 truncate text-left text-text">{{ row.name }}</span>
              <span class="w-16 shrink-0 text-right tabular-nums text-text-secondary">{{ row.price }}</span>
              <span class="w-14 shrink-0 text-right tabular-nums" :class="HEADER_MARQUEE_TONE_CLASS[row.tone]">
                {{ row.percent }}
              </span>
              <!-- 阈值铃铛：常显（暗色主题白色 / 亮色主题黑色，随 text-text），hover 主题色；
                   已设阈值按触发方向上色（与顶栏盯盘面板同口径），单击展开行下编辑器 -->
              <span
                class="shrink-0 cursor-pointer hover:text-primary"
                :class="row.alertKind ? (row.alertAbove ? 'text-up' : 'text-down') : 'text-text'"
                :title="
                  row.alertText
                    ? `${row.name} 阈值：${row.alertText}（单击调整）`
                    : `${row.name}：设阈值提醒`
                "
                @click.stop="openAlertEditor(row)"
              >
                <MenuIcon name="bell" :size="12" />
              </span>
            </button>
            <!-- 内联阈值编辑器：一次只展开一个；保存 / 清除经 set-alert 交主窗口写候选仓储，
                 与顶栏盯盘面板同一份数据，两端口径天然同步（编辑器展开高度不占窗口高度口径，
                 列表自身滚动兜底） -->
            <div
              v-if="editingAlertSymbol === row.symbol"
              class="mx-3 mb-1.5 rounded-lg border border-flat-weak bg-flat-weak/40 p-2"
              @click.stop
            >
              <div class="flex items-center gap-1.5">
                <select
                  v-model="alertKind"
                  class="h-6 min-w-0 flex-1 rounded-md border border-flat-weak bg-flat-weak/60 px-1 text-[11px] text-text outline-none"
                  aria-label="阈值类型"
                >
                  <option value="price">价格</option>
                  <option value="change">涨跌幅</option>
                </select>
                <select
                  v-model="alertAbove"
                  class="h-6 min-w-0 flex-1 rounded-md border border-flat-weak bg-flat-weak/60 px-1 text-[11px] text-text outline-none"
                  aria-label="触发方向"
                >
                  <option :value="true">{{ alertDirectionLabels.above }}</option>
                  <option :value="false">{{ alertDirectionLabels.below }}</option>
                </select>
              </div>
              <div class="mt-1.5 flex items-center gap-1.5">
                <input
                  v-model="alertValueText"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  class="h-6 min-w-0 flex-1 rounded-md border border-flat-weak bg-flat-weak/60 px-1.5 text-[11px] tabular-nums text-text outline-none"
                  :placeholder="alertValuePlaceholder"
                  aria-label="阈值数值"
                />
                <button
                  type="button"
                  class="pressable shrink-0 rounded-md px-2 py-1 text-[11px] text-text-tertiary hover:text-down active:scale-95"
                  @click="onClearAlert"
                >
                  清除
                </button>
                <button
                  type="button"
                  class="pressable shrink-0 rounded-md bg-primary-weak px-2 py-1 text-[11px] font-medium text-primary disabled:opacity-40 active:scale-95"
                  :disabled="!alertCanSave"
                  @click="onSaveAlert"
                >
                  保存
                </button>
              </div>
              <p class="mt-1 text-[10px] leading-relaxed text-text-tertiary">
                到价后右下角弹提醒；触发过一次，等回到阈值内侧再重新生效
              </p>
            </div>
          </template>
        </template>
      </div>
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

    <!-- 大盘走势视图：市场总览同款 10 指数行情（仅展示无任何交互） -->
    <div v-else-if="isMarket" class="min-h-0 flex-1 overflow-y-auto">
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

    <!-- 成交额视图：市场总览「实时成交额」模块精简版（主行大数字 + 指标网格 + 分时双线） -->
    <div v-else-if="isTurnover" class="flex min-h-0 flex-1 flex-col px-3 py-2">
      <template v-if="turnover">
        <p class="text-[10px] text-text-tertiary">今日实时</p>
        <p class="text-xl font-semibold tabular-nums leading-tight text-text">{{ turnover.headline }}</p>
        <div class="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-1">
          <div v-for="row in turnover.rows" :key="row.label" class="min-w-0">
            <p class="truncate text-[10px] text-text-tertiary">{{ row.label }}</p>
            <p
              class="truncate text-xs font-medium tabular-nums"
              :class="row.tone ? HEADER_MARQUEE_TONE_CLASS[row.tone] : 'text-text-secondary'"
            >
              {{ row.value }}
            </p>
          </div>
        </div>
        <div v-if="turnover.spark" class="mt-auto">
          <div class="flex items-center gap-3 text-[10px] text-text-tertiary">
            <span><i class="mr-1 inline-block h-0.5 w-3 align-middle" :style="{ background: CHART_LINE_BLUE }" />今日累计</span>
            <span><i class="mr-1 inline-block h-0 w-3 align-middle border-t border-dashed border-text-tertiary" />昨日同时刻</span>
          </div>
          <svg
            class="mt-1 h-9 w-full"
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            role="img"
            aria-label="市场成交额分时对比"
          >
            <path
              :d="turnover.spark.pre"
              fill="none"
              stroke="var(--color-text-tertiary)"
              stroke-width="1"
              stroke-dasharray="2 2"
              vector-effect="non-scaling-stroke"
              opacity="0.7"
            />
            <path
              :d="turnover.spark.today"
              fill="none"
              :stroke="CHART_LINE_BLUE"
              stroke-width="1.6"
              vector-effect="non-scaling-stroke"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      </template>
      <p v-else class="py-4 leading-relaxed text-text-tertiary">
        暂无成交额数据：宿主 app:market-data 服务未就绪或上游拉取失败，稍后再试
      </p>
    </div>

    <!-- 热点新闻视图：六源切换，只显示标题；单击走主窗口的原文窗口逻辑 -->
    <div v-else-if="isNews" class="flex min-h-0 flex-1 flex-col">
      <div class="flex shrink-0 items-center justify-between gap-2 px-3 pb-1 pt-1.5">
        <span class="text-[10px] text-text-tertiary">新闻源</span>
        <select
          v-model="newsSource"
          class="h-6 rounded-md border border-flat-weak bg-flat-weak/60 px-1 text-[11px] text-text outline-none"
          aria-label="切换新闻源"
          @change="onNewsSourceChange"
        >
          <option v-for="option in MARKET_NEWS_SOURCES" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <template v-if="news && news.items.length > 0">
          <button
            v-for="item in news.items"
            :key="item.url"
            type="button"
            class="pressable flex w-full items-center gap-2 px-3 hover:bg-flat-weak/60"
            :style="rowStyle"
            :title="`${item.title}（单击打开原文）`"
            @click="onOpenNews(item)"
          >
            <span class="min-w-0 flex-1 truncate text-left text-text">{{ item.title }}</span>
            <span v-if="item.timeText" class="w-10 shrink-0 text-right text-[10px] tabular-nums text-text-tertiary">
              {{ item.timeText }}
            </span>
          </button>
        </template>
        <p v-else class="px-3 py-4 leading-relaxed text-text-tertiary">
          暂无新闻数据：宿主 app:market-data 服务未就绪或上游拉取失败，稍后再试
        </p>
      </div>
    </div>

    <!-- 今天炒什么视图：五平台切换；行点击跳个股详情 -->
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div class="flex shrink-0 items-center justify-between gap-2 px-3 pb-1 pt-1.5">
        <span class="text-[10px] text-text-tertiary">数据源</span>
        <select
          v-model="boardSource"
          class="h-6 rounded-md border border-flat-weak bg-flat-weak/60 px-1 text-[11px] text-text outline-none"
          aria-label="切换热榜平台"
          @change="onBoardSourceChange"
        >
          <option v-for="option in MARKET_BOARD_SOURCES" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <template v-if="board && board.rows.length > 0">
          <button
            v-for="row in board.rows"
            :key="row.symbol"
            type="button"
            class="pressable flex w-full items-center gap-2 px-3 hover:bg-flat-weak/60"
            :style="rowStyle"
            :title="`${row.name} 单击打开详情页`"
            @click="onPickStock(row.symbol)"
          >
            <span class="min-w-0 flex-1 truncate text-left text-text">{{ row.name }}</span>
            <span class="w-16 shrink-0 text-right tabular-nums text-text-secondary">{{ row.price }}</span>
            <span class="w-14 shrink-0 text-right tabular-nums" :class="HEADER_MARQUEE_TONE_CLASS[row.tone]">
              {{ row.percent }}
            </span>
            <span v-if="row.heatLabel" class="w-16 shrink-0 truncate text-right text-[10px] text-text-tertiary">
              {{ row.heatLabel }}
            </span>
          </button>
        </template>
        <p v-else class="px-3 py-4 leading-relaxed text-text-tertiary">
          暂无榜单数据：宿主 app:market-data 服务未就绪或上游拉取失败，稍后再试
        </p>
      </div>
    </div>

    <div class="shrink-0" :style="footerStyle" />
  </div>
</template>
