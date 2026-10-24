<script setup lang="ts">
import { computed, onActivated, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEventListener } from '@vueuse/core';
import type { KLineData } from 'klinecharts';
import { toFullSymbol } from '../../common/utils/to-full-symbol';
import { buildStockAnalysisPrompt } from '../../common/utils/build-stock-analysis-prompt';
import { requestAgentAnalysis } from '../agent/agent-bridge';
import type { FullQuote } from '../../common/types/stock-quote.types.ts';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseConfirmModal from '../components/ui/BaseConfirmModal.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import ChartIndicatorConfigButton from '../components/ui/ChartIndicatorConfigButton.vue';
import { useSettingsStore } from '../../common/stores/settings';
import { useUiStore } from '../../common/stores/ui';
import { useStockContextStore } from '../../common/stores/stock-context';
import { ROUTE_PATH } from '../../common/constants/router-meta.constants.ts';
import { HOST_HEADER_ITEM } from '../../common/constants/header.constants.ts';
import { formatPercent } from '../../common/utils/format-percent';
import { formatPrice } from '../../common/utils/format-price';
import KlineChart from '../../common/components/charts/KlineChart.vue';
import { useKlineDrawing } from '../../common/composables/use-kline-drawing';
import { KLINE_DRAWING_SHAPES } from '../../common/constants/kline-drawing.constants.ts';
import StockQuoteHeader from '../components/business/StockQuoteHeader.vue';
import StockOrderBook from '../components/business/StockOrderBook.vue';
import { useDockPanelStore } from '../../common/stores/dock-panel';
import { fetchFullQuotes } from '../../common/api/quotes.api.ts';
import { fetchKlineCached } from '../../common/api/kline-cache.api.ts';
import { listTradeRecordsBySymbol } from '../../common/api/account-records-db.api.ts';
import type { AccountTradeRecord } from '../../common/types/account.types.ts';
import {
  buildDailyTradeMarks,
  buildIntradayTradeMarks,
  type TradeMark,
} from '../../common/utils/trade-marks';
import { usePolling } from '../../common/composables/use-polling';
import { useChartPeriod } from '../../common/composables/use-chart-period';
import { useDetailPanelCollapse } from '../../common/composables/use-detail-panel-collapse';
import {
  PAGE_HEADER_ACTIONS_TARGET,
  usePageHeaderSlot,
} from '../../common/composables/use-page-header-slot';
import { POLLING_INTERVAL } from '../../common/constants/polling.constants.ts';
import { CHART_PERIOD_OPTIONS } from '../../common/constants/stock-detail.constants.ts';
import { useDataCacheStore } from '../../common/stores/data-cache';
import { useWatchlistStore } from '../../common/stores/watchlist';
import { DATA_CACHE_KEY } from '../../common/constants/data-cache.constants.ts';
import { DEFAULT_GROUP_ID } from '../../common/constants/watchlist.constants.ts';
import { getTrendByChangePercent } from '../../common/constants/trend.constants.ts';
import { TREND_TEXT_CLASS } from '../../common/constants/stock-colors.constants.ts';

/**
 * 股票详情整页（/stock-detail/:symbol，全站双击个股进入）：
 *
 * 顶栏（返回 + 标的 + 报价摘要 + 指标/画线工具）+ 主图 K 线（撑满整列高度，
 * 周期按钮组在卡头部）+ 右侧信息栏（报价头 + 五档盘口固定展示，≥1280px）。
 * 底部页签 2026-10-24 起整体撤销：交易记录 / 成分股与财务 / 资讯 / 基金概况
 * 一并迁入顶栏「更多信息」按钮打开的右侧抽屉（StockF10Drawer）。
 *
 * 数据链路与侧栏（StockDetailPanel）同构：报价 4s 轮询、K 线单次拉取，
 * 快照经 data-cache 互通（同 cache key 前缀）
 */
const route = useRoute();
const router = useRouter();
const dataCache = useDataCacheStore();
const watchlistStore = useWatchlistStore();
const settingsStore = useSettingsStore();
const uiStore = useUiStore();
const dockPanel = useDockPanelStore();

