<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import StockDetailSidebar from '../business/StockDetailSidebar.vue';
import KlineChart from '../charts/KlineChart.vue';
import StockQuoteHeader from '../business/StockQuoteHeader.vue';
import DockResizer from '../business/DockResizer.vue';
import { fetchFullQuotes } from '../../api/quotes.api';
import { fetchChipDistribution } from '../../api/kline.api';
import { fetchSinaKline, type SinaKlinePeriod } from '../../api/sina-kline.api';
import { usePolling } from '../../composables/use-polling';
import { POLLING_INTERVAL } from '../../constants/polling.constants';
import type { ChipDistributionItem } from '../../types/kline.types';
import type { KLineData } from 'klinecharts';
import type { FullQuote } from '../../types/stock-quote.types';
import { normalizeSymbol, toTencentSymbol } from 'stock-sdk';
import { useDataCacheStore } from '../../stores/data-cache';
import { useDockPanelStore } from '../../stores/dock-panel';
import { DATA_CACHE_KEY } from '../../constants/data-cache.constants';

/**
 * 个股详情面板（右侧停靠面板内容，布局参考同花顺移动端）：
 * 报价头 + 分时/五日/5分/日K/周K/月K 下拉切换 + 可开关的联动侧栏（分时 -> 五档盘口；K 线 -> 筹码分布）
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

/** 侧栏最小可视宽度阈值（像素），低于此宽度隐藏五档 / 筹码避免挤占主图 */
const SIDEBAR_MIN_WIDTH_PX = 500;

/** 周期对应的固定侧栏：分时/五日 -> 五档盘口；K 线 -> 筹码分布 */
const sidebarMode = computed<'timeline' | 'candle'>(() => chartMode.value);

/** 侧栏是否展示（面板宽 ≥ 阈值才显示） */
const showSidebar = computed(() => dockPanel.width >= SIDEBAR_MIN_WIDTH_PX);

/**
 * 归一化符号：600519 / SH600519 / sh600519 等形态统一为 sh600519
 */
const symbol = computed<string>(() => {
  const raw = String(props.symbol ?? '');
  try {
    return toTencentSymbol(normalizeSymbol(raw));
  } catch {
    // 非法符号兜底原样返回，交给后续请求失败降级
    return raw;
  }
});

// ---------- 报价头（4s 轮询；快照播种） ----------
const quote = ref<FullQuote | null>(
  dataCache.get<FullQuote>(DATA_CACHE_KEY.DETAIL_QUOTE_PREFIX + symbol.value),
);

const fetchQuote = async (): Promise<void> => {
  const quotes = await fetchFullQuotes([symbol.value]);
  quote.value = quotes[0] ?? null;
  if (quote.value) {
    dataCache.set(DATA_CACHE_KEY.DETAIL_QUOTE_PREFIX + symbol.value, quote.value);
  }
};

usePolling({
  task: fetchQuote,
  intervalMs: POLLING_INTERVAL.QUOTES_INTRADAY,
  tradingAware: true,
});

// ---------- 图表周期（下拉切换：分时 / 五日 / 5分 / 日K / 周K / 月K，均走新浪源） ----------
/** 图表周期值 */
type ChartPeriod = SinaKlinePeriod;

/** 图表周期选项 */
const CHART_PERIOD_OPTIONS: readonly { label: string; value: ChartPeriod }[] = [
  { label: '分时', value: 'minute' },
  { label: '五日', value: 'fiveDay' },
  { label: '5分', value: 'min5' },
  { label: '日K', value: 'daily' },
  { label: '周K', value: 'weekly' },
  { label: '月K', value: 'monthly' },
];

/** 当前图表周期（默认分时） */
const chartPeriod = ref<ChartPeriod>('minute');

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
    const bars = await fetchSinaKline(symbol.value, chartPeriod.value);
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

// ---------- 筹码分布（随符号拉取一次；快照播种） ----------
const chipsCacheKey = computed(
  () => `${DATA_CACHE_KEY.DETAIL_CHIPS_PREFIX}${symbol.value}`,
);
const chipItem = ref<ChipDistributionItem | null>(
  dataCache.get<ChipDistributionItem>(chipsCacheKey.value + '.last'),
);
const isChipsLoading = ref(false);

const loadChips = async (): Promise<void> => {
  isChipsLoading.value = true;
  try {
    const cachedChips = dataCache.get<ChipDistributionItem>(chipsCacheKey.value + '.last');
    if (cachedChips) {
      chipItem.value = cachedChips;
    }
    const items = await fetchChipDistribution(symbol.value);
    chipItem.value = items.at(-1) ?? null;
    if (chipItem.value) {
      dataCache.set(chipsCacheKey.value + '.last', chipItem.value);
    }
  } catch (error) {
    chipItem.value = dataCache.get<ChipDistributionItem>(chipsCacheKey.value + '.last');
    console.error('[stock-detail] chips', error);
  } finally {
    isChipsLoading.value = false;
  }
};

// 符号变化全量重拉；周期变化只刷 K 线（组件内状态切换，面板不重载）
watch(
  symbol,
  () => {
    void loadKline();
    void loadChips();
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
 */
const onDockResize = (clientX: number): void => {
  dockPanel.setWidth(window.innerWidth - clientX);
};
</script>

<template>
  <div class="space-y-3">
    <!-- 报价头 -->
    <BaseCard>
      <StockQuoteHeader :quote="quote" />
    </BaseCard>

    <!-- 图表周期下拉：分时 / 五日 -> 侧栏固定五档盘口；其余 -> 侧栏固定筹码分布 -->
    <div class="flex items-center gap-3 border-b border-flat-weak pr-1">
      <select
        v-model="chartPeriod"
        class="rounded-lg border border-flat-weak bg-surface px-2 py-1 text-xs text-text"
        aria-label="K 线周期"
      >
        <option v-for="option in CHART_PERIOD_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>

    <!-- 主图 + 侧栏（侧栏按周期自动切换：分时/五日五档盘口，其余筹码分布） -->
    <div
      class="relative grid gap-3"
      :class="showSidebar ? 'xl:grid-cols-[7fr_3fr]' : ''"
    >
      <!-- 通用 dock 拖拽手柄：长按（≥ 120ms）出现贯穿竖线并进入拖拽态；窄屏隐藏；
           后续新增任何 dock 内容（基金 / 期货详情）直接复用 DockResizer 即可 -->
      <DockResizer v-if="dockPanel.open" :on-resize="onDockResize" />

      <div class="h-[480px] min-h-[480px]">
        <div v-if="klineError" class="py-10">
          <BaseEmpty text="K 线数据加载失败，请稍后重试（上游可能限频，稍后自动恢复）" />
        </div>
        <KlineChart
          v-else-if="!isKlineLoading && klines.length > 0"
          :key="`${symbol}-${chartMode}`"
          :bars="klines"
          :mode="chartMode"
        />
        <BaseSkeleton v-else />
      </div>

      <aside v-if="showSidebar" class="space-y-3">
        <StockDetailSidebar
          :mode="sidebarMode"
          :quote="quote"
          :chip-item="chipItem"
          :is-chips-loading="isChipsLoading"
        />
      </aside>
    </div>
  </div>
</template>
