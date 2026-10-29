<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseCard from '../ui/BaseCard.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import { useDataCacheStore } from '../../../common/stores/data-cache';
import { usePolling } from '../../../common/composables/use-polling';
import { useStockOpen } from '../../../common/composables/use-stock-open';
import {
  fetchBoardChanges,
  fetchStockChanges,
  fetchZtPool,
} from '../../../common/api/event.api.ts';
import {
  fetchBlockTradeDetail,
  fetchDragonTigerDetail,
} from '../../../common/api/dragon-tiger.api.ts';
import { delay } from '../../../common/utils/delay';
import { formatAmount } from '../../../common/utils/format-amount';
import { formatBoardTime } from '../../../common/utils/format-board-time';
import { formatPercent, formatPercentUnsigned } from '../../../common/utils/format-percent';
import { formatPrice } from '../../../common/utils/format-price';
import { formatVolume } from '../../../common/utils/format-volume';
import { formatYuanWithSign } from '../../../common/utils/format-yuan';
import { getTrendByChangePercent } from '../../../common/constants/trend.constants.ts';
import type { Trend } from '../../../common/constants/trend.constants.ts';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../../../common/constants/stock-colors.constants.ts';
import { POLLING_INTERVAL } from '../../../common/constants/polling.constants.ts';
import { DATA_CACHE_KEY } from '../../../common/constants/data-cache.constants.ts';
import {
  STOCK_CHANGE_MAX_ITEMS,
  ZT_POOL_DEFAULT,
  ZT_POOL_OPTIONS,
} from '../../../common/constants/event.constants.ts';
import {
  TILED_DRAGON_DIRECTION_OPTIONS,
  TILED_LIST_MAX_COUNT,
  TILED_QUOTE_RANK_COUNT,
} from '../../../common/constants/market-rank.constants.ts';
import type {
  BoardChangeItem,
  StockChangeItem,
  ZTPoolItem,
  ZTPoolType,
} from '../../../common/types/event.types.ts';
import type {
  BlockTradeDetailItem,
  DragonTigerDetailItem,
} from '../../../common/types/dragon-tiger.types.ts';
import type { FullQuote } from '../../../common/types/stock-quote.types.ts';
import type { RankDataset } from '../../../common/types/rank-dataset.types.ts';

/**
 * 盘面雷达平铺看板（2026-10-27 王总指定，布局 = 平铺时替代页签榜单；只读，不支持拖拽）：
 * 一个可见页签一列（375px 横向卡片流，参考热点新闻页样式），行只展示三项关键信息
 * （名称 / 现价 / 该榜关键指标），hover 原位展开其余字段；
 * 页签内带筛选项或子视图的（连板股池 / 龙虎榜涨跌 / 日期），
 * 参考热点新闻卡片内部分组策略 —— 子切换器内嵌到列头下方。
 *
 * 数据口径：报价排序榜消费页面轮询的全 A 报价；其余页签自管数据 ——
 * 股池 / 盘口异动 / 板块异动进平铺时拉取（随列轮询 30s），
 * 龙虎榜 / 大宗为重接口只拉一次不轮询；全部与页签模式共用同一批 dataCache 快照键
 */
const props = defineProps<{
  /** 可见页签（沿用页签显隐配置结果，顺序即列顺序） */
  tabs: readonly { label: string; value: string }[];
  /** 全 A 报价（页面轮询写入；报价排序类页签列消费） */
  quotes: FullQuote[];
  /** 全 A 报价首载中（报价排序列的空态文案区分加载 / 无数据） */
  quotesLoading?: boolean;
}>();

const dataCache = useDataCacheStore();
const { openSidebar } = useStockOpen();

/** 各接口请求间隔（毫秒）：对同一上游串行错峰 */
const REQUEST_GAP_MS = 500;

/**
 * 个股跳详情（6 位纯代码 -> 右侧详情侧栏）
 * @param code 个股 6 位代码
 */
const openDetail = (code: string): void => {
  openSidebar(code);
};

/**
 * 行涨跌方向（相对 0，驱动现价文字色与涨跌幅胶囊配色）
 * @param changePercent 涨跌幅
 * @returns 趋势枚举
 */
const trendOf = (changePercent: number | null | undefined): Trend =>
  getTrendByChangePercent(changePercent ?? 0);

