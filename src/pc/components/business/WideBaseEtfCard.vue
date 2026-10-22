<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import KlineChart from '../../../common/components/charts/KlineChart.vue';
import { fetchSinaKline } from '../../../common/api/sina-kline.api.ts';
import { fetchKlineCached } from '../../../common/api/kline-cache.api.ts';
import {
  WIDE_BASE_ETF_CHART_HEIGHT_PX,
  WIDE_BASE_ETF_DAILY_BAR_LIMIT,
  WIDE_BASE_ETF_VIEW_MODE,
  type WideBaseEtfItem,
} from '../../../common/constants/wide-base-etf.constants.ts';
import {
  getTrendByChangePercent,
} from '../../../common/constants/trend.constants.ts';
import {
  TREND_PILL_CLASS,
  TREND_TEXT_CLASS,
} from '../../../common/constants/stock-colors.constants.ts';
import { formatPercent } from '../../../common/utils/format-percent';
import { formatPrice } from '../../../common/utils/format-price';
import type { KLineData } from 'klinecharts';
import type { FullQuote } from '../../../common/types/stock-quote.types.ts';

/**
 * 宽基ETF卡片（国家队监控页）：名称 + 现价/涨跌幅 + K线图
 *
 * - 分时：新浪 1 分钟线（当日窗口），主图分时线 + 均价线，副图成交量（intradayAxis 全天固定轴）
 * - 日K：本地缓存编排层（只读不落库，收窄根数），主图蜡烛 + MA，副图成交量
 * - 数据在模式切换 / 盘中刷新 tick 变化时按需拉取；失败保留上一次成功数据
 */
const props = defineProps<{
  /** ETF 条目（symbol + 展示名） */
  item: WideBaseEtfItem;
  /** 图表模式（分时 / 日K，全页统一切换） */
  mode: string;
  /** 实时报价（页头轮询共享；未就绪为 null） */
  quote: FullQuote | null;
  /** 盘中刷新 tick（父级每分钟自增，仅分时模式消费） */
  minuteTick: number;
}>();

/** K 线序列（时间升序） */
const bars = ref<KLineData[]>([]);
/** 首次加载中（已有数据时静默刷新，不闪骨架） */
const loading = ref(true);
/** 加载失败且无历史数据（展示空态） */
const error = ref(false);

/**
 * 拉取当前模式的 K 线数据：
 * 分时走新浪分钟线（当日窗口）；日K走缓存编排层（只读 + 收窄根数，不污染本地库水位）
 */
const loadBars = async (): Promise<void> => {
  loading.value = bars.value.length === 0;
  error.value = false;
  try {
    if (props.mode === WIDE_BASE_ETF_VIEW_MODE.MINUTE) {
      bars.value = await fetchSinaKline(props.item.symbol, 'minute');
    } else {
      bars.value = await fetchKlineCached(props.item.symbol, 'daily', {
        write: false,
        barLimit: WIDE_BASE_ETF_DAILY_BAR_LIMIT,
      });
    }
  } catch (err) {
    // 失败保留上一次成功数据；首次失败才展示空态
    error.value = bars.value.length === 0;
    console.error(`[wide-base-etf] kline ${props.item.symbol}`, err);
  } finally {
    loading.value = false;
  }
};

// 模式切换 / 标的变化重拉（切模式时图表指标集不同，KlineChart 以 key 重建）
watch(
  () => [props.item.symbol, props.mode] as const,
  () => {
    void loadBars();
  },
  { immediate: true },
);

// 盘中刷新 tick：仅分时模式跟随刷新（日K盘中单根未定，刷新无意义）
watch(
  () => props.minuteTick,
  () => {
    if (props.mode === WIDE_BASE_ETF_VIEW_MODE.MINUTE) void loadBars();
  },
);

/** 涨跌档位（报价头着色；无报价按平盘处理） */
const trend = computed(() => getTrendByChangePercent(props.quote?.changePercent ?? 0));

/** 报价是否就绪（有价格才展示报价头） */
const hasQuote = computed(() => props.quote?.price !== null && props.quote?.price !== undefined);
</script>

<template>
  <BaseCard :title="item.name">
    <template #extra>
      <div class="flex min-w-0 items-center gap-2">
        <span class="text-xs tabular-nums text-text-tertiary">{{ item.symbol.toUpperCase() }}</span>
        <template v-if="hasQuote">
          <span class="text-sm font-semibold tabular-nums" :class="TREND_TEXT_CLASS[trend]">
            {{ formatPrice(quote?.price ?? null) }}
          </span>
          <span
            class="rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums"
            :class="TREND_PILL_CLASS[trend]"
          >
            {{ formatPercent(quote?.changePercent ?? null) }}
          </span>
        </template>
      </div>
    </template>

    <BaseSkeleton v-if="loading" />
    <BaseEmpty v-else-if="error" text="K 线数据加载失败（上游可能限频，稍后自动恢复）" />
    <KlineChart
      v-else-if="bars.length > 0"
      :key="`${item.symbol}-${mode}`"
      :bars="bars"
      :mode="mode === WIDE_BASE_ETF_VIEW_MODE.MINUTE ? 'timeline' : 'candle'"
      :pre-close="quote?.prevClose ?? null"
      :symbol="item.symbol"
      :intraday-axis="mode === WIDE_BASE_ETF_VIEW_MODE.MINUTE"
      sub-volume-only
      :height="WIDE_BASE_ETF_CHART_HEIGHT_PX"
    />
    <BaseEmpty v-else text="暂无数据" />
  </BaseCard>
</template>
