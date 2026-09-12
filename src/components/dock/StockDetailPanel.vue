<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseSwitch from '../ui/BaseSwitch.vue';
import BaseTag from '../ui/BaseTag.vue';
import ChipDistributionChart from '../charts/ChipDistributionChart.vue';
import KlineChart from '../charts/KlineChart.vue';
import MinuteTrendChart from '../charts/MinuteTrendChart.vue';
import StockQuoteHeader from '../business/StockQuoteHeader.vue';
import StockOrderBook from '../business/StockOrderBook.vue';
import { fetchFullQuotes } from '../../api/quotes.api';
import {
  fetchChipDistribution,
  fetchKlineSignals,
  fetchKlineWithIndicators,
  fetchTodayTimeline,
} from '../../api/kline.api';
import { usePolling } from '../../composables/use-polling';
import {
  KLINE_ADJUST,
  KLINE_ADJUST_OPTIONS,
  KLINE_PERIOD,
} from '../../constants/kline.constants';
import { POLLING_INTERVAL } from '../../constants/polling.constants';
import type {
  ChipDistributionItem,
  HistoryKline,
  KlineSignal,
  KlineWithIndicators,
  KlineAdjust,
  KlinePeriod,
  TodayTimelineResponse,
} from '../../types/kline.types';
import type { FullQuote } from '../../types/stock-quote.types';
import { formatPercentUnsigned } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import { normalizeSymbol, toTencentSymbol } from 'stock-sdk';
import { useDataCacheStore } from '../../stores/data-cache';
import { useDockPanelStore } from '../../stores/dock-panel';
import { DATA_CACHE_KEY } from '../../constants/data-cache.constants';

/**
 * 个股详情面板（右侧停靠面板内容，布局参考同花顺移动端）：
 * 报价头 + 分时/日K/周K tab 切换 + 可开关的联动侧栏（分时 -> 五档盘口；日K/周K -> 筹码分布）
 *
 * K 线 / 筹码为重接口，仅在打开面板或切换周期 / 复权时拉取一次，不参与轮询；
 * 全部数据有内存快照：同标的重复打开先展示快照，接口返回后刷新
 */
const props = defineProps<{
  /** 个股符号（sh600519 / 600519 等形态均可，内部归一化） */
  symbol: string;
}>();

const dataCache = useDataCacheStore();
const dockPanel = useDockPanelStore();

/** 侧栏（五档 / 筹码）是否显示（用户偏好，dock store 持久化） */
const sidePanelVisible = computed(() => dockPanel.showSidePanel);

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

// ---------- 分时（15s 轮询，腾讯 JSONP 直连；快照播种） ----------
const timeline = ref<TodayTimelineResponse | null>(
  dataCache.get<TodayTimelineResponse>(DATA_CACHE_KEY.DETAIL_TIMELINE_PREFIX + symbol.value),
);

const fetchTimeline = async (): Promise<void> => {
  timeline.value = await fetchTodayTimeline(symbol.value);
  if (timeline.value) {
    dataCache.set(DATA_CACHE_KEY.DETAIL_TIMELINE_PREFIX + symbol.value, timeline.value);
  }
};

usePolling({
  task: fetchTimeline,
  intervalMs: POLLING_INTERVAL.DETAIL_MINUTE,
  tradingAware: true,
});

// ---------- 图表 tab（分时 / 日K / 周K）+ 复权 ----------
const CHART_TAB = {
  MINUTE: 'minute',
  DAILY: 'daily',
  WEEKLY: 'weekly',
} as const;

/** 图表 tab 值 */
type ChartTab = (typeof CHART_TAB)[keyof typeof CHART_TAB];

/** 图表 tab 选项 */
const CHART_TABS: readonly { label: string; value: ChartTab }[] = [
  { label: '分时', value: CHART_TAB.MINUTE },
  { label: '日K', value: CHART_TAB.DAILY },
  { label: '周K', value: CHART_TAB.WEEKLY },
];

/** 当前图表 tab（默认分时） */
const chartTab = ref<ChartTab>(CHART_TAB.MINUTE);

/** 是否为分时 tab */
const isMinuteTab = computed(() => chartTab.value === CHART_TAB.MINUTE);

