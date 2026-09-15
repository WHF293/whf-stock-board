<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { KLineData } from 'klinecharts';
import { toFullSymbol } from '../utils/to-full-symbol';
import type { FullQuote } from '../types/stock-quote.types';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseConfirmModal from '../components/ui/BaseConfirmModal.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import ChartIndicatorConfigButton from '../components/ui/ChartIndicatorConfigButton.vue';
import { useSettingsStore } from '../stores/settings';
import { useStockContextStore } from '../stores/stock-context';
import { ROUTE_PATH } from '../constants/router-meta.constants';
import { formatPercent } from '../utils/format-percent';
import { formatPrice } from '../utils/format-price';
import KlineChart from '../components/charts/KlineChart.vue';
import StockQuoteHeader from '../components/business/StockQuoteHeader.vue';
import StockOrderBook from '../components/business/StockOrderBook.vue';
import { fetchFullQuotes } from '../api/quotes.api';
import { fetchSinaKline } from '../api/sina-kline.api';
import { listTradeRecordsBySymbol } from '../api/account-records-db.api';
import type { AccountTradeRecord } from '../types/account.types';
import {
  buildDailyTradeMarks,
  buildIntradayTradeMarks,
  type TradeMark,
} from '../utils/trade-marks';
import { usePolling } from '../composables/use-polling';
import { POLLING_INTERVAL } from '../constants/polling.constants';
import { CHART_PERIOD_OPTIONS, type ChartPeriod } from '../constants/stock-detail.constants';
import { useDataCacheStore } from '../stores/data-cache';
import { useWatchlistStore } from '../stores/watchlist';
import { useStockAccountStore } from '../stores/stock-account';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants';
import { DEFAULT_GROUP_ID } from '../constants/watchlist.constants';
import { getTrendByChangePercent } from '../constants/trend.constants';
import { TREND_TEXT_CLASS } from '../constants/stock-colors.constants';

/**
 * 股票详情整页（/stock-detail/:symbol，全站双击个股进入）：
 *
 * 顶栏（返回 + 标的 + 报价摘要 + 周期按钮组）+ 主图 K 线（撑满整列高度）
 * + 右侧信息栏（报价头 + 五档盘口固定展示，≥1280px）。
 * 布局参考 klinechart-pro（无画线、无截屏）。
 *
 * 数据链路与侧栏（StockDetailPanel）同构：报价 4s 轮询、K 线单次拉取，
 * 快照经 data-cache 互通（同 cache key 前缀）
 */
const route = useRoute();
const router = useRouter();
const dataCache = useDataCacheStore();
const watchlistStore = useWatchlistStore();
const settingsStore = useSettingsStore();
const stockContext = useStockContextStore();

/**
 * 归一化符号：600519 / SH600519 / sh600519 等形态统一为 sh600519
 */
const symbol = computed<string>(() => toFullSymbol(String(route.params.symbol ?? '')));

/** 当前股票是否已加入自选（任一分组） */
const isInWatchlist = computed(() => watchlistStore.allSymbols.includes(symbol.value));

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

// ---------- 图表周期（按钮组：分时 / 五日 / 5分 / 日K / 周K / 月K） ----------
/** 当前图表周期（默认分时） */
const chartPeriod = ref<ChartPeriod>('minute');