/**
 * 页面全屏（本页铺满应用窗口）：入口在 K 线卡头部的全屏按钮，
 * 置位后 MainLayout 隐藏侧栏与页内页头，本页 K 线行改 flex-1 拉伸；
 * Esc / 切页由 MainLayout 兜底退出
 */
const isPageFullscreen = computed(() => uiStore.pageFullscreen);
const stockContext = useStockContextStore();

/**
 * 归一化符号：600519 / SH600519 / sh600519 等形态统一为 sh600519
 */
const symbol = computed<string>(() => toFullSymbol(String(route.params.symbol ?? '')));

/** 当前股票是否已加入自选（任一分组） */
const isInWatchlist = computed(() => watchlistStore.allSymbols.includes(symbol.value));

/** 「AI 分析」入口跟随顶栏「Agent 分析」条目的显隐开关（设置 → 布局编排 → 右上角工具编排） */
const agentEntryVisible = computed(() =>
  !settingsStore.hiddenHeaderItems.includes(HOST_HEADER_ITEM.AGENT),
);

/** 「AI 分析」：把当前个股交给 Agent 做短期综合分析（消息 / 资金 / 情绪 / 外围 / 政策 + 多空震荡结论） */
const onAiAnalysis = (): void => {
  void requestAgentAnalysis(
    buildStockAnalysisPrompt({ name: quoteRef.value?.name ?? '', symbol: symbol.value }),
  );
};

/**
 * 页级动作挂载守卫：「AI 分析」按钮上移 MainLayout 页头右侧（插件设置之前），
 * Teleport 投射需配合激活守卫（KeepAlive 缓存页切走时按钮不会自动撤离，见 composable 说明）
 */
const { active: headerSlotActive } = usePageHeaderSlot();

// ---------- 报价（4s 轮询；快照播种，与侧栏互通） ----------
const quoteRef = ref<FullQuote | null>(
  dataCache.get<FullQuote>(DATA_CACHE_KEY.DETAIL_QUOTE_PREFIX + symbol.value),
);

const fetchQuote = async (): Promise<void> => {
  const quotes = await fetchFullQuotes([symbol.value]);
  quoteRef.value = quotes[0] ?? null;
  if (quoteRef.value) {
    dataCache.set(DATA_CACHE_KEY.DETAIL_QUOTE_PREFIX + symbol.value, quoteRef.value);
  }
};

usePolling({
  task: fetchQuote,
  intervalMs: POLLING_INTERVAL.QUOTES_INTRADAY,
  tradingAware: true,
});

/** 报价涨跌趋势色（顶栏摘要用） */
const quoteTrendClass = computed(() =>
  TREND_TEXT_CLASS[getTrendByChangePercent(quoteRef.value?.changePercent ?? 0)],
);

/**
 * 顶栏「更多信息」：打开右侧资料抽屉（交易记录 / 成分股（ETF）/ 财务 / 资讯 /
 * 基本资料 / 发行相关 / 高管简介 / 参股控股，场内基金以基金概况替代财务），
 * 王总 2026-10-24 指定（原「F10」按钮承载）
 */
const openF10 = (): void => {
  dockPanel.openF10(symbol.value, quoteRef.value?.name ?? '');
};

// ---------- 图表周期（按钮组：分时 / 五日 / 5分 / 日K / 周K / 月K） ----------
// 周期选择持久化到设置 store：用户选了哪个周期，下次打开默认还是它（与侧栏互通）
const chartPeriod = useChartPeriod();

/** 图表模式：分时 / 五日为分时线，其余为蜡烛图 */
const chartMode = computed<'timeline' | 'candle'>(() =>
  chartPeriod.value === 'minute' || chartPeriod.value === 'fiveDay' ? 'timeline' : 'candle',
);

// ---------- 画线工具（K 线卡头部工具条；蜡烛模式可用，分时/五日置灰） ----------
/** KlineChart 组件实例引用（经 defineExpose 拿 chart 实例） */
const klineChartRef = ref<InstanceType<typeof KlineChart> | null>(null);

