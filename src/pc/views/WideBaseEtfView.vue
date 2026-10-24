<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import NoticeBar from '../components/ui/NoticeBar.vue';
import TabConfigButton from '../components/ui/TabConfigButton.vue';
import WideBaseEtfCard from '../components/business/WideBaseEtfCard.vue';
import { fetchFullQuotes } from '../../common/api/quotes.api.ts';
import { usePolling } from '../../common/composables/use-polling';
import { useTabConfig } from '../../common/composables/use-tab-config';
import { POLLING_INTERVAL } from '../../common/constants/polling.constants.ts';
import { ROUTE_PATH } from '../../common/constants/router-meta.constants.ts';
import { useStockContextStore } from '../../common/stores/stock-context';
import {
  WIDE_BASE_ETFS,
  WIDE_BASE_ETF_GROUP,
  WIDE_BASE_ETF_GROUP_OPTIONS,
  WIDE_BASE_ETF_MINUTE_REFRESH_MS,
  WIDE_BASE_ETF_NOTICE_TEXT,
  WIDE_BASE_ETF_TAB_CONFIG_PAGE_ID,
  WIDE_BASE_ETF_TAB_OPTIONS,
  WIDE_BASE_ETF_VIEW_MODE,
  WIDE_BASE_ETF_VIEW_OPTIONS,
  type WideBaseEtfItem,
} from '../../common/constants/wide-base-etf.constants.ts';
import type { FullQuote } from '../../common/types/stock-quote.types.ts';

/**
 * 宽基ETF页（国家队 / 汇金系核心操作宽基监控；市场总览页头按钮进入，不入左侧导航）
 *
 * - 分组页签（大盘蓝筹 / 中小盘宽基 / 科技·创业板）切换组内卡片
 * - 显隐与顺序走「页签配置」弹窗（TabConfigButton，与盘面雷达同机制：
 *   分组弹窗勾选显隐 + 组内拖拽排序，草稿确认制，tab-config store 持久化）
 * - 全页统一 分时/日K 切换：分时 = 均价线 + 成交量，日K = MA + 成交量（参考个股详情侧栏）
 * - 行情批量轮询（腾讯源）共享一份；分时数据盘中每分钟跟随刷新（新浪分钟线）
 */

// ---------- 显隐 + 顺序（页签配置，持久化） ----------
const { visibleOptions } = useTabConfig(WIDE_BASE_ETF_TAB_CONFIG_PAGE_ID, WIDE_BASE_ETF_TAB_OPTIONS);

/** symbol -> 条目（visibleOptions 的 value 还原为 ETF 条目用） */
const itemBySymbol = new Map<string, WideBaseEtfItem>(
  WIDE_BASE_ETFS.map((item) => [item.symbol, item]),
);

/** symbol -> 分组键（visibleOptions 按当前分组过滤用） */
const groupBySymbol = new Map<string, string>(
  WIDE_BASE_ETFS.map((item) => [item.symbol, item.group]),
);

// ---------- 分组与图表模式 ----------
/** 当前分组页签（默认大盘蓝筹 = 持仓最重的第一主力组） */
const activeGroup = ref<string>(WIDE_BASE_ETF_GROUP.LARGE);

/**
 * 当前分组实际渲染的标的：页签配置的可见项（已含显隐过滤与用户排序）按分组过滤；
 * 注意 useTabConfig 在全部隐藏时会兜底全显，但单组全隐藏仍可能为空（空态兜底在模板）
 */
const visibleItems = computed(() =>
  visibleOptions.value
    .filter((option) => groupBySymbol.get(option.value) === activeGroup.value)
    .map((option) => itemBySymbol.get(option.value))
    .filter((item): item is WideBaseEtfItem => item !== undefined),
);

/** 图表模式（分时 / 日K，全页统一） */
const viewMode = ref<string>(WIDE_BASE_ETF_VIEW_MODE.MINUTE);

// ---------- 数据轮询 ----------
/** 盘中分时刷新 tick（自增驱动各卡片重拉分钟线） */
const minuteTick = ref(0);

