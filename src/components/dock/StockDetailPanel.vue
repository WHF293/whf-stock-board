<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseCard from '../ui/BaseCard.vue';
import BaseConfirmModal from '../ui/BaseConfirmModal.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import KlineChart from '../charts/KlineChart.vue';
import StockQuoteHeader from '../business/StockQuoteHeader.vue';
import StockOrderBook from '../business/StockOrderBook.vue';
import DockResizer from '../business/DockResizer.vue';
import { fetchFullQuotes } from '../../api/quotes.api';
import { fetchKlineCached } from '../../api/kline-cache.api';
import { CHART_PERIOD_OPTIONS } from '../../constants/stock-detail.constants';
import { usePolling } from '../../composables/use-polling';
import { useChartPeriod } from '../../composables/use-chart-period';
import { POLLING_INTERVAL } from '../../constants/polling.constants';
import type { KLineData } from 'klinecharts';
import type { FullQuote } from '../../types/stock-quote.types';
import { toFullSymbol } from '../../utils/to-full-symbol';
import { useDataCacheStore } from '../../stores/data-cache';
import { useWatchlistStore } from '../../stores/watchlist';
import { DEFAULT_GROUP_ID } from '../../constants/watchlist.constants';
import { useDockPanelStore } from '../../stores/dock-panel';
import { DATA_CACHE_KEY } from '../../constants/data-cache.constants';

/**
 * 个股详情面板（右侧停靠面板内容，布局参考同花顺移动端）：
 * 报价头 + 分时/五日/5分/日K/周K/月K 按钮组切换 + 侧栏（分时/五日 -> 五档盘口）
 *
 * K 线走新浪源（不复权），为重接口，仅在打开面板或切换周期时拉取一次，不参与轮询；
 * 全部数据有内存快照：同标的重复打开先展示快照，接口返回后刷新
 */
const props = defineProps<{
  /** 个股符号（sh600519 / 600519 等形态均可，内部归一化） */
  symbol: string;
}>();

const dataCache = useDataCacheStore();
const dockPanel = useDockPanelStore();

/** 侧栏最小可视宽度阈值（像素），低于此宽度隐藏五档盘口避免挤占主图 */
const SIDEBAR_MIN_WIDTH_PX = 500;

/**
 * 五档盘口展示条件：仅分时/五日下展示，且面板宽 ≥ 阈值（与原 showSidebar 同步）
 * - 蜡烛周期不展示（产品语义是分时关注短期盘口变化）
 */
const showOrderBook = computed(() => dockPanel.width >= SIDEBAR_MIN_WIDTH_PX);

/**
 * 归一化符号：600519 / SH600519 / sh600519 等形态统一为 sh600519
 */
const symbol = computed<string>(() => toFullSymbol(String(props.symbol ?? '')));

// ---------- 加自选 / 删自选弹窗 ----------
/** 弹窗类型：null 关闭 / add 加自选 / remove 删自选 */
type WatchDialogType = null | 'add' | 'remove';
const watchDialog = ref<WatchDialogType>(null);
/** 加自选：勾选的目标分组 id（可多选，一支股票可入多组） */
const addGroupIds = ref<string[]>([]);
/** 删自选：勾选的待删分组 id（空数组 = 全部删除） */
const removeGroupIds = ref<string[]>([]);
/** 新建分组名（加自选弹窗内直接建组） */
const newGroupName = ref('');

const watchlistStore = useWatchlistStore();

/** 当前股票是否已加入自选（任一分组） */
const isInWatchlist = computed(() =>
  watchlistStore.allSymbols.includes(symbol.value),
);

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

// ---------- 报价头（4s 轮询；快照播种） ----------
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

// ---------- 十字光标联动（K 线悬停 bar -> 行情头临时展示该根 OHLCV） ----------
/** 十字光标悬停的 K 线（null = 未悬停，展示最新报价） */
const hoveredBar = ref<KLineData | null>(null);
const onCrosshairBar = (bar: KLineData | null): void => {
  hoveredBar.value = bar;
};

/**
 * 行情头展示数据：悬停时把该根 K 线的开高低收/量/额覆盖到最新报价上
 * （价格与涨跌幅按该根 close 相对昨收重算；其余字段保留实时报价）
 */