/** 画线可用性（蜡烛模式；分时/五日的时间轴是补齐的固定轴，锚点语义不成立） */
const drawingEnabled = computed(() => chartMode.value === 'candle');

const drawing = useKlineDrawing(
  computed(() => klineChartRef.value?.chart ?? null),
  symbol,
  chartPeriod,
  drawingEnabled,
);

/** K 线快照键（符号 + 周期，不复权无口径差异；与侧栏互通） */
const klineCacheKey = computed(
  () => `${DATA_CACHE_KEY.DETAIL_KLINE_PREFIX}${symbol.value}.${chartPeriod.value}`,
);

const klines = ref<KLineData[]>(dataCache.get<KLineData[]>(klineCacheKey.value) ?? []);
const isKlineLoading = ref(klines.value.length === 0);
const klineError = ref(false);

const loadKline = async (): Promise<void> => {
  isKlineLoading.value = true;
  klineError.value = false;
  try {
    // 快照播种：同符号同周期先前拉取过则秒出
    const cachedBars = dataCache.get<KLineData[]>(klineCacheKey.value);
    if (cachedBars) {
      klines.value = cachedBars;
      isKlineLoading.value = false;
    }
    // 日 K 走本地缓存（首次全量落库，之后只补缺口）；分时等周期退回纯网络取数
    const bars = await fetchKlineCached(symbol.value, chartPeriod.value);
    klines.value = bars;
    dataCache.set(klineCacheKey.value, bars);
  } catch (error) {
    // 失败保留上一次成功数据（首次失败则展示空态）
    klineError.value = klines.value.length === 0;
    console.error('[stock-detail-page] kline', error);
  } finally {
    isKlineLoading.value = false;
  }
};

// ---------- 交易记录（本地成交流水库，按股票） ----------
// 仅作 K 线 BS/T 标注的数据源；记录列表 UI 在「更多信息」抽屉的
// 交易记录页签（StockTradeRecordsTab，2026-10-24 王总指定迁入抽屉）
/** 该股成交记录（跨账户；来源为账户成交流水本机库） */
const tradeRecords = ref<AccountTradeRecord[]>([]);

/** 拉取该股全部成交记录（本地 SQLite 直读，非网络请求，失败即空列表） */
const loadTradeRecords = async (): Promise<void> => {
  try {
    tradeRecords.value = await listTradeRecordsBySymbol(symbol.value);
  } catch (error) {
    console.error('[stock-detail-page] trade-records', error);
    tradeRecords.value = [];
  }
};

// ---------- K 线图 BS/T 标注（交易记录映射为覆盖物） ----------
/** 分时 / 五日：每笔成交一个点（同分钟买卖合并 T） */
const intradayTradeMarks = computed<TradeMark[]>(() =>
  buildIntradayTradeMarks(tradeRecords.value),
);
/** 日K等蜡烛图：按成交日聚合（B / S / T） */
const dailyTradeMarks = computed<TradeMark[]>(() => buildDailyTradeMarks(tradeRecords.value));
/** 当前图表模式对应的标注集（两套粒度不能混用：分钟点吸附日K会全部错位重叠） */
const chartTradeMarks = computed<TradeMark[]>(() =>
  chartMode.value === 'timeline' ? intradayTradeMarks.value : dailyTradeMarks.value,
);

// 符号变化全量重拉（KeepAlive 缓存后再次进入也触发）；周期变化只刷 K 线
// ⚠️ 依赖的加载函数必须都在本 watch 之前声明（immediate 会在 setup 阶段同步执行）
watch(
  symbol,
  () => {
    void loadKline();
    void fetchQuote();
    void loadTradeRecords();
  },
  { immediate: true },
);
watch(chartPeriod, () => {
  void loadKline();
});

// KeepAlive 缓存页面：同符号切走再切回时 symbol watch 不触发，重拉 K 线与成交记录
// （报价由 usePolling 恢复时补刷，无需处理；首次 onActivated 紧跟首屏 watch 触发，跳过）
let detailActivatedOnce = false;
onActivated(() => {
  if (!detailActivatedOnce) {
    detailActivatedOnce = true;
    return;
  }
  void loadKline();
  void loadTradeRecords();
});