/** 图表模式：分时 / 五日为分时线，其余为蜡烛图 */
const chartMode = computed<'timeline' | 'candle'>(() =>
  chartPeriod.value === 'minute' || chartPeriod.value === 'fiveDay' ? 'timeline' : 'candle',
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
    const bars = await fetchSinaKline(symbol.value, chartPeriod.value);
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

// ---------- 交易记录（本地交割单 / 对账单库，按股票） ----------
/** 该股成交记录（跨账户；来源为账户管理导入的同花顺文件） */
const tradeRecords = ref<AccountTradeRecord[]>([]);
/** 成交记录加载中 */
const isTradeRecordsLoading = ref(false);

/** 拉取该股全部成交记录（本地 SQLite 直读，非网络请求，失败即空列表） */
const loadTradeRecords = async (): Promise<void> => {
  isTradeRecordsLoading.value = true;
  try {
    tradeRecords.value = await listTradeRecordsBySymbol(symbol.value);
  } catch (error) {
    console.error('[stock-detail-page] trade-records', error);
    tradeRecords.value = [];
  } finally {
    isTradeRecordsLoading.value = false;
  }
};

/**
 * 成交数量展示（买入为正、卖出为负，正数补 + 号）
 * @param quantity 成交数量（股；负数表示卖出）
 * @returns 带符号的数量文案
 */
const formatTradeQuantity = (quantity: number): string =>
  `${quantity > 0 ? '+' : ''}${quantity}`;

// ---------- 交易记录的账户切换（多账户可能买过同一只股票） ----------
const accountStore = useStockAccountStore();

/** 账户筛选值：'' = 全部账户，否则为账户 id */
const tradeAccountFilter = ref('');

/** 该股成交记录里出现过的账户（id → 账户名；已删除的账户兜底显示 id 前 8 位） */
const tradeAccountOptions = computed(() => {
  const ids = [...new Set(tradeRecords.value.map((record) => record.accountId))];
  const nameById = new Map(accountStore.accounts.map((account) => [account.id, account.name]));
  return ids.map((id) => ({ id, name: nameById.get(id) ?? `账户 ${id.slice(0, 8)}` }));
});

/** 账户筛选后的交易记录（'' = 不过滤） */
const visibleTradeRecords = computed(() =>
  tradeAccountFilter.value === ''
    ? tradeRecords.value
    : tradeRecords.value.filter((record) => record.accountId === tradeAccountFilter.value),
);

// 账户被筛掉后当前选中可能失效（如切股后新列表无此账户），回退全部
watch(tradeAccountOptions, (options) => {
  if (
    tradeAccountFilter.value !== '' &&
    !options.some((option) => option.id === tradeAccountFilter.value)
  ) {
    tradeAccountFilter.value = '';
  }
});

/**
 * 成交操作文案（按数量的正负判定：买入 / 卖出）
 * @param record 交易记录
 * @returns 操作文案
 */
const tradeActionLabel = (record: AccountTradeRecord): string =>
  record.quantity >= 0 ? '买入' : '卖出';

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

/** 左侧股票列表是否收起（收起时仅显示名称窄条；会话级） */
const isListCollapsed = ref(false);

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
    页面整体高 = 主区（K 线行）+ 交易记录行，超出视口由 MainLayout 的 main 滚动；
    两行各自定高 calc(100dvh - 11rem)：6.5rem 为 MainLayout 顶栏 + p-6，
    4.5rem 为本页顶栏卡与行间距——交易记录因此与 K 线卡片等高（需求口径）
  -->
  <div class="flex min-h-0 flex-col gap-3">
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
          <!-- 自选按钮（原右栏报价头移此） -->
          <button
            v-if="quoteRef"
            type="button"
            class="pressable inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium hover:opacity-80 active:scale-95"
            :class="isInWatchlist ? 'bg-up-weak text-up' : 'bg-primary-weak text-primary'"
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
            {{ isInWatchlist ? '删自选' : '加自选' }}
          </button>
        </div>
        <!-- 周期按钮组（胶囊高亮当前周期）+ 指标配置按钮 -->
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1 rounded-xl bg-flat-weak/60 p-1">
            <button
              v-for="option in CHART_PERIOD_OPTIONS"
              :key="option.value"
              type="button"
              class="rounded-lg px-3 py-1 text-xs transition-colors"
              :class="
                chartPeriod === option.value
                  ? 'bg-primary font-semibold text-white'
                  : 'text-text-secondary hover:text-text'
              "
              :aria-pressed="chartPeriod === option.value"
              @click="chartPeriod = option.value"
            >
              {{ option.label }}
            </button>
          </div>
          <ChartIndicatorConfigButton :disabled="chartMode === 'timeline'" />
        </div>
      </div>
    </BaseCard>

    <!-- 主区：左（来源列表）/ 中（K 线占满整列）/ 右（报价头 + 五档盘口） -->
    <div class="flex h-[calc(100dvh-11rem)] min-h-0 shrink-0 gap-3">
      <!-- 左侧来源股票列表：跳转入口写入上下文后展示；为空（如直链进入）不渲染。
           支持展开/收起：收起时仅显示股票名称窄条 -->
      <BaseCard
        v-if="stockContext.stocks.length > 0"
        class="flex shrink-0 flex-col overflow-hidden transition-all duration-200"
        :class="isListCollapsed ? 'w-24' : 'w-56'"
      >
        <!-- 展开/收起按钮 -->
        <button
          type="button"
          class="pressable mb-1 flex shrink-0 items-center justify-center rounded-lg p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
          :aria-label="isListCollapsed ? '展开股票列表' : '收起股票列表'"
          :title="isListCollapsed ? '展开股票列表' : '收起股票列表'"
          @click="isListCollapsed = !isListCollapsed"
        >
          <MenuIcon :name="isListCollapsed ? 'chevronRight' : 'chevronLeft'" :size="14" />
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
              :class="item.symbol === symbol ? 'bg-primary-weak ring-1 ring-primary' : 'hover:bg-flat-weak'"
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

      <!-- K 线主图：撑满整列高度（min-w-0 允许随窗口收缩，canvas 不撑破行） -->
      <BaseCard title="K 线图" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="min-h-0 min-w-0 flex-1">
          <div v-if="klineError" class="py-10">
            <BaseEmpty text="K 线数据加载失败，请稍后重试（上游可能限频，稍后自动恢复）" />
          </div>
          <KlineChart
            v-else-if="!isKlineLoading && klines.length > 0"
            :key="`${symbol}-${chartMode}`"
            :bars="klines"
            :mode="chartMode"
            :pre-close="quoteRef?.prevClose ?? null"
            :main-indicators="settingsStore.chartMainIndicators"
            :sub-indicators="settingsStore.chartSubIndicators"
            :symbol="symbol"
            :trade-marks="chartTradeMarks"
            auto-height
          />
          <BaseSkeleton v-else />
        </div>
      </BaseCard>

      <!-- 右侧信息栏：报价头 + 五档盘口（不随图表周期切换） -->
      <div class="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto">
        <BaseCard class="shrink-0">
          <StockQuoteHeader :quote="quoteRef" metrics-only />
        </BaseCard>
        <BaseCard title="五档盘口" class="shrink-0">
          <StockOrderBook :quote="quoteRef" />
        </BaseCard>
      </div>
    </div>

    <!-- 交易记录：本地交割单 / 对账单库中该股的全部成交（时间 / 操作 / 数量 / 价格），
         与上方 K 线卡片等高，行数超出时列表内部滚动；多账户买入同股时按账户筛选 -->
    <BaseCard
      class="flex h-[calc(100dvh-11rem)] min-h-0 shrink-0 flex-col"
      :title="
        visibleTradeRecords.length > 0
          ? `交易记录（${visibleTradeRecords.length} 笔）`
          : '交易记录'
      "
    >
      <template #extra>
        <div class="flex items-center gap-2">
          <!-- 账户切换：仅该股成交记录涉及 ≥2 个账户时显示 -->
          <select
            v-if="tradeAccountOptions.length > 1"
            v-model="tradeAccountFilter"
            class="rounded-lg border border-flat-weak bg-surface px-2 py-1 text-xs text-text"
            aria-label="按账户筛选交易记录"
          >
            <option value="">全部账户</option>
            <option v-for="option in tradeAccountOptions" :key="option.id" :value="option.id">
              {{ option.name }}
            </option>
          </select>
          <span class="text-xs text-text-tertiary">来源：账户管理导入的同花顺交割单 / 对账单</span>
        </div>
      </template>
      <BaseSkeleton v-if="isTradeRecordsLoading" />
      <BaseEmpty
        v-else-if="visibleTradeRecords.length === 0"
        text="暂无该股成交记录：在「账户管理」导入同花顺交割单后即可在此查看"
      />
      <div v-else class="min-h-0 flex-1 overflow-y-auto">
        <div
          class="sticky top-0 z-[1] flex items-center gap-3 border-b border-flat-weak bg-surface px-2 pb-1.5 text-xs text-text-tertiary"
        >
          <span class="flex-1">时间</span>
          <span class="w-10 text-right">操作</span>
          <span class="w-20 text-right">数量</span>
          <span class="w-20 text-right">价格</span>
        </div>
        <div
          v-for="record in visibleTradeRecords"
          :key="record.id"
          class="flex items-center gap-3 border-b border-flat-weak/50 px-2 py-1.5 text-sm tabular-nums last:border-0 hover:bg-flat-weak/40"
        >
          <span class="flex-1 whitespace-nowrap text-text-secondary">
            {{ record.tradeDate }} {{ record.tradeTime }}
          </span>
          <span
            class="w-10 text-right"
            :class="record.quantity >= 0 ? 'text-up' : 'text-down'"
          >
            {{ tradeActionLabel(record) }}
          </span>
          <span
            class="w-20 text-right font-medium"
            :class="record.quantity >= 0 ? 'text-up' : 'text-down'"
          >
            {{ formatTradeQuantity(record.quantity) }}
          </span>
          <span class="w-20 text-right text-text">{{ formatPrice(record.price) }}</span>
        </div>
      </div>
    </BaseCard>

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