/**
 * 页签是否可见（按需拉数：被隐藏的页签不发请求）
 * @param value 页签值
 * @returns 是否可见
 */
const hasTab = (value: string): boolean => props.tabs.some((tab) => tab.value === value);

// ---------- 报价排序榜（涨幅 / 跌幅 / 成交额 / 换手率：消费页面轮询的全 A 报价） ----------

/**
 * 报价排序榜列数据（取前 N 条；跌幅榜升序，其余降序）
 * @param value 页签值
 * @returns 排序后的报价列表
 */
const quoteRankRows = (value: string): FullQuote[] => {
  const isDesc = value !== 'changePercentDesc';
  const keyOf = (quote: FullQuote): number => {
    if (value === 'amount') {
      return quote.amount ?? 0;
    }
    if (value === 'turnoverRate') {
      return quote.turnoverRate ?? 0;
    }
    return quote.changePercent ?? 0;
  };
  return [...props.quotes]
    .sort((a, b) => (isDesc ? keyOf(b) - keyOf(a) : keyOf(a) - keyOf(b)))
    .slice(0, TILED_QUOTE_RANK_COUNT);
};

/**
 * 是否为报价排序类页签
 * @param value 页签值
 * @returns 是否为报价排序类
 */
const isQuoteRankTab = (value: string): boolean =>
  value === 'changePercent' ||
  value === 'changePercentDesc' ||
  value === 'amount' ||
  value === 'turnoverRate';

// ---------- 股池（连板列：列头股池 chips 切换 + 30s 轮询） ----------

const activePool = ref<string>(ZT_POOL_DEFAULT);
const poolItems = ref<ZTPoolItem[]>(
  dataCache.get<ZTPoolItem[]>(DATA_CACHE_KEY.EVENT_POOL_PREFIX + ZT_POOL_DEFAULT) ?? [],
);
const isPoolLoading = ref(poolItems.value.length === 0);
const poolError = ref(false);

/** 拉取当前股池（成功写快照） */
const fetchPool = async (): Promise<void> => {
  isPoolLoading.value = true;
  try {
    poolItems.value = await fetchZtPool(activePool.value as ZTPoolType);
    dataCache.set(DATA_CACHE_KEY.EVENT_POOL_PREFIX + activePool.value, poolItems.value);
  } catch (error) {
    poolError.value = poolItems.value.length === 0;
    console.error('[market-rank-tiled] pool', error);
  } finally {
    isPoolLoading.value = false;
  }
};

watch(activePool, () => {
  // 切池：先快照播种再拉最新
  poolItems.value =
    dataCache.get<ZTPoolItem[]>(DATA_CACHE_KEY.EVENT_POOL_PREFIX + activePool.value) ?? [];
  isPoolLoading.value = poolItems.value.length === 0;
  void fetchPool();
});

