<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import WideBaseEtfCard from '../components/business/WideBaseEtfCard.vue';
import { fetchFullQuotes } from '../../common/api/quotes.api.ts';
import { usePolling } from '../../common/composables/use-polling';
import { POLLING_INTERVAL } from '../../common/constants/polling.constants.ts';
import {
  LEADER_KIND,
  getLeaderGroups,
  type LeaderKind,
} from '../../common/constants/industry-leaders.constants.ts';
import {
  WIDE_BASE_ETF_MINUTE_REFRESH_MS,
  WIDE_BASE_ETF_VIEW_MODE,
  WIDE_BASE_ETF_VIEW_OPTIONS,
  type WideBaseEtfItem,
} from '../../common/constants/wide-base-etf.constants.ts';
import { ROUTE_PATH } from '../../common/constants/router-meta.constants.ts';
import { useStockContextStore } from '../../common/stores/stock-context';
import type { FullQuote } from '../../common/types/stock-quote.types.ts';

/**
 * 行业龙头详情页（行情全景-行业龙头点分组卡片标题进入，不入左侧导航；排版参考宽基ETF页）
 *
 * URL query 携带维度与分组：`?kind=board|segment&group=<分组名>`；
 * 页内为该板块 / 细分赛道全部龙头股的 K 线卡片网格（一行 3 张，窄容器降列），
 * 全页统一 分时/日K 切换（默认分时），分时盘中每分钟跟随刷新。
 * 复用 WideBaseEtfCard（分时 = 新浪分钟线 + 均价，日K = 缓存编排层蜡烛 + MA）。
 * 点卡片标题进个股详情整页（详情页左侧来源列表 = 本组全部龙头）。
 */

const route = useRoute();
const router = useRouter();
const stockContext = useStockContextStore();

/**
 * 解析 URL query 的维度（非法值回退板块维度）
 * @returns 维度（board / segment）
 */
const readKind = (): LeaderKind =>
  route.query.kind === 'segment' ? LEADER_KIND.SEGMENT : LEADER_KIND.BOARD;

/** 当前维度 */
const kind = ref<LeaderKind>(readKind());

/** 当前分组名（query；非法 / 缺失时回退该维度第一个分组） */
const groupName = computed<string>(() => {
  const groups = getLeaderGroups(kind.value);
  const queryName = toText(route.query.group);
  return groups.some((group) => group.name === queryName)
    ? queryName
    : (groups[0]?.name ?? '');
});

/**
 * 宽松文本转换（query 参数可能是数组形态）
 * @param value query 原始值
 * @returns 文本（非字符串回空串）
 */
function toText(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return typeof value === 'string' ? value : '';
}

/** 当前分组的全部龙头标的（映射为 WideBaseEtfCard 的条目形态，group 仅占位） */
const items = computed<WideBaseEtfItem[]>(() => {
  const group = getLeaderGroups(kind.value).find((item) => item.name === groupName.value);
  return (group?.stocks ?? []).map((stock) => ({
    symbol: stock.symbol,
    name: stock.name,
    group: groupName.value,
  }));
});

// 维度 / 分组变化（浏览器直接改 URL 回退前进）时同步本地状态
watch(
  () => [route.query.kind, route.query.group] as const,
  () => {
    kind.value = readKind();
  },
);

// ---------- 分时 / 日K（全页统一，默认分时） ----------
const viewMode = ref<string>(WIDE_BASE_ETF_VIEW_MODE.MINUTE);

// ---------- 数据轮询 ----------
/** 盘中分时刷新 tick（自增驱动各卡片重拉分钟线） */
const minuteTick = ref(0);

/** 报价表（code -> FullQuote；A股批量接口；港股清单标的缺席 → 卡头无报价、K线空态兜底） */
const quotes = ref<Record<string, FullQuote>>({});

/** 当前组内 A 股符号（fetchFullQuotes 为 A 股口径，hk 符号剔除） */
const aShareSymbols = computed(() =>
  items.value.map((item) => item.symbol).filter((symbol) => !symbol.startsWith('hk')),
);

const fetchQuotes = async (): Promise<void> => {
  if (aShareSymbols.value.length === 0) return;
  try {
    const list = await fetchFullQuotes(aShareSymbols.value);
    const next: Record<string, FullQuote> = {};
    for (const quote of list) {
      if (quote?.code) next[quote.code] = quote;
    }
    quotes.value = next;
  } catch (error) {
    console.error('[industry-leader-detail] quotes', error);
  }
};

usePolling({
  task: fetchQuotes,
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

// 分时刷新 tick（60s；日K模式下空转不拉数据）
usePolling({
  task: async () => {
    if (viewMode.value === WIDE_BASE_ETF_VIEW_MODE.MINUTE) {
      minuteTick.value += 1;
    }
  },
  intervalMs: WIDE_BASE_ETF_MINUTE_REFRESH_MS,
  tradingAware: true,
});

/**
 * 卡片标题点击 → 个股详情整页：先把本组全部龙头写入股票上下文
 * （详情页左侧「来源列表」即可在本组内一键切换），再路由跳转
 * @param symbol 目标符号
 */
const openStockDetail = (symbol: string): void => {
  stockContext.setContext(
    items.value.map((item) => ({
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
  <!-- 根节点 h-full 定高：分组标题行（含分时/日K 切换）固定，卡片网格在内容区滚动 -->
  <div class="flex h-full min-h-0 flex-col gap-3">
    <div v-if="items.length > 0" class="flex shrink-0 flex-wrap items-center gap-3">
      <span class="text-sm font-semibold text-text">{{ groupName }} · 龙头股（{{ items.length }}）</span>
      <BaseTabs
        v-model="viewMode"
        class="ml-auto"
        :options="WIDE_BASE_ETF_VIEW_OPTIONS"
        aria-label="图表模式"
      />
    </div>

    <!-- 内容滚动容器：一行 3 张，容器变窄降 2 列 / 1 列（主区已开 @container）；
         图表高度 / 日K 根数沿用 WideBaseEtfCard 内置常量（同一套卡片组件） -->
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div v-if="items.length > 0" class="grid grid-cols-1 gap-3 @3xl:grid-cols-2 @5xl:grid-cols-3">
        <WideBaseEtfCard
          v-for="item in items"
          :key="item.symbol"
          :item="item"
          :mode="viewMode"
          :quote="quotes[item.symbol] ?? null"
          :minute-tick="minuteTick"
          clickable-title
          @title-click="openStockDetail(item.symbol)"
        />
      </div>
      <BaseEmpty v-else text="分组不存在或暂无龙头标的" />
    </div>
  </div>
</template>
