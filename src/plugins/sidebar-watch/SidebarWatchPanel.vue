<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseEmpty from '../../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../../components/ui/BaseSkeleton.vue';
import MenuIcon from '../../components/ui/MenuIcon.vue';
import { fetchFullQuotes } from '../../api/quotes.api';
import { usePolling } from '../../composables/use-polling';
import { useDockPanelStore } from '../../stores/dock-panel';
import { useWatchlistStore } from '../../stores/watchlist';
import { POLLING_INTERVAL } from '../../constants/polling.constants';
import { ROUTE_PATH } from '../../constants/router-meta.constants';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import { TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { formatPercent } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import { SIDEBAR_WATCH_LIMIT, SIDEBAR_WATCH_SKELETON_ROWS } from './constants';
import type { FullQuote } from '../../types/stock-quote.types';

/**
 * 自选盯盘面板（插件 dsh-sidebar-watch 的 inline 侧栏面板）
 *
 * 常驻左侧栏，展示自选股前 N 只的现价与涨跌幅，单击开右侧个股详情面板。
 * 报价走全站统一轮询引擎（交易窗口感知 + 失败退避），与自选股页共用同一上游批量接口。
 */
/** 面板内渲染的一行盯盘数据 */
interface WatchRow {
  /** 完整符号（sh600519） */
  symbol: string;
  /** 展示名（行情未返回时回退自选股记录里的名称） */
  name: string;
  /** 现价文案 */
  price: string;
  /** 涨跌幅文案 */
  change: string;
  /** 涨跌幅文字色类名（红涨绿跌跟随全站涨跌主题） */
  trendClass: string;
}

const router = useRouter();
const watchlistStore = useWatchlistStore();
const dockPanel = useDockPanelStore();

/** 符号 → 最新报价（面板为独立轮询单元，与自选股页互不影响） */
const quotes = ref<Record<string, FullQuote>>({});

/** 是否处于首载（用于骨架屏；已有快照时不进骨架） */
const loading = ref(true);

/** 拉取全部自选股行情（腾讯批量接口，一次请求覆盖全部符号） */
const fetchQuotes = async (): Promise<void> => {
  const symbols = watchlistStore.allSymbols;
  if (symbols.length === 0) {
    quotes.value = {};
    loading.value = false;
    return;
  }
  const list = await fetchFullQuotes(symbols);
  quotes.value = Object.fromEntries(list.map((quote) => [quote.code, quote]));
  loading.value = false;
};

usePolling({
  task: fetchQuotes,
  intervalMs: POLLING_INTERVAL.QUOTES_INTRADAY,
  tradingAware: true,
});

/** 自选股记录（扁平去重，保持加入顺序） */
const entries = computed(() => {
  const seen = new Set<string>();
  const list: { symbol: string; name: string }[] = [];
  for (const group of watchlistStore.groups) {
    for (const stock of group.stocks) {
      if (seen.has(stock.symbol)) continue;
      seen.add(stock.symbol);
      list.push({ symbol: stock.symbol, name: stock.name });
    }
  }
  return list;
});

/** 面板内展示的行（截断到上限） */
const rows = computed<WatchRow[]>(() =>
  entries.value.slice(0, SIDEBAR_WATCH_LIMIT).map((entry) => {
    const quote = quotes.value[entry.symbol];
    const changePercent = quote?.changePercent ?? null;
    return {
      symbol: entry.symbol,
      name: quote?.name || entry.name || entry.symbol,
      price: formatPrice(quote?.price ?? null),
      change: formatPercent(changePercent),
      trendClass: TREND_TEXT_CLASS[getTrendByChangePercent(changePercent ?? 0)],
    };
  }),
);

/** 自选股总数（判断是否需要提示「还有更多」） */
const totalCount = computed(() => entries.value.length);

/**
 * 单击一行：打开右侧个股详情面板（打开个股的唯一入口，不走路由）
 * @param symbol 完整符号
 */
const onOpenStock = (symbol: string): void => {
  dockPanel.openStock(symbol);
};

/** 跳转到自选股页查看全量 */
const onOpenWatchlist = (): void => {
  void router.push(ROUTE_PATH.WATCHLIST);
};
</script>

<template>
  <div>
    <BaseSkeleton v-if="loading && totalCount > 0">
      <div
        v-for="index in SIDEBAR_WATCH_SKELETON_ROWS"
        :key="index"
        class="h-6 rounded bg-flat-weak"
      />
    </BaseSkeleton>

    <BaseEmpty v-else-if="totalCount === 0" text="还没有自选股" />

    <ul v-else class="space-y-0.5">
      <li v-for="row in rows" :key="row.symbol">
        <button
          type="button"
          class="pressable flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-flat-weak active:scale-[0.98]"
          :title="`${row.name} ${row.price} ${row.change}`"
          @click="onOpenStock(row.symbol)"
        >
          <span class="min-w-0 flex-1 truncate text-xs text-text">{{ row.name }}</span>
          <span class="shrink-0 text-xs tabular-nums text-text-secondary">{{ row.price }}</span>
          <span class="w-[52px] shrink-0 text-right text-xs tabular-nums" :class="row.trendClass">
            {{ row.change }}
          </span>
        </button>
      </li>
    </ul>

    <button
      v-if="totalCount > rows.length"
      type="button"
      class="pressable mt-1 flex w-full items-center justify-center gap-1 rounded-md py-1 text-xs text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-[0.98]"
      @click="onOpenWatchlist"
    >
      <span>另有 {{ totalCount - rows.length }} 只</span>
      <MenuIcon name="chevronRight" :size="12" />
    </button>
  </div>
</template>