/** 连板梯队：连板数 -> 家数（仅涨停池有连板字段，参考页签模式的梯队摘要） */
const ladder = computed(() => {
  const counts = new Map<number, number>();
  for (const item of poolItems.value) {
    const count = item.continuousBoardCount ?? 1;
    counts.set(count, (counts.get(count) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[0] - a[0]);
});

// ---------- 盘口 / 板块异动（各自独立列，随轮询刷新） ----------

const stockChanges = ref<StockChangeItem[]>(
  dataCache.get<StockChangeItem[]>(DATA_CACHE_KEY.EVENT_STOCK_CHANGES) ?? [],
);
const isStockChangeLoading = ref(stockChanges.value.length === 0);
const stockChangeError = ref(false);

const boardChanges = ref<BoardChangeItem[]>(
  dataCache.get<BoardChangeItem[]>(DATA_CACHE_KEY.EVENT_BOARD_CHANGES) ?? [],
);
const isBoardChangeLoading = ref(boardChanges.value.length === 0);
const boardChangeError = ref(false);

/** 拉取盘口异动（成功写快照） */
const fetchStockChangesList = async (): Promise<void> => {
  isStockChangeLoading.value = true;
  try {
    stockChanges.value = await fetchStockChanges();
    dataCache.set(DATA_CACHE_KEY.EVENT_STOCK_CHANGES, stockChanges.value);
  } catch (error) {
    stockChangeError.value = stockChanges.value.length === 0;
    console.error('[market-rank-tiled] stock-changes', error);
  } finally {
    isStockChangeLoading.value = false;
  }
};

/** 拉取板块异动（成功写快照） */
const fetchBoardChangesList = async (): Promise<void> => {
  isBoardChangeLoading.value = true;
  try {
    boardChanges.value = await fetchBoardChanges();
    dataCache.set(DATA_CACHE_KEY.EVENT_BOARD_CHANGES, boardChanges.value);
  } catch (error) {
    boardChangeError.value = boardChanges.value.length === 0;
    console.error('[market-rank-tiled] board-changes', error);
  } finally {
    isBoardChangeLoading.value = false;
  }
};

// 股池 + 两路异动随列轮询（口径与页签模式的涨停维度一致：30s 下限、盘中生效）
usePolling({
  task: async () => {
    if (hasTab('event')) {
      await fetchPool();
      await delay(REQUEST_GAP_MS);
    }
    if (hasTab('stock-changes')) {
      await fetchStockChangesList();
      await delay(REQUEST_GAP_MS);
    }
    if (hasTab('board-changes')) {
      await fetchBoardChangesList();
    }
  },
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

// ---------- 龙虎榜 / 大宗交易（重接口：进平铺各拉一次，不轮询） ----------

const dragonDirection = ref<'up' | 'down'>('up');
const dragonItems = ref<DragonTigerDetailItem[]>(
  dataCache.get<DragonTigerDetailItem[]>(DATA_CACHE_KEY.DRAGON_TIGER_ITEMS) ?? [],
);
const isDragonLoading = ref(dragonItems.value.length === 0);
const dragonError = ref(false);

/** 拉取龙虎榜明细（成功写快照） */
const loadDragon = async (): Promise<void> => {
  isDragonLoading.value = true;
  try {
    dragonItems.value = await fetchDragonTigerDetail();
    dataCache.set(DATA_CACHE_KEY.DRAGON_TIGER_ITEMS, dragonItems.value);
  } catch (error) {
    dragonError.value = dragonItems.value.length === 0;
    console.error('[market-rank-tiled] dragon', error);
  } finally {
    isDragonLoading.value = false;
  }
};

const blockItems = ref<BlockTradeDetailItem[]>(
  dataCache.get<BlockTradeDetailItem[]>(DATA_CACHE_KEY.BLOCK_TRADE_ITEMS) ?? [],
);
const isBlockLoading = ref(blockItems.value.length === 0);
const blockError = ref(false);

/** 拉取大宗交易明细（成功写快照） */
const loadBlock = async (): Promise<void> => {
  isBlockLoading.value = true;
  try {
    blockItems.value = await fetchBlockTradeDetail();
    dataCache.set(DATA_CACHE_KEY.BLOCK_TRADE_ITEMS, blockItems.value);
  } catch (error) {
    blockError.value = blockItems.value.length === 0;
    console.error('[market-rank-tiled] block', error);
  } finally {
    isBlockLoading.value = false;
  }
};

/** 龙虎榜日期选项（从数据提取，倒序；默认最新一日） */
const dragonDateOptions = computed(() => {
  const dates = [...new Set(dragonItems.value.map((item) => item.date))].sort().reverse();
  return dates.map((date) => ({ label: date, value: date }));
});
const dragonDate = ref<string>('');
watch(dragonDateOptions, (options) => {
  if (options.length > 0 && !options.some((option) => option.value === dragonDate.value)) {
    dragonDate.value = options[0].value;
  }
});

/** 大宗交易日期选项（同上） */
const blockDateOptions = computed(() => {
  const dates = [...new Set(blockItems.value.map((item) => item.date))].sort().reverse();
  return dates.map((date) => ({ label: date, value: date }));
});
const blockDate = ref<string>('');
watch(blockDateOptions, (options) => {
  if (options.length > 0 && !options.some((option) => option.value === blockDate.value)) {
    blockDate.value = options[0].value;
  }
});

/** 当前日期 + 涨 / 跌方向过滤后的龙虎榜明细（全量；展示层截断见 dragonRows） */
const dragonRowsFull = computed(() =>
  dragonItems.value.filter((item) => {
    if (dragonDate.value && item.date !== dragonDate.value) {
      return false;
    }
    const change = item.changePercent ?? 0;
    return dragonDirection.value === 'up' ? change > 0 : change <= 0;
  }),
);

/** 龙虎榜展示行（截断到 TILED_LIST_MAX_COUNT） */
const dragonRows = computed(() => dragonRowsFull.value.slice(0, TILED_LIST_MAX_COUNT));

/** 当前日期的大宗明细（全量；展示层截断见 blockRows） */
const blockRowsFull = computed(() =>
  blockItems.value.filter((item) => !blockDate.value || item.date === blockDate.value),
);

/** 大宗展示行（截断到 TILED_LIST_MAX_COUNT） */
const blockRows = computed(() => blockRowsFull.value.slice(0, TILED_LIST_MAX_COUNT));

// ---------- 进平铺时按可见页签拉一次自管数据（错峰、快照已有则跳过） ----------

void (async () => {
  if (hasTab('event') && poolItems.value.length === 0) {
    await fetchPool();
    await delay(REQUEST_GAP_MS);
  }
  if (hasTab('stock-changes') && stockChanges.value.length === 0) {
    await fetchStockChangesList();
    await delay(REQUEST_GAP_MS);
  }
  if (hasTab('board-changes') && boardChanges.value.length === 0) {
    await fetchBoardChangesList();
    await delay(REQUEST_GAP_MS);
  }
  if (hasTab('dragon-tiger') && dragonItems.value.length === 0) {
    await loadDragon();
    await delay(REQUEST_GAP_MS);
  }
  if (hasTab('block-trade') && blockItems.value.length === 0) {
    await loadBlock();
  }
})();

/**
 * 列头计数徽标（该列当前展示条数）
 * @param value 页签值
 * @returns 条数
 */
const countOf = (value: string): number => {
  if (isQuoteRankTab(value)) {
    return Math.min(quoteRankRows(value).length, TILED_QUOTE_RANK_COUNT);
  }
  switch (value) {
    case 'event':
      return poolItems.value.length;
    case 'stock-changes':
      return Math.min(stockChanges.value.length, STOCK_CHANGE_MAX_ITEMS);
    case 'board-changes':
      return boardChanges.value.length;
    case 'dragon-tiger':
      return dragonRows.value.length;
    case 'block-trade':
      return blockRows.value.length;
    default:
      return 0;
  }
};

/** 盘口异动行（时间轴，上限与页签模式一致） */
const stockChangeRows = computed(() =>
  stockChanges.value.slice(0, STOCK_CHANGE_MAX_ITEMS),
);

// ---------- 榜单数据出口（父级页面 AI 分析 / 导出 Excel 经 defineExpose 消费） ----------

/** 报价排序榜导出列（与原页签模式同列，含代码） */
const quoteExportColumns: { label: string; key: string }[] = [
  { key: 'name', label: '个股' },
  { key: 'code', label: '代码' },
  { key: 'price', label: '最新价' },
  { key: 'changePercent', label: '涨跌幅(%)' },
  { key: 'change', label: '涨跌额' },
  { key: 'volume', label: '成交量(手)' },
  { key: 'amount', label: '成交额(万)' },
  { key: 'turnoverRate', label: '换手率(%)' },
  { key: 'volumeRatio', label: '量比' },
  { key: 'pe', label: '市盈率' },
];

/** 股池导出列（含代码 / 连板数 / 封单原始元值） */
const poolExportColumns: { label: string; key: string }[] = [
  { key: 'name', label: '名称' },
  { key: 'code', label: '代码' },
  { key: 'price', label: '现价' },
  { key: 'changePercent', label: '涨跌幅(%)' },
  { key: 'continuousBoardCount', label: '连板数' },
  { key: 'firstBoardTime', label: '首次封板' },
  { key: 'boardAmount', label: '封单(元)' },
  { key: 'turnoverRate', label: '换手率(%)' },
  { key: 'industry', label: '行业' },
];

/** 盘口异动导出列（时间轴条目，类型文案缺省回退类型键） */
const stockChangeExportColumns: { label: string; key: string }[] = [
  { key: 'time', label: '时间' },
  { key: 'name', label: '名称' },
  { key: 'code', label: '代码' },
  { key: 'changeTypeLabel', label: '类型' },
  { key: 'info', label: '说明' },
];

/** 板块异动导出列 */
const boardChangeExportColumns: { label: string; key: string }[] = [
  { key: 'name', label: '板块' },
  { key: 'changePercent', label: '涨跌幅(%)' },
  { key: 'mainNetInflow', label: '主力净流入(元)' },
  { key: 'totalChangeCount', label: '异动次数' },
  { key: 'topStockName', label: '最频繁个股' },
];

/** 龙虎榜导出列（金额为原始元值） */
const dragonExportColumns: { label: string; key: string }[] = [
  { key: 'name', label: '个股' },
  { key: 'code', label: '代码' },
  { key: 'date', label: '日期' },
  { key: 'close', label: '收盘' },
  { key: 'changePercent', label: '涨跌幅(%)' },
  { key: 'netBuyAmount', label: '龙虎榜净买额(元)' },
  { key: 'netBuyRatio', label: '净买占比(%)' },
  { key: 'reason', label: '上榜原因' },
  { key: 'afterChange5d', label: '上榜后5日(%)' },
];

/** 大宗交易导出列（成交量为原始股值） */
const blockExportColumns: { label: string; key: string }[] = [
  { key: 'name', label: '个股' },
  { key: 'code', label: '代码' },
  { key: 'date', label: '交易日期' },
  { key: 'dealPrice', label: '成交价' },
  { key: 'dealVolume', label: '成交量(股)' },
  { key: 'dealAmount', label: '成交额(元)' },
  { key: 'premiumRate', label: '溢价率(%)' },
  { key: 'buyBranch', label: '买方营业部' },
  { key: 'sellBranch', label: '卖方营业部' },
];

/**
 * 汇总全部**可见页签**的榜单数据段（每页签一段，导出即多工作表）
 * @returns 数据段列表；数据未加载完成时对应段为空行
 */
const getRankDatasets = (): RankDataset[] => {
  const datasets: RankDataset[] = [];
  for (const tab of props.tabs) {
    if (isQuoteRankTab(tab.value)) {
      datasets.push({
        title: tab.label,
        columns: quoteExportColumns,
        rows: quoteRankRows(tab.value) as unknown as Record<string, unknown>[],
      });
      continue;
    }
    switch (tab.value) {
      case 'event': {
        const poolLabel =
          ZT_POOL_OPTIONS.find((option) => option.value === activePool.value)?.label ?? '股池';
        datasets.push({
          title: `${tab.label}-${poolLabel}`,
          columns: poolExportColumns,
          rows: poolItems.value as unknown as Record<string, unknown>[],
        });
        break;
      }
      case 'stock-changes':
        datasets.push({
          title: tab.label,
          columns: stockChangeExportColumns,
          rows: stockChanges.value.slice(0, STOCK_CHANGE_MAX_ITEMS).map((row) => ({
            ...row,
            changeTypeLabel: row.changeTypeLabel || row.changeType,
          })) as unknown as Record<string, unknown>[],
        });
        break;
      case 'board-changes':
        datasets.push({
          title: tab.label,
          columns: boardChangeExportColumns,
          rows: boardChanges.value as unknown as Record<string, unknown>[],
        });
        break;
      case 'dragon-tiger':
        datasets.push({
          title: `${tab.label}-${dragonDate.value || '最新'}·${dragonDirection.value === 'up' ? '涨' : '跌'}`,
          columns: dragonExportColumns,
          rows: dragonRowsFull.value as unknown as Record<string, unknown>[],
        });
        break;
      case 'block-trade':
        datasets.push({
          title: `${tab.label}-${blockDate.value || '最新'}`,
          columns: blockExportColumns,
          rows: blockRowsFull.value as unknown as Record<string, unknown>[],
        });
        break;
      default:
        break;
    }
  }
  return datasets;
};

defineExpose({ getRankDatasets });
</script>

<template>
  <!-- 横向卡片流：一个可见页签一列，超出页面横向滚动（列内各自纵向滚动）；只读无拖拽 -->
  <div class="flex h-full min-h-0 gap-4 overflow-x-auto pb-1">
    <BaseCard
      v-for="tab in tabs"
      :key="tab.value"
      class="!flex !h-full !w-[375px] !shrink-0 !flex-col !overflow-hidden !p-0"
    >
      <!-- 列头：页签名 + 条数（与热点新闻卡片头同规格） -->
      <header
        class="flex shrink-0 items-center justify-between gap-2 border-b border-flat-weak px-4 py-3"
      >
        <h2 class="min-w-0 truncate text-sm font-semibold text-text">{{ tab.label }}</h2>
        <span class="shrink-0 text-xs tabular-nums text-text-tertiary">
          {{ countOf(tab.value) }} 条
        </span>
      </header>

      <!-- 列头子筛选（页签内有筛选项的，内嵌到列头下方 —— 热点新闻卡片同策略） -->
      <div
        v-if="tab.value === 'event' || tab.value === 'dragon-tiger' || tab.value === 'block-trade'"
        class="shrink-0 border-b border-flat-weak px-3 py-2"
      >
        <BaseTabs
          v-if="tab.value === 'event'"
          v-model="activePool"
          :options="ZT_POOL_OPTIONS"
          aria-label="股池切换"
        />
        <div v-else-if="tab.value === 'dragon-tiger'" class="flex items-center justify-between gap-2">
          <select
            v-model="dragonDate"
            class="rounded-lg bg-flat-weak px-2 py-1 text-xs text-text outline-none"
            aria-label="龙虎榜上榜日期"
          >
            <option v-for="option in dragonDateOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <BaseTabs
            v-model="dragonDirection"
            :options="TILED_DRAGON_DIRECTION_OPTIONS"
            aria-label="龙虎榜涨跌方向"
          />
        </div>
        <select
          v-else
          v-model="blockDate"
          class="rounded-lg bg-flat-weak px-2 py-1 text-xs text-text outline-none"
          aria-label="大宗交易日期"
        >
          <option v-for="option in blockDateOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>

      <!-- 连板梯队摘要（仅连板列的涨停池；与页签模式同口径） -->
      <div
        v-if="tab.value === 'event' && activePool === 'zt' && ladder.length > 0"
        class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-flat-weak px-3 py-2"
      >
        <span
          v-for="[count, num] in ladder"
          :key="count"
          class="rounded-full px-2 py-0.5 text-xs font-medium"
          :class="count >= 3 ? 'bg-up-weak text-up' : 'bg-flat-weak text-text-secondary'"
        >
          {{ count >= 2 ? `${count}板` : '首板' }} · {{ num }} 家
        </span>
      </div>

      <!-- 列体：只读榜单行（hover 原位展开其余字段） -->
      <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
        <!-- 报价排序榜（涨幅 / 跌幅 / 成交额 / 换手率）：名称 / 现价 / 涨跌幅 -->
        <template v-if="isQuoteRankTab(tab.value)">
          <div
            v-for="quote in quoteRankRows(tab.value)"
            :key="quote.code"
            class="group cursor-pointer rounded-xl border border-flat-weak bg-flat-weak/40 p-2 transition-colors hover:bg-flat-weak"
            @click="openDetail(quote.code)"
          >
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-text">
                {{ quote.name }}
              </span>
              <span
                class="shrink-0 text-sm font-medium"
                :class="TREND_TEXT_CLASS[trendOf(quote.changePercent)]"
              >
                {{ formatPrice(quote.price) }}
              </span>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="TREND_PILL_CLASS[trendOf(quote.changePercent)]"
              >
                {{ formatPercent(quote.changePercent) }}
              </span>
            </div>
            <div class="hidden flex-col gap-0.5 border-t border-flat-weak pt-1.5 text-xs text-text-secondary group-hover:flex">
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">代码</span>
                <span class="font-mono">{{ quote.code }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">涨跌额</span>
                <span>{{ (quote.change ?? 0) > 0 ? '+' : '' }}{{ formatPrice(quote.change) }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">成交量</span>
                <span>{{ formatVolume(quote.volume) }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">成交额</span>
                <span>{{ formatAmount(quote.amount) }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">换手率</span>
                <span>{{ formatPercentUnsigned(quote.turnoverRate) }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">量比</span>
                <span>{{ quote.volumeRatio === null ? '--' : quote.volumeRatio.toFixed(2) }}</span>
              </div>
            </div>
          </div>
          <p
            v-if="quotes.length === 0"
            class="px-2 py-6 text-center text-xs leading-5 text-text-tertiary"
          >
            {{ quotesLoading ? '行情加载中…' : '暂无数据' }}
          </p>
        </template>

        <!-- 连板股池：名称 / 现价 / 涨跌幅 -->
        <template v-else-if="tab.value === 'event'">
          <div
            v-for="item in poolItems.slice(0, TILED_LIST_MAX_COUNT)"
            :key="item.code"
            class="group cursor-pointer rounded-xl border border-flat-weak bg-flat-weak/40 p-2 transition-colors hover:bg-flat-weak"
            @click="openDetail(item.code)"
          >
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-text">
                {{ item.name }}
              </span>
              <span
                class="shrink-0 text-sm font-medium"
                :class="TREND_TEXT_CLASS[trendOf(item.changePercent)]"
              >
                {{ formatPrice(item.price) }}
              </span>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="TREND_PILL_CLASS[trendOf(item.changePercent)]"
              >
                {{ formatPercent(item.changePercent) }}
              </span>
            </div>
            <div class="hidden flex-col gap-0.5 border-t border-flat-weak pt-1.5 text-xs text-text-secondary group-hover:flex">
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">代码</span>
                <span class="font-mono">{{ item.code }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">连板数</span>
                <span>{{ item.continuousBoardCount ?? '--' }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">首次封板</span>
                <span>{{ item.firstBoardTime === null ? '--' : formatBoardTime(item.firstBoardTime) }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">封单</span>
                <span>{{ item.boardAmount === null ? '--' : formatAmount(item.boardAmount / 10_000) }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">换手率</span>
                <span>{{ formatPercentUnsigned(item.turnoverRate) }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">行业</span>
                <span class="truncate">{{ item.industry || '--' }}</span>
              </div>
            </div>
          </div>
          <p
            v-if="poolItems.length === 0"
            class="px-2 py-6 text-center text-xs leading-5 text-text-tertiary"
          >
            {{ isPoolLoading ? '股池加载中…' : poolError ? '加载失败，请稍后重试' : '暂无数据' }}
          </p>
        </template>

        <!-- 盘口异动：时间 / 名称 / 类型（时间轴行） -->
        <template v-else-if="tab.value === 'stock-changes'">
          <div
            v-for="(change, index) in stockChangeRows"
            :key="`${change.time}-${change.code}-${index}`"
            class="group cursor-pointer rounded-xl border border-flat-weak bg-flat-weak/40 p-2 transition-colors hover:bg-flat-weak"
            @click="openDetail(change.code)"
          >
            <div class="flex items-center gap-2">
              <span class="shrink-0 text-xs tabular-nums text-text-tertiary">
                {{ change.time }}
              </span>
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-text">
                {{ change.name }}
              </span>
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-xs"
                :class="
                  ['rocket_launch', 'quick_rebound', 'limit_up_seal', 'big_buy_order'].includes(
                    change.changeType,
                  )
                    ? 'bg-up-weak text-up'
                    : 'bg-down-weak text-down'
                "
              >
                {{ change.changeTypeLabel || change.changeType }}
              </span>
            </div>
            <div class="hidden flex-col gap-0.5 border-t border-flat-weak pt-1.5 text-xs text-text-secondary group-hover:flex">
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">代码</span>
                <span class="font-mono">{{ change.code }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">说明</span>
                <span class="min-w-0 truncate text-left">{{ change.info || '--' }}</span>
              </div>
            </div>
          </div>
          <p
            v-if="stockChanges.length === 0"
            class="px-2 py-6 text-center text-xs leading-5 text-text-tertiary"
          >
            {{ isStockChangeLoading ? '盘口异动加载中…' : stockChangeError ? '加载失败，请稍后重试' : '暂无异动数据' }}
          </p>
        </template>

        <!-- 板块异动：板块 / 涨跌幅 / 主力净流入 -->
        <template v-else-if="tab.value === 'board-changes'">
          <div
            v-for="board in boardChanges.slice(0, TILED_LIST_MAX_COUNT)"
            :key="board.name"
            class="group cursor-pointer rounded-xl border border-flat-weak bg-flat-weak/40 p-2 transition-colors hover:bg-flat-weak"
          >
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-text">
                {{ board.name }}
              </span>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="TREND_PILL_CLASS[trendOf(board.changePercent)]"
              >
                {{ formatPercent(board.changePercent) }}
              </span>
              <span
                class="shrink-0 text-sm font-medium tabular-nums"
                :class="(board.mainNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'"
              >
                {{ formatYuanWithSign(board.mainNetInflow) }}
              </span>
            </div>
            <div class="hidden flex-col gap-0.5 border-t border-flat-weak pt-1.5 text-xs text-text-secondary group-hover:flex">
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">异动次数</span>
                <span>{{ board.totalChangeCount ?? '--' }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">最频繁个股</span>
                <span>{{ board.topStockName }}</span>
              </div>
            </div>
          </div>
          <p
            v-if="boardChanges.length === 0"
            class="px-2 py-6 text-center text-xs leading-5 text-text-tertiary"
          >
            {{ isBoardChangeLoading ? '板块异动加载中…' : boardChangeError ? '加载失败，请稍后重试' : '暂无异动数据' }}
          </p>
        </template>

        <!-- 龙虎榜：名称 / 收盘 / 涨跌幅 -->
        <template v-else-if="tab.value === 'dragon-tiger'">
          <div
            v-for="item in dragonRows"
            :key="`${item.date}-${item.code}`"
            class="group cursor-pointer rounded-xl border border-flat-weak bg-flat-weak/40 p-2 transition-colors hover:bg-flat-weak"
            @click="openDetail(item.code)"
          >
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-text">
                {{ item.name }}
              </span>
              <span class="shrink-0 text-sm font-medium tabular-nums text-text-secondary">
                {{ formatPrice(item.close) }}
              </span>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="TREND_PILL_CLASS[trendOf(item.changePercent)]"
              >
                {{ formatPercent(item.changePercent) }}
              </span>
            </div>
            <div class="hidden flex-col gap-0.5 border-t border-flat-weak pt-1.5 text-xs text-text-secondary group-hover:flex">
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">代码</span>
                <span class="font-mono">{{ item.code }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">龙虎榜净买额</span>
                <span
                  class="font-medium"
                  :class="(item.netBuyAmount ?? 0) >= 0 ? 'text-up' : 'text-down'"
                >
                  {{ formatYuanWithSign(item.netBuyAmount) }}
                </span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">净买占比</span>
                <span>{{ formatPercent(item.netBuyRatio) }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">上榜原因</span>
                <span class="min-w-0 truncate text-left">{{ item.reason || '--' }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">上榜日期</span>
                <span>{{ item.date }}</span>
              </div>
            </div>
          </div>
          <p
            v-if="dragonItems.length === 0"
            class="px-2 py-6 text-center text-xs leading-5 text-text-tertiary"
          >
            {{ isDragonLoading ? '龙虎榜加载中…' : dragonError ? '加载失败，请稍后重试' : '暂无数据' }}
          </p>
        </template>

        <!-- 大宗交易：名称 / 成交价 / 涨跌幅 -->
        <template v-else-if="tab.value === 'block-trade'">
          <div
            v-for="item in blockRows"
            :key="`${item.date}-${item.code}-${item.dealPrice}`"
            class="group cursor-pointer rounded-xl border border-flat-weak bg-flat-weak/40 p-2 transition-colors hover:bg-flat-weak"
            @click="openDetail(item.code)"
          >
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-text">
                {{ item.name }}
              </span>
              <span class="shrink-0 text-sm font-medium tabular-nums text-text-secondary">
                {{ formatPrice(item.dealPrice) }}
              </span>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="TREND_PILL_CLASS[trendOf(item.changePercent)]"
              >
                {{ formatPercent(item.changePercent) }}
              </span>
            </div>
            <div class="hidden flex-col gap-0.5 border-t border-flat-weak pt-1.5 text-xs text-text-secondary group-hover:flex">
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">代码</span>
                <span class="font-mono">{{ item.code }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">成交额</span>
                <span>{{ formatYuanWithSign(item.dealAmount) }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">溢价率</span>
                <span>{{ formatPercent(item.premiumRate) }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">买方营业部</span>
                <span class="min-w-0 truncate text-left">{{ item.buyBranch || '--' }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-tertiary">交易日期</span>
                <span>{{ item.date }}</span>
              </div>
            </div>
          </div>
          <p
            v-if="blockItems.length === 0"
            class="px-2 py-6 text-center text-xs leading-5 text-text-tertiary"
          >
            {{ isBlockLoading ? '大宗交易加载中…' : blockError ? '加载失败，请稍后重试' : '暂无数据' }}
          </p>
        </template>
      </div>
    </BaseCard>
  </div>
</template>