/** 返回上一页（进入来源页；无历史时回退首页由 router 兜底） */
const goBack = (): void => {
  void router.back();
};

/**
 * 列表内切换股票：replace 不堆积历史栈（watch(symbol) 自动全量重拉）
 * @param next 目标符号
 */
const switchStock = (next: string): void => {
  if (next === symbol.value) return;
  void router.replace(`${ROUTE_PATH.STOCK_DETAIL}/${next}`);
};

/**
 * 快捷键切换：Ctrl + ↓ / Ctrl + ↑ 在左侧来源列表内切到下一只 / 上一只（循环）
 *
 * - 来源列表为空或只有一只时不产生任何行为（没有可切换的目标）；
 * - 当前股不在列表里时不产生任何行为（无从推断方向）；
 * - 输入框聚焦 / 弹窗打开时不接管：Ctrl + ↑↓ 在输入框里是按词移动光标的编辑键。
 * @param event 键盘事件
 */
const onStockSwitchKeydown = (event: KeyboardEvent): void => {
  if (!event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]')) {
    return;
  }
  if (document.querySelector('[role="dialog"]')) return;
  const stocks = stockContext.stocks;
  if (stocks.length <= 1) return;
  const index = stocks.findIndex((stock) => stock.symbol === symbol.value);
  if (index < 0) return;
  const step = event.key === 'ArrowDown' ? 1 : -1;
  const next = stocks[(index + step + stocks.length) % stocks.length];
  if (!next || next.symbol === symbol.value) return;
  event.preventDefault();
  switchStock(next.symbol);
};
useEventListener(window, 'keydown', onStockSwitchKeydown);

// 收起态由 useDetailPanelCollapse 模块级共享：KeepAlive 按 path（含 symbol）缓存页面实例，
// 组件内 ref 会按股票各存一份（股票 A 收起、切 B 变展开），故提升到组件实例之外
const { isListCollapsed, isInfoCollapsed } = useDetailPanelCollapse();

// ---------- 加自选 / 删自选弹窗（顶栏按钮触发） ----------
/** 弹窗类型：null 关闭 / add 加自选 / remove 删自选 */
type WatchDialogType = null | 'add' | 'remove';
const watchDialog = ref<WatchDialogType>(null);
/** 加自选：勾选的目标分组 id（可多选） */
const addGroupIds = ref<string[]>([]);
/** 删自选：勾选的待删分组 id（空数组 = 全部删除） */
const removeGroupIds = ref<string[]>([]);
/** 新建分组名（加自选弹窗内直接建组） */
const newGroupName = ref('');

/** 该股票当前所在的分组列表（删自选弹窗选项） */
const containingGroups = computed(() =>
  watchlistStore.groups.filter((group) =>
    group.stocks.some((stock) => stock.symbol === symbol.value),
  ),
);

/** 打开加自选弹窗：默认勾选默认分组 */
const openAddDialog = (): void => {
  addGroupIds.value = [DEFAULT_GROUP_ID];
  newGroupName.value = '';
  watchDialog.value = 'add';
};

/** 打开删自选弹窗：默认勾选该股所在的全部分组 */
const openRemoveDialog = (): void => {
  removeGroupIds.value = containingGroups.value.map((group) => group.id);
  watchDialog.value = 'remove';
};

/** 弹窗内新建分组（立即入列表并勾选） */
const createGroupInDialog = (): void => {
  const name = newGroupName.value.trim();
  if (!name) return;
  const group = watchlistStore.addGroup(name);
  if (watchDialog.value === 'add') {
    addGroupIds.value = [...addGroupIds.value, group.id];
  }
  newGroupName.value = '';
};

/** 确认加自选：把当前股票加入所有勾选分组 */
const confirmAdd = (): void => {
  if (!quoteRef.value) return;
  watchlistStore.addStockToGroups(
    {
      symbol: symbol.value,
      name: quoteRef.value.name,
      addedAt: Date.now(),
    },
    addGroupIds.value,
  );
  watchDialog.value = null;
};