/** 报价表（symbol -> FullQuote；批量接口一次拿全，含被隐藏项以保证重新打开后立即有价） */
const quotes = ref<Record<string, FullQuote>>({});

const fetchQuotes = async (): Promise<void> => {
  try {
    const list = await fetchFullQuotes(WIDE_BASE_ETFS.map((item) => item.symbol));
    const next: Record<string, FullQuote> = {};
    for (const quote of list) {
      if (quote?.code) next[quote.code] = quote;
    }
    quotes.value = next;
  } catch (error) {
    console.error('[wide-base-etf] quotes', error);
  }
};

// 行情轮询（30s，交易时段外挂载仍跑一次兜底展示最近收盘）
usePolling({
  task: fetchQuotes,
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

// 分时数据刷新 tick（60s；日K模式下空转不拉数据）
usePolling({
  task: async () => {
    if (viewMode.value === WIDE_BASE_ETF_VIEW_MODE.MINUTE) {
      minuteTick.value += 1;
    }
  },
  intervalMs: WIDE_BASE_ETF_MINUTE_REFRESH_MS,
  tradingAware: true,
});

// ---------- 卡片头部点击 → 股票详情整页（2026-10-26 王总指定） ----------
const router = useRouter();
const stockContext = useStockContextStore();

/**
 * 打开个股详情整页：先把**当前分组的全部宽基ETF**写入股票上下文
 * （详情页左侧「来源列表」即可在本组内一键切换），再路由跳转
 * @param symbol 目标符号
 */
const openStockDetail = (symbol: string): void => {
  stockContext.setContext(
    visibleItems.value.map((item) => ({
      symbol: item.symbol,
      name: item.name,
      price: quotes.value[item.symbol]?.price ?? null,
      changePercent: quotes.value[item.symbol]?.changePercent ?? null,
    })),
  );
  void router.push(`${ROUTE_PATH.STOCK_DETAIL}/${symbol}`);
};
</script>

<template>
  <!-- 根节点 h-full 定高：页头（说明 + 分组/视图页签）固定不动，
       卡片网格在内容滚动容器内滚动（2026-10-26 王总指定，页签不再随内容滚走） -->
  <div class="flex h-full min-h-0 flex-col gap-3">
    <!-- 页面用途说明（分时/日K 切换已下移分组页签行，2026-10-22 王总指定） -->
    <NoticeBar :text="WIDE_BASE_ETF_NOTICE_TEXT" class="shrink-0" />

    <!-- 分组页签 + 分时/日K 切换 + 页签配置按钮（显隐 / 组内顺序，与盘面雷达同款弹窗） -->
    <div class="flex shrink-0 flex-wrap items-center gap-3">
      <BaseTabs
        v-model="activeGroup"
        :options="WIDE_BASE_ETF_GROUP_OPTIONS"
        variant="underline"
        aria-label="宽基分组"
      />
      <BaseTabs
        v-model="viewMode"
        class="ml-auto"
        :options="WIDE_BASE_ETF_VIEW_OPTIONS"
        aria-label="图表模式"
      />
      <TabConfigButton
        :page-id="WIDE_BASE_ETF_TAB_CONFIG_PAGE_ID"
        :options="WIDE_BASE_ETF_TAB_OPTIONS"
      />
    </div>

    <!-- 内容滚动容器：一行 3 张，容器变窄降 2 列 / 1 列（主区已开 @container） -->
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div v-if="visibleItems.length > 0" class="grid grid-cols-1 gap-3 @3xl:grid-cols-2 @5xl:grid-cols-3">
        <WideBaseEtfCard
          v-for="item in visibleItems"
          :key="item.symbol"
          :item="item"
          :mode="viewMode"
          :quote="quotes[item.symbol] ?? null"
          :minute-tick="minuteTick"
          clickable-title
          @title-click="openStockDetail(item.symbol)"
        />
      </div>
      <BaseEmpty v-else text="当前分组的标的已全部隐藏，点上方「配置页签」重新勾选" />
    </div>
  </div>
</template>