const displayQuote = computed<FullQuote | null>(() => {
  const quote = quoteRef.value;
  const bar = hoveredBar.value;
  if (!quote || !bar) return quote;
  const prevClose = quote.prevClose;
  const price = bar.close;
  const change = prevClose ? price - prevClose : 0;
  return {
    ...quote,
    price,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    volume: bar.volume ?? quote.volume,
    amount: (bar.turnover as number | undefined) ?? quote.amount,
    change,
    changePercent: prevClose ? (change / prevClose) * 100 : 0,
  };
});


// ---------- 图表周期（按钮组切换：分时 / 五日 / 5分 / 日K / 周K / 月K，均走新浪源） ----------
// 周期选项与详情页共用（constants/stock-detail.constants.ts），避免两处漂移；
// 选择本身也持久化（composables/use-chart-period.ts），下次打开默认回到上次的周期
const chartPeriod = useChartPeriod();

/** 图表模式：分时 / 五日为分时线，其余为蜡烛图 */
const chartMode = computed<'timeline' | 'candle'>(() =>
  chartPeriod.value === 'minute' || chartPeriod.value === 'fiveDay' ? 'timeline' : 'candle',
);

/** K 线快照键（符号 + 周期，不复权无口径差异） */
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
    console.error('[stock-detail] kline', error);
  } finally {
    isKlineLoading.value = false;
  }
};

// 符号变化全量重拉；周期变化只刷 K 线（组件内状态切换，面板不重载）
watch(
  symbol,
  () => {
    void loadKline();
    void fetchQuote();
  },
  { immediate: true },
);
watch(chartPeriod, () => {
  void loadKline();
});

/**
 * dock-panel 拖拽：把当前鼠标 X 换算为「面板右缘到视口右缘」的宽度
 * 写入 store（store 内 clamp 到 375 ~ 60vw 并持久化）
 * @param clientX
 */
const onDockResize = (clientX: number): void => {
  dockPanel.setWidth(window.innerWidth - clientX);
};

/** 拖拽结束信号（自增 tick，驱动 K 线图强制重绘适配最终宽度） */
const chartResizeTick = ref(0);
const onDockResizeEnd = (): void => {
  chartResizeTick.value += 1;
};
</script>

<template>
  <div class="space-y-3">
    <!-- 报价头 -->
    <BaseCard>
      <StockQuoteHeader
        :quote="displayQuote"
        :is-in-watchlist="isInWatchlist"
        @add-to-watchlist="openAddDialog"
        @remove-from-watchlist="openRemoveDialog"
      />
    </BaseCard>

    <!-- 主图区（relative 供拖拽手柄定位）：K 线卡片 + 五档盘口卡片 -->
    <div class="relative flex flex-col gap-3">
      <!-- 拖拽手柄：挂在 K 线卡片左缘 -->
      <DockResizer
        v-if="dockPanel.open"
        :on-resize="onDockResize"
        @resize-end="onDockResizeEnd"
      />

      <!-- K 线卡片：无标题，头部右侧为周期切换按钮组 -->
      <BaseCard>
        <template #extra>
          <BaseTabs
            v-model="chartPeriod"
            :options="CHART_PERIOD_OPTIONS"
            aria-label="K 线周期"
          />
        </template>
        <div v-if="klineError" class="py-10">
          <BaseEmpty text="K 线数据加载失败，请稍后重试（上游可能限频，稍后自动恢复）" />
        </div>
        <KlineChart
          v-else-if="!isKlineLoading && klines.length > 0"
          :key="`${symbol}-${chartMode}`"
          :bars="klines"
          :mode="chartMode"
          :pre-close="quoteRef?.prevClose ?? null"
          :symbol="symbol"
          :intraday-axis="chartPeriod === 'minute'"
          sub-volume-only
          :resize-tick="chartResizeTick"
          @crosshair-bar="onCrosshairBar"
        />
        <BaseSkeleton v-else />
      </BaseCard>

      <!-- 五档盘口：分时/五日模式下展示在 K 线下方，宽度 100%，左右分栏 -->
      <BaseCard v-if="showOrderBook" title="五档盘口">
        <StockOrderBook :quote="quoteRef" />
      </BaseCard>
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
      :ok-variant="'danger'"
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