/**
 * 确认删自选：勾选了分组则只删这些分组；一个都没勾 = 从全部分组删除
 */
const confirmRemove = (): void => {
  if (removeGroupIds.value.length === 0) {
    watchlistStore.removeStockFromAllGroups(symbol.value);
  } else {
    for (const groupId of removeGroupIds.value) {
      watchlistStore.removeStock(groupId, symbol.value);
    }
  }
  watchDialog.value = null;
};

/**
 * 列表涨跌幅趋势色
 * @param value 涨跌幅（可能为 null）
 * @returns 趋势色类名
 */
const pctClass = (value: number | null): string =>
  TREND_TEXT_CLASS[getTrendByChangePercent(value ?? 0)];
</script>

<template>
  <!--
    页面整体高 = 主区（K 线行）单行，定高 calc(100dvh - 6.5rem)：6.5rem 为
    MainLayout 顶栏 + p-6。2026-10-24 起底部「交易记录 / 成分股」行撤销——
    两个页签迁入顶栏「更多信息」抽屉（StockF10Drawer），页面不再滚动，
    K 线行吃满剩余视口高度。

    页面全屏（isPageFullscreen，K 线卡头部按钮切换）：MainLayout 已隐藏页头与
    p-6 并把内容容器改成 h-full flex 列，本页根节点改吃满高度、K 线行改 flex-1
    拉伸（王总 2026-10-17）
  -->
  <div class="flex min-h-0 flex-col gap-3" :class="isPageFullscreen ? 'h-full' : ''">
    <!-- 页级动作上移 MainLayout 页头：「AI 分析」按钮（Teleport 投射，本页激活时才挂载；
         弹窗仍留在页内。位置在「插件设置」齿轮之前，王总 2026-10-16 指定。
         2026-10-24 起顶栏动作区仅剩「更多信息 + AI 分析」，自选/指标设置已移入页内顶栏卡） -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <div class="flex items-center gap-2">
        <!-- 更多信息（个股资料抽屉：交易记录 / 成分股 / 财务 / 资讯 / 基本资料 /
             发行相关 / 高管简介 / 参股控股，王总 2026-10-24 指定；场内基金以基金概况替代财务） -->
        <BaseButton v-if="quoteRef" variant="ghost" @click="openF10">
          <MenuIcon name="book" :size="14" />
          更多信息
        </BaseButton>
        <!-- AI 分析（交 Agent 做个股短期综合分析；样式保持原 ghost 按钮） -->
        <BaseButton v-if="quoteRef && agentEntryVisible" variant="ghost" @click="onAiAnalysis">
          <MenuIcon name="agent" :size="14" />
          AI 分析
        </BaseButton>
      </div>
    </Teleport>

    <!-- 顶栏：返回 + 标的报价摘要 + 周期按钮组（参考 pro period-bar 横条） -->
    <BaseCard class="shrink-0">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="pressable rounded-lg p-1.5 text-text-secondary hover:bg-flat-weak hover:text-text active:scale-90"
            aria-label="返回"
            @click="goBack"
          >
            <MenuIcon name="arrowLeft" :size="18" />
          </button>
          <div class="flex items-baseline gap-2">
            <span class="text-base font-semibold text-text">{{ quoteRef?.name ?? symbol }}</span>
            <span class="text-xs text-text-tertiary">{{ symbol }}</span>
          </div>
          <div v-if="quoteRef" class="flex items-baseline gap-2 tabular-nums">
            <span class="text-base font-semibold" :class="quoteTrendClass">
              {{ quoteRef.price.toFixed(2) }}
            </span>
            <span class="text-xs" :class="quoteTrendClass">
              {{ quoteRef.change >= 0 ? '+' : '' }}{{ quoteRef.change.toFixed(2) }}
              {{ quoteRef.changePercent >= 0 ? '+' : '' }}{{ quoteRef.changePercent.toFixed(2) }}%
            </span>
          </div>
        </div>
        <!-- 图表工具：画线工具条（周期按钮组已移入 K 线卡头部）；
             指标设置按钮置于画线工具条之后（2026-10-24 王总指定移回此处，页头不再保留） -->
        <div class="flex items-center gap-2">
          <!-- 画线工具条（K 线卡头部；分时/五日置灰，见 use-kline-drawing） -->
          <div
            class="flex items-center gap-1 rounded-xl bg-flat-weak/60 p-1"
            :class="drawingEnabled ? '' : 'opacity-40'"
          >
            <button
              v-for="shape in KLINE_DRAWING_SHAPES"
              :key="shape.name"
              type="button"
              class="rounded-lg px-2 py-1 text-xs transition-colors"
              :class="drawing.activeShape.value === shape.name ? 'bg-primary-weak font-semibold text-primary' : 'text-text-secondary hover:text-text'"
              :disabled="!drawingEnabled"
              :title="shape.label"
              :aria-pressed="drawing.activeShape.value === shape.name"
              @click="drawing.startDrawing(shape.name)"
            >
              {{ shape.label }}
            </button>
            <button
              type="button"
              class="rounded-lg px-2 py-1 text-xs text-text-secondary transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!drawingEnabled || !drawing.hasSelection.value"
              title="删除选中画线"
              @click="drawing.removeSelected()"
            >
              删除
            </button>
            <button
              type="button"
              class="rounded-lg px-2 py-1 text-xs text-text-secondary transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!drawingEnabled || drawing.shapeCount.value === 0"
              title="清空当前票当前周期的全部画线"
              @click="drawing.clearAll()"
            >
              清空
            </button>
            <button
              type="button"
              class="rounded-lg px-2 py-1 text-xs transition-colors"
              :class="drawing.drawingVisible.value ? 'text-text-secondary hover:text-text' : 'text-primary'"
              :disabled="!drawingEnabled"
              :title="drawing.drawingVisible.value ? '隐藏全部画线' : '显示全部画线'"
              @click="drawing.toggleVisible()"
            >
              {{ drawing.drawingVisible.value ? '隐藏' : '显示' }}
            </button>
          </div>
          <!-- 指标设置（画线工具条之后；分时/五日指标固定时置灰，2026-10-24 王总指定位置） -->
          <ChartIndicatorConfigButton :disabled="chartMode === 'timeline'" />
          <!-- 编辑自选（原页头「自选」移入，2026-10-24 王总指定改名「编辑自选」；
               未加自选 = primary 绿、已加 = ghost，点击分别弹加/删自选弹窗） -->
          <BaseButton
            v-if="quoteRef"
            :variant="isInWatchlist ? 'ghost' : 'primary'"
            @click="isInWatchlist ? openRemoveDialog() : openAddDialog()"
          >
            <svg
              v-if="!isInWatchlist"
              viewBox="0 0 24 24"
              class="h-3 w-3"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            编辑自选
          </BaseButton>
        </div>
      </div>
    </BaseCard>

    <!-- 主区：左（来源列表）/ 中（K 线占满整列）/ 右（报价头 + 五档盘口）。
         常规模式定高滚动、全屏模式 flex-1 吃满剩余高度（见根节点注释） -->
    <div
      class="flex min-h-0 gap-3"
      :class="isPageFullscreen ? 'flex-1' : 'h-[calc(100dvh-6.5rem)] shrink-0'"
    >
      <!-- 左侧来源股票列表：跳转入口写入上下文后展示；为空（如直链进入）不渲染。
           支持展开/收起：收起时仅显示股票名称窄条 -->
      <BaseCard
        v-if="stockContext.stocks.length > 0"
        class="flex shrink-0 flex-col overflow-hidden transition-all duration-200"
        :class="isListCollapsed ? 'w-24' : 'w-56'"
      >
        <!-- 展开/收起按钮：panelLeft 面板形状（左右侧栏开关统一样式）；靠左对齐（右栏开关靠右） -->
        <button
          type="button"
          class="pressable mb-1 flex shrink-0 items-center justify-start rounded-lg p-1 pl-2.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
          :aria-label="isListCollapsed ? '展开股票列表' : '收起股票列表'"
          :title="isListCollapsed ? '展开股票列表' : '收起股票列表'"
          @click="isListCollapsed = !isListCollapsed"
        >
          <MenuIcon name="panelLeft" :size="14" />
        </button>

        <!-- 收起态：仅股票名称（单行窄条） -->
        <ul v-if="isListCollapsed" class="min-h-0 flex-1 space-y-1 overflow-y-auto">
          <li v-for="item in stockContext.stocks" :key="item.symbol">
            <button
              type="button"
              class="w-full truncate rounded-lg px-1 py-1.5 text-center text-xs transition-colors"
              :class="
                item.symbol === symbol
                  ? 'bg-primary-weak font-medium text-primary'
                  : 'text-text-secondary hover:bg-flat-weak hover:text-text'
              "
              :title="`${item.name || item.symbol}${item.price === null ? '' : ` ${formatPrice(item.price)}`}`"
              @click="switchStock(item.symbol)"
            >
              {{ item.name || item.symbol }}
            </button>
          </li>
        </ul>

        <!-- 展开态：名称/代码 + 现价/涨跌幅 -->
        <ul v-else class="min-h-0 flex-1 space-y-1 overflow-y-auto">
          <li v-for="item in stockContext.stocks" :key="item.symbol">
            <button
              type="button"
              class="w-full rounded-lg px-2 py-1.5 text-left transition-colors"
              :class="item.symbol === symbol ? 'bg-primary-weak' : 'hover:bg-flat-weak'"
              @click="switchStock(item.symbol)"
            >
              <span class="flex items-center justify-between gap-2">
                <span class="truncate text-xs font-medium text-text">
                  {{ item.name || item.symbol }}
                </span>
                <span class="shrink-0 text-[10px] text-text-tertiary">{{ item.symbol }}</span>
              </span>
              <span class="mt-0.5 flex items-center justify-between gap-2 text-xs tabular-nums">
                <span class="text-text-secondary">
                  {{ item.price === null ? '--' : formatPrice(item.price) }}
                </span>
                <span :class="pctClass(item.changePercent)">
                  {{ item.changePercent === null ? '--' : formatPercent(item.changePercent) }}
                </span>
              </span>
            </button>
          </li>
        </ul>
      </BaseCard>

      <!-- K 线主图：撑满整列高度（min-w-0 允许随窗口收缩，canvas 不撑破行）。
           头部 #extra 为周期按钮组（2026-10-24 王总指定从顶栏移入，与侧栏面板同款）。
           全屏入口已上移至应用顶栏（全局，任意页面可用），此处不再放页内按钮 -->
      <BaseCard title="K 线图" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <template #extra>
          <div class="flex items-center gap-1 rounded-xl bg-flat-weak/60 p-1">
            <button
              v-for="option in CHART_PERIOD_OPTIONS"
              :key="option.value"
              type="button"
              class="rounded-lg px-3 py-1 text-xs transition-colors"
              :class="
                chartPeriod === option.value
                  ? 'bg-primary-weak font-semibold text-primary'
                  : 'text-text-secondary hover:text-text'
              "
              :aria-pressed="chartPeriod === option.value"
              @click="chartPeriod = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </template>
        <div class="min-h-0 min-w-0 flex-1">
          <div v-if="klineError" class="py-10">
            <BaseEmpty text="K 线数据加载失败，请稍后重试（上游可能限频，稍后自动恢复）" />
          </div>
          <KlineChart
            v-else-if="!isKlineLoading && klines.length > 0"
            ref="klineChartRef"
            :key="`${symbol}-${chartMode}`"
            :bars="klines"
            :mode="chartMode"
            :pre-close="quoteRef?.prevClose ?? null"
            :main-indicators="settingsStore.chartMainIndicators"
            :sub-indicators="settingsStore.chartSubIndicators"
            :symbol="symbol"
            :intraday-axis="chartPeriod === 'minute'"
            :trade-marks="chartTradeMarks"
            auto-height
          />
          <BaseSkeleton v-else />
        </div>
      </BaseCard>

      <!-- 右侧信息栏：报价头 + 五档盘口（不随图表周期切换），两卡白底实色（王总 2026-10-22
           指定，替代 2026-10-16 的高光玻璃——玻璃半透明底在红色主题下泛粉）。
           支持展开/收起（与左侧列表同款交互，会话级）：收起时列宽减半（w-[5.5rem]，
           2026-10-24 王总指定），报价头切 compact（全部指标单列一行一条）、
           五档盘口切 vertical（只显示价格/手数，悬停显档位，见 StockOrderBook） -->
      <div
        class="flex shrink-0 flex-col gap-3 overflow-y-auto transition-all duration-200"
        :class="isInfoCollapsed ? 'w-[5.5rem]' : 'w-80'"
      >
        <BaseCard class="shrink-0">
          <!-- 展开/收起按钮（extra 槽，卡片头部右侧）：panelRight 面板形状（panelLeft 镜像，
               竖线靠右对应右栏位置） -->
          <template #extra>
            <button
              type="button"
              class="pressable flex shrink-0 items-center justify-center rounded-lg p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
              :aria-label="isInfoCollapsed ? '展开信息栏' : '收起信息栏'"
              :title="isInfoCollapsed ? '展开信息栏' : '收起信息栏'"
              @click="isInfoCollapsed = !isInfoCollapsed"
            >
              <MenuIcon name="panelRight" :size="14" />
            </button>
          </template>
          <StockQuoteHeader
            :quote="quoteRef"
            metrics-only
            :compact="isInfoCollapsed"
          />
        </BaseCard>
        <BaseCard title="五档盘口" class="shrink-0">
          <StockOrderBook :quote="quoteRef" :vertical="isInfoCollapsed" />
        </BaseCard>
      </div>
    </div>

    <!-- 加自选弹窗：分组多选 + 新建分组 -->
    <BaseConfirmModal
      :open="watchDialog === 'add'"
      title="加入自选"
      ok-text="确认添加"
      cancel-text="取消"
      @ok="confirmAdd"
      @cancel="watchDialog = null"
    >
      <div class="space-y-2">
        <label
          v-for="group in watchlistStore.groups"
          :key="group.id"
          class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-flat-weak"
        >
          <input
            v-model="addGroupIds"
            type="checkbox"
            :value="group.id"
            class="accent-primary"
          />
          <span class="text-sm text-text">{{ group.name }}</span>
          <span class="text-xs text-text-tertiary">{{ group.stocks.length }} 只</span>
        </label>
        <div class="flex items-center gap-2 border-t border-flat-weak pt-2">
          <input
            v-model="newGroupName"
            placeholder="新建分组名称"
            class="flex-1 rounded-lg border border-flat-weak bg-surface px-2 py-1 text-sm text-text outline-none focus:border-primary"
            @keydown.enter="createGroupInDialog"
          />
          <BaseButton variant="ghost" @click="createGroupInDialog">新建</BaseButton>
        </div>
      </div>
    </BaseConfirmModal>

    <!-- 删自选弹窗：选择删除范围（不勾 = 全部删除） -->
    <BaseConfirmModal
      :open="watchDialog === 'remove'"
      title="从自选移除"
      ok-text="确认删除"
      cancel-text="取消"
      ok-variant="danger"
      @ok="confirmRemove"
      @cancel="watchDialog = null"
    >
      <p class="mb-2 text-xs text-text-tertiary">
        勾选要移除的分组；全部不勾则从所有分组移除
      </p>
      <div class="space-y-2">
        <label
          v-for="group in containingGroups"
          :key="group.id"
          class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-flat-weak"
        >
          <input
            v-model="removeGroupIds"
            type="checkbox"
            :value="group.id"
            class="accent-primary"
          />
          <span class="text-sm text-text">{{ group.name }}</span>
        </label>
      </div>
    </BaseConfirmModal>
  </div>
</template>
