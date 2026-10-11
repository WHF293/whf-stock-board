<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { getEtfHoldings } from '../../../common/api/etf-holdings.api.ts';
import { fetchFullQuotes } from '../../../common/api/quotes.api.ts';
import { ETF_HOLDINGS_MIN_RATIO } from '../../../common/constants/etf.constants.ts';
import type { EtfHoldingsRecord } from '../../../common/types/etf.types.ts';
import type { FullQuote } from '../../../common/types/stock-quote.types.ts';
import { formatPrice } from '../../../common/utils/format-price';
import { formatPercent } from '../../../common/utils/format-percent';
import { formatDateTime } from '../../../common/utils/format-datetime';
import { toFullSymbol } from '../../../common/utils/to-full-symbol';
import { getTrendByChangePercent } from '../../../common/constants/trend.constants.ts';
import { TREND_TEXT_CLASS } from '../../../common/constants/stock-colors.constants.ts';

/**
 * ETF 持仓股列表（详情页 ETF 持仓 Tab 内容）：
 *
 * 数据为天天基金 f10 季度披露的重仓明细（按占净值比例降序），本地缓存 + 手动刷新；
 * 单击行向父级回传成分股代码（父级负责切换详情）
 */
const props = defineProps<{
  /** ETF 符号（sh512760 / 512760） */
  symbol: string;
}>();

const emit = defineEmits<{
  /** 单击持仓股行：回传成分股 6 位代码 */
  (e: 'open', symbol: string): void;
}>();

/** 持仓记录（null = 尚未加载）；最新价 / 涨跌幅为实时行情覆盖后的副本 */
const record = ref<EtfHoldingsRecord | null>(null);
/** 加载中 */
const isLoading = ref(false);
/** 加载失败文案（null = 无错误） */
const errorMessage = ref<string | null>(null);

/**
 * 用腾讯批量实时行情覆盖持仓的「最新价 / 涨跌幅」
 *
 * f10 原始 HTML 的这两列是 JS 异步填充的空壳（span[data-id]），抓不到值，
 * 因此披露数据落库后统一按实时行情补齐（单次批量请求，点击触发不轮询）
 * @param base 披露口径的持仓记录
 * @returns 合并实时行情后的副本（行情失败时原样返回）
 */
const mergeLiveQuotes = async (base: EtfHoldingsRecord): Promise<EtfHoldingsRecord> => {
  try {
    const quotes = await fetchFullQuotes(base.holdings.map((item) => toFullSymbol(item.symbol)));
    // quote.code 可能带市场前缀也可能为纯 6 位，统一剥到纯数字对齐
    const quoteByCode = new Map<string, FullQuote>(
      quotes
        .filter(Boolean)
        .map((quote) => [quote.code.replaceAll(/\D/g, ''), quote]),
    );
    return {
      ...base,
      holdings: base.holdings.map((item) => {
        const quote = quoteByCode.get(item.symbol);
        if (!quote) return item;
        return { ...item, price: quote.price, changePercent: quote.changePercent };
      }),
    };
  } catch (error) {
    // 实时行情失败不整页报错：保留披露时点值（此时两列展示 --）
    console.error('[etf-holdings] merge-quotes', error);
    return base;
  }
};

/**
 * 拉取持仓（缓存优先，force 时强制回源）
 * @param force 是否跳过缓存强制刷新
 */
const load = async (force = false): Promise<void> => {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    record.value = await mergeLiveQuotes(await getEtfHoldings(props.symbol, force));
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    isLoading.value = false;
  }
};

// 切换 ETF 时全量重拉（缓存优先，秒出）
watch(
  () => props.symbol,
  () => {
    void load();
  },
  { immediate: true },
);

/** 页面展示的持仓列表：仅占净值比例高于门槛的重仓股（缓存仍存全量披露数据） */
const visibleHoldings = computed(() =>
  record.value?.holdings.filter(
    (holding) => (holding.netValueRatio ?? 0) > ETF_HOLDINGS_MIN_RATIO,
  ) ?? [],
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <BaseSkeleton v-if="isLoading && !record" />
    <div v-else-if="errorMessage" class="flex flex-col items-center gap-2 py-10">
      <BaseEmpty :text="`持仓数据加载失败：${errorMessage}`" />
      <BaseButton variant="ghost" @click="load(true)">
        <MenuIcon name="refresh" :size="14" />
        重试
      </BaseButton>
    </div>
    <BaseEmpty
      v-else-if="visibleHoldings.length === 0"
      text="未取到该基金的持仓披露数据"
    />
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <!-- 工具条：持仓占比更新时间（左）/ 手动刷新（右，持仓季度披露，缓存优先） -->
      <div class="flex shrink-0 items-center justify-between gap-2 px-2 pb-1">
        <span v-if="record" class="truncate text-xs text-text-tertiary">
          持仓占比更新时间：{{ record.reportDate || '--' }}（仅展示占比高于
          {{ ETF_HOLDINGS_MIN_RATIO }}% 的重仓股）
          <span class="ml-2">数据更新于 {{ formatDateTime(record.fetchedAt) }}</span>
        </span>
        <BaseButton variant="ghost" :disabled="isLoading" @click="load(true)">
          <MenuIcon name="refresh" :size="14" />
          {{ isLoading ? '刷新中…' : '刷新' }}
        </BaseButton>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div
          class="sticky top-0 z-[1] flex items-center gap-3 border-b border-flat-weak bg-surface px-2 pb-1.5 text-xs text-text-tertiary"
        >
          <span class="flex-1">股票名称</span>
          <span class="w-20 text-right">持仓占比</span>
          <span class="w-16 text-right">最新</span>
          <span class="w-16 text-right">涨幅</span>
        </div>
        <button
          v-for="holding in visibleHoldings"
          :key="holding.symbol"
          type="button"
          class="flex w-full items-center gap-3 border-b border-flat-weak/50 px-2 py-1.5 text-sm tabular-nums last:border-0 hover:bg-flat-weak/40"
          :title="`查看 ${holding.name} 详情`"
          @click="emit('open', holding.symbol)"
        >
          <span class="flex min-w-0 flex-1 items-baseline gap-2">
            <span class="truncate font-medium text-text">{{ holding.name }}</span>
            <span class="shrink-0 text-xs text-text-tertiary">{{ holding.symbol }}</span>
          </span>
          <span class="w-20 text-right font-medium text-text">
            {{ holding.netValueRatio === null ? '--' : `${holding.netValueRatio.toFixed(2)}%` }}
          </span>
          <span class="w-16 text-right text-text-secondary">
            {{ holding.price === null ? '--' : formatPrice(holding.price) }}
          </span>
          <span
            class="w-16 text-right"
            :class="TREND_TEXT_CLASS[getTrendByChangePercent(holding.changePercent ?? 0)]"
          >
            {{ holding.changePercent === null ? '--' : formatPercent(holding.changePercent) }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