/** 复权方式 */
const klineAdjust = ref<KlineAdjust>(KLINE_ADJUST.QFQ);

/** K 线周期由 tab 派生（分时态默认日 K，供缓存键与拉取使用） */
const klinePeriod = computed<KlinePeriod>(() =>
  chartTab.value === CHART_TAB.WEEKLY ? KLINE_PERIOD.WEEKLY : KLINE_PERIOD.DAILY,
);
/** K 线快照键（符号 + 周期 + 复权口径） */
const klineCacheKey = computed(
  () => `${DATA_CACHE_KEY.DETAIL_KLINE_PREFIX}${symbol.value}.${klinePeriod.value}.${klineAdjust.value}`,
);

const cachedKline = dataCache.get<KlineWithIndicators<HistoryKline>[]>(klineCacheKey.value);
const cachedSignals = dataCache.get<KlineSignal[]>(
  klineCacheKey.value + '.signals',
);

const klines = ref<KlineWithIndicators<HistoryKline>[]>(cachedKline ?? []);
const signals = ref<KlineSignal[]>(cachedSignals ?? []);
const isKlineLoading = ref(cachedKline === null);
const klineError = ref(false);

const loadKline = async (): Promise<void> => {
  isKlineLoading.value = true;
  klineError.value = false;
  try {
    // 快照播种：同符号同口径先前拉取过则秒出
    const cachedBars = dataCache.get<KlineWithIndicators<HistoryKline>[]>(klineCacheKey.value);
    if (cachedBars) {
      klines.value = cachedBars;
      signals.value =
        dataCache.get<KlineSignal[]>(klineCacheKey.value + '.signals') ?? [];
      isKlineLoading.value = false;
    }
    const [bars, signalList] = await Promise.all([
      fetchKlineWithIndicators(symbol.value, klinePeriod.value, klineAdjust.value),
      fetchKlineSignals(symbol.value, klinePeriod.value, klineAdjust.value),
    ]);
    klines.value = bars;
    signals.value = signalList;
    dataCache.set(klineCacheKey.value, bars);
    dataCache.set(klineCacheKey.value + '.signals', signalList);
  } catch (error) {
    // 失败保留上一次成功数据（首次失败则展示空态）
    klineError.value = klines.value.length === 0;
    console.error('[stock-detail] kline', error);
  } finally {
    isKlineLoading.value = false;
  }
};

// ---------- 筹码分布（随 K 线口径切换拉取一次；快照播种） ----------
const chipsCacheKey = computed(
  () => `${DATA_CACHE_KEY.DETAIL_CHIPS_PREFIX}${symbol.value}.${klineAdjust.value}`,
);
const chipItem = ref<ChipDistributionItem | null>(
  dataCache.get<ChipDistributionItem>(chipsCacheKey.value + '.last'),
);

const loadChips = async (): Promise<void> => {
  try {
    const cachedChips = dataCache.get<ChipDistributionItem>(chipsCacheKey.value + '.last');
    if (cachedChips) {
      chipItem.value = cachedChips;
    }
    const items = await fetchChipDistribution(symbol.value, klineAdjust.value);
    chipItem.value = items.at(-1) ?? null;
    if (chipItem.value) {
      dataCache.set(chipsCacheKey.value + '.last', chipItem.value);
    }
  } catch (error) {
    chipItem.value = dataCache.get<ChipDistributionItem>(chipsCacheKey.value + '.last');
    console.error('[stock-detail] chips', error);
  }
};

// 符号变化全量重拉；周期 / 复权变化只刷 K 线与筹码（组件内状态切换，面板不重载）
watch(
  symbol,
  () => {
    void loadKline();
    void loadChips();
    void fetchQuote();
    void fetchTimeline();
  },
  { immediate: true },
);
watch([klinePeriod, klineAdjust], () => {
  void loadKline();
  void loadChips();
});

/** 获利比例展示文案（0..1 -> %） */
const profitRatioLabel = computed(() =>
  chipItem.value?.profitRatio === null || chipItem.value?.profitRatio === undefined
    ? '--'
    : `${(chipItem.value.profitRatio * 100).toFixed(2)}%`,
);

</script>

<template>
  <div class="space-y-3">
    <!-- 报价头 -->
    <BaseCard>
      <StockQuoteHeader :quote="quote" />
    </BaseCard>

    <!-- 图表 tab：分时 / 日K / 周K（K 线态附复权下拉） -->
    <div class="flex items-center justify-between border-b border-flat-weak pr-1">
      <nav class="flex items-center gap-5" role="tablist" aria-label="行情图表">
        <button
          v-for="tab in CHART_TABS"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="chartTab === tab.value"
          class="pressable -mb-px border-b-2 py-2 text-sm font-medium active:scale-95"
          :class="
            chartTab === tab.value
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text'
          "
          @click="chartTab = tab.value"
        >
          {{ tab.label }}
        </button>
      </nav>
      <div class="flex items-center gap-3">
        <!-- 侧栏显示开关（五档 / 筹码，默认不显示） -->
        <label class="flex items-center gap-1.5 text-xs text-text-secondary">
          侧栏
          <BaseSwitch
            :model-value="dockPanel.showSidePanel"
            @update:model-value="dockPanel.toggleSidePanel()"
          />
        </label>
        <!-- 复权方式下拉（仅 K 线态展示） -->
        <select
          v-if="!isMinuteTab"
          v-model="klineAdjust"
          class="rounded-lg border border-flat-weak bg-surface px-2 py-1 text-xs text-text"
          aria-label="复权方式"
        >
          <option v-for="option in KLINE_ADJUST_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
    </div>

    <!-- 主图 + 可选联动侧栏：分时 -> 五档盘口；日K / 周K -> 筹码分布 -->
    <div
      class="grid gap-3"
      :class="sidePanelVisible ? 'xl:grid-cols-[7fr_3fr]' : ''"
    >
      <!-- 主图 -->
      <div>
        <template v-if="isMinuteTab">
          <MinuteTrendChart v-if="timeline && timeline.data.length > 0" :timeline="timeline" />
          <BaseSkeleton v-else />
        </template>
        <template v-else>
          <div v-if="klineError" class="py-10">
            <BaseEmpty text="K 线数据加载失败，请稍后重试（上游可能限频，稍后自动恢复）" />
          </div>
          <KlineChart v-else-if="!isKlineLoading && klines.length > 0" :klines="klines" :signals="signals" />
          <BaseSkeleton v-else />
        </template>
      </div>

      <!-- 联动侧栏（开关控制，默认不显示） -->
      <aside v-if="sidePanelVisible" class="space-y-3">
        <!-- 分时 -> 五档盘口 -->
        <BaseCard v-if="isMinuteTab" title="五档盘口">
          <StockOrderBook :quote="quote" />
        </BaseCard>

        <!-- K 线 -> 筹码分布 -->
        <template v-else>
          <BaseCard>
            <template #title>
              <div class="flex items-center justify-between gap-2">
                <span>筹码分布</span>
                <BaseTag tone="primary">获利 {{ profitRatioLabel }}</BaseTag>
              </div>
            </template>
            <ChipDistributionChart
              v-if="chipItem"
              :item="chipItem"
              :current-price="quote?.price ?? null"
            />
            <BaseSkeleton v-else />
            <dl v-if="chipItem" class="mt-3 space-y-1.5 text-xs text-text-secondary">
              <div class="flex justify-between">
                <dt>平均成本</dt>
                <dd class="tabular-nums">{{ formatPrice(chipItem.avgCost) }}</dd>
              </div>
              <div class="flex justify-between">
                <dt>90%集中度</dt>
                <dd class="tabular-nums">
                  {{ formatPercentUnsigned(chipItem.concentration90 === null ? null : (chipItem.concentration90 ?? 0) * 100) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt>90%成本区间</dt>
                <dd class="tabular-nums">
                  {{ formatPrice(chipItem.cost90Low) }} ~ {{ formatPrice(chipItem.cost90High) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt>70%成本区间</dt>
                <dd class="tabular-nums">
                  {{ formatPrice(chipItem.cost70Low) }} ~ {{ formatPrice(chipItem.cost70High) }}
                </dd>
              </div>
            </dl>
          </BaseCard>
        </template>
      </aside>
    </div>
  </div>
</template>
