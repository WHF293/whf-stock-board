<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BaseTable from '../components/ui/BaseTable.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import TabConfigButton from '../components/ui/TabConfigButton.vue';
import MarketEventView from './MarketEventView.vue';
import DragonTigerView from './DragonTigerView.vue';
import { useTabConfig } from '../composables/use-tab-config';
import type { TableColumn } from '../types/table.types';
import { sdk } from '../api/sdk';
import { usePolling } from '../composables/use-polling';
import { useDataCacheStore } from '../stores/data-cache';
import { useSettingsStore } from '../stores/settings';
import { useNotificationsStore } from '../stores/notifications';
import { useTabConfigStore } from '../stores/tab-config';
import { useStockOpen } from '../composables/use-stock-open';
import { requestAgentAnalysis } from '../agent/agent-bridge';
import { buildRankAnalysisPrompt } from '../utils/build-rank-analysis-prompt';
import { exportSheetsToExcel } from '../utils/export-excel';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants';
import { HOST_HEADER_ITEM } from '../constants/header.constants';
import { NOTIFY_TONE } from '../constants/notify.constants';
import { POLLING_INTERVAL } from '../constants/polling.constants';
import type { RankDataset } from '../types/rank-dataset.types';
import { fetchFundFlowRank } from '../api/flow.api';
import { getTrendByChangePercent } from '../constants/trend.constants';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../constants/stock-colors.constants';
import { formatAmount } from '../utils/format-amount';
import { formatPercent, formatPercentUnsigned } from '../utils/format-percent';
import { formatPrice } from '../utils/format-price';
import { formatVolume } from '../utils/format-volume';
import { formatYuanWithSign } from '../utils/format-yuan';
import type { FullQuote } from '../types/stock-quote.types';
import type { FundFlowRankItem } from '../types/flow.types';
import { delay } from '../utils/delay';

/**
 * 市场榜单（原「市场异动」页已并入为页签）：
 * 个股主力资金榜 → 涨停 / 异动 / 龙虎榜 / 大宗交易（自管数据，重接口不轮询）
 * → 全 A 报价排序榜（涨跌幅 / 成交额 / 换手率）。
 * 板块维度的资金流向（板块净流入 / 行业资金曲线）已在「行情全景-板块资金」模块。
 *
 * 报价排序榜数据源 stock-sdk `getAllAShareQuotes`（上游东方财富 push2，代理通道）：
 * 一次拉取全市场报价（约 5k+ 只），前端按 sortKey 排序展示前 N 条，
 * 默认轮询 30 秒（与市场宽度一致）；行点击打开右侧个股详情
 */
const { openSidebar, openPage, toContextList } = useStockOpen();

/** 资金流表上下文列表（双击进详情页时整批带入） */
const flowContextList = computed(() =>
  toContextList(currentFlowItems.value, (row) => String(row.code)),
);
const dataCache = useDataCacheStore();

/** 列表展示条数（Top N） */
const DISPLAY_COUNT = 100;

  /**
   * 页签：个股主力资金榜 → 涨停 / 异动 / 龙虎榜 / 大宗交易（原「市场异动」页并入）
   * → 全 A 报价排序榜（自管数据；北向持股已下线——上游长期无数据，
   * 接口仍保留给 Agent MCP 工具；板块净流入已迁至「行情全景-板块资金」）
   */
const SORT_TAB_OPTIONS = [
  { label: '个股主力', value: 'stock' },
  { label: '涨停', value: 'event' },
  { label: '异动', value: 'events' },
  { label: '龙虎榜', value: 'dragon-tiger' },
  { label: '大宗交易', value: 'block-trade' },
  { label: '涨幅榜', value: 'changePercent' },
  { label: '跌幅榜', value: 'changePercentDesc' },
  { label: '成交额榜', value: 'amount' },
  { label: '换手率榜', value: 'turnoverRate' },
] as const;

/** 原市场异动页并入的四个页签值（页签配置迁移用） */
const MOOD_TAB_VALUES: readonly string[] = [
  'event',
  'events',
  'dragon-tiger',
  'block-trade',
];

// 旧「市场异动」页（market-mood）的页签自定义并入本页（一次性迁移；
// 旧键保留不清理，读取侧永远走 market-rank，无害）
const tabConfigStore = useTabConfigStore();
const moodStored = tabConfigStore.configs['market-mood'];
if (moodStored) {
  const rankStored = tabConfigStore.configs['market-rank'];
  const moodOrder = moodStored.order.filter((value) => MOOD_TAB_VALUES.includes(value));
  const moodHidden = moodStored.hidden.filter((value) => MOOD_TAB_VALUES.includes(value));
  const rankOrder = (rankStored?.order ?? []).filter((value) => !MOOD_TAB_VALUES.includes(value));
  const rankHidden = (rankStored?.hidden ?? []).filter((value) => !MOOD_TAB_VALUES.includes(value));
  tabConfigStore.setConfig('market-rank', {
    order: [...rankOrder, ...moodOrder],
    hidden: [...rankHidden, ...moodHidden],
  });
}

/** 页签值 */
type RankTab = (typeof SORT_TAB_OPTIONS)[number]['value'];

// 页签显隐 + 顺序可配置（持久化）；激活值被隐藏时自动回退首个可见 tab
const { visibleOptions: sortTabOptions, activeValue: sortKey } = useTabConfig<RankTab>(
  'market-rank',
  SORT_TAB_OPTIONS,
);

/** 是否为资金流榜单类页签（个股主力） */
const isFlowTab = computed(() => sortKey.value === 'stock');

/** 是否为原「市场异动」类页签（涨停 / 异动 / 龙虎榜 / 大宗；自管数据，重接口不轮询） */
const isMoodTab = computed(() =>
  sortKey.value === 'event' ||
  sortKey.value === 'events' ||
  sortKey.value === 'dragon-tiger' ||
  sortKey.value === 'block-trade',
);

/** 龙虎榜受控页签（大宗交易复用同一视图组件，切换时隐藏其龙虎榜子页） */
const dragonTab = computed<'dragon-tiger' | 'block-trade'>(() =>
  sortKey.value === 'block-trade' ? 'block-trade' : 'dragon-tiger',
);

// 快照播种
const allQuotes = ref<FullQuote[]>(
  dataCache.get<FullQuote[]>(DATA_CACHE_KEY.MARKET_RANK_QUOTES) ?? [],
);
const isLoading = ref(allQuotes.value.length === 0);
const isError = ref(false);

/** 拉取全市场行情（轮询调用） */
const fetchAll = async (): Promise<void> => {
  try {
    const quotes = await sdk.batch.cn();
    allQuotes.value = quotes;
    dataCache.set(DATA_CACHE_KEY.MARKET_RANK_QUOTES, quotes);
    isError.value = false;
  } catch (error) {
    isError.value = allQuotes.value.length === 0;
    console.error('[market-rank]', error);
  } finally {
    isLoading.value = false;
  }
};

void fetchAll();

usePolling({
  task: fetchAll,
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

// ---------- 个股主力资金榜（自管数据，进页签拉一次） ----------
/** 各接口请求间隔（毫秒）：对同一上游串行错峰 */
const FLOW_REQUEST_GAP_MS = 500;

/** 表格展示条数 */
const RANK_DISPLAY_COUNT = 15;

const stockRank = ref<FundFlowRankItem[]>(
  dataCache.get<FundFlowRankItem[]>(DATA_CACHE_KEY.FUNDS_STOCK_RANK) ?? [],
);
const isFlowLoading = ref(false);
const flowError = ref(false);

/**
 * 拉取个股主力资金榜（成功写快照；进行中调用共享同一任务防重入）
 */
let flowRanksTask: Promise<void> | null = null;
const loadFlowRanks = (): Promise<void> => {
  if (!flowRanksTask) {
    flowRanksTask = (async () => {
      isFlowLoading.value = true;
      flowError.value = false;
      try {
        stockRank.value = await fetchFundFlowRank();
        dataCache.set(DATA_CACHE_KEY.FUNDS_STOCK_RANK, stockRank.value);
      } catch (error) {
        flowError.value = stockRank.value.length === 0;
        console.error('[market-rank] flow', error);
      } finally {
        isFlowLoading.value = false;
      }
    })().finally(() => {
      flowRanksTask = null;
    });
  }
  return flowRanksTask;
};

// 首次切到个股主力页签时拉取（快照已有数据则跳过；重复触发由共享任务防重入）
watch(isFlowTab, (active) => {
  if (active && stockRank.value.length === 0) {
    void loadFlowRanks();
  }
});
void (async () => {
  // 首屏即处于个股主力页签（如路由记忆）时补拉
  await delay(FLOW_REQUEST_GAP_MS);
  if (isFlowTab.value && stockRank.value.length === 0) {
    void loadFlowRanks();
  }
})();

/**
 * 当前排序维度的可比数值（null 视为 -Infinity 排到末尾）
 * @param quote 个股报价
 * @returns 用于比较的数值
 */
const sortValueOf = (quote: FullQuote): number => {
  switch (sortKey.value) {
    case 'changePercent':
    case 'changePercentDesc':
      return quote.changePercent ?? 0;
    case 'amount':
      return quote.amount ?? 0;
    case 'turnoverRate':
      return quote.turnoverRate ?? 0;
    default:
      return 0;
  }
};

/** 按当前排序维度取前 N 条；涨跌幅榜按降序，跌幅榜按升序，其余按降序 */
const displayedRows = computed<FullQuote[]>(() => {
  const arr = [...allQuotes.value];
  const isDesc =
    sortKey.value === 'changePercent' ||
    sortKey.value === 'amount' ||
    sortKey.value === 'turnoverRate';
  arr.sort((a, b) => {
    const va = sortValueOf(a);
    const vb = sortValueOf(b);
    if (isDesc) return vb - va;
    return va - vb;
  });
  return arr.slice(0, DISPLAY_COUNT);
});

/** 当前资金流榜单数据（个股主力） */
const currentFlowItems = computed<FlowRow[]>(() => stockRank.value);

/** 当前资金流榜单列配置（行对象按联合类型宽松消费） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlowRow = any;

const currentFlowColumns = computed<TableColumn<FlowRow>[]>(() => stockColumns);

/** 表格列（按当前排序维度动态决定涨跌着色） */
const columns = computed<TableColumn<FullQuote>[]>(() => {
  return [
    { key: 'name', label: '个股' },
    {
      key: 'price',
      label: '最新价',
      align: 'right',
      sortable: false,
    },
    {
      key: 'changePercent',
      label: sortKey.value === 'changePercentDesc' ? '涨跌幅 ↓' : '涨跌幅',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.changePercent,
    },
    {
      key: 'change',
      label: '涨跌额',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.change,
    },
    {
      key: 'volume',
      label: '成交量',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.volume,
    },
    {
      key: 'amount',
      label: '成交额',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.amount,
    },
    {
      key: 'turnoverRate',
      label: '换手率',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.turnoverRate,
    },
    { key: 'volumeRatio', label: '量比', align: 'right' },
    { key: 'pe', label: '市盈率', align: 'right' },
  ];
});

/** 个股主力排名列配置 */
const stockColumns: TableColumn<FundFlowRankItem>[] = [
  { key: 'name', label: '个股' },
  { key: 'price', label: '现价', align: 'right' },
  {
    key: 'mainNetInflow',
    label: '主力净流入',
    sortable: true,
    sortValue: (stock) => stock.mainNetInflow,
  },
];

/**
 * 个股代码跳详情（6 位纯代码 -> 完整符号）
 * @param code 个股 6 位代码
 */
const openDetail = (code: string): void => {
  openSidebar(code);
};

// ---------- 榜单工具条：AI 分析 + 导出 Excel（所有页签共用，数据取当前页签榜单） ----------
const settingsStore = useSettingsStore();
const notifications = useNotificationsStore();

/** 涨停 / 异动子视图（数据在其组件内，按钮点击时经 expose 方法获取） */
const eventViewRef = ref<InstanceType<typeof MarketEventView> | null>(null);
/** 龙虎榜 / 大宗子视图（同上） */
const dragonViewRef = ref<InstanceType<typeof DragonTigerView> | null>(null);

/** 「AI 分析」入口跟随顶栏「Agent 分析」条目的显隐开关（设置 → 布局编排 → 右上角工具编排） */
const agentEntryVisible = computed(
  () => !settingsStore.hiddenHeaderItems.includes(HOST_HEADER_ITEM.AGENT),
);

/** 当前页签的榜单类型名（AI 分析提示词与导出文件名共用） */
const currentRankLabel = computed(
  () => SORT_TAB_OPTIONS.find((option) => option.value === sortKey.value)?.label ?? '市场榜单',
);

/** 报价排序榜导出列（表格列 + 代码；成交额单位万 / 成交量单位手，导出与 AI 分析共用） */
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

/** 个股主力榜导出列（表格列 + 代码 / 涨跌幅 / 净占比） */
const stockExportColumns: { label: string; key: string }[] = [
  { key: 'name', label: '个股' },
  { key: 'code', label: '代码' },
  { key: 'price', label: '现价' },
  { key: 'changePercent', label: '涨跌幅(%)' },
  { key: 'mainNetInflow', label: '主力净流入(元)' },
  { key: 'mainNetInflowPercent', label: '主力净占比(%)' },
];

/**
 * 汇总当前页签的榜单数据段（AI 分析与导出 Excel 共用的数据出口）。
 * 涨停 / 异动 / 龙虎榜 / 大宗四页签的数据在子视图组件内，经 expose 方法获取
 * @returns 数据段列表；子视图未挂载 / 尚无数据时为空数组
 */
const collectRankDatasets = (): RankDataset[] => {
  switch (sortKey.value) {
    case 'stock':
      return [
        {
          title: currentRankLabel.value,
          columns: stockExportColumns,
          rows: stockRank.value as unknown as Record<string, unknown>[],
        },
      ];
    case 'event':
    case 'events':
      return eventViewRef.value?.getRankDatasets() ?? [];
    case 'dragon-tiger':
    case 'block-trade':
      return dragonViewRef.value?.getRankDatasets() ?? [];
    default:
      return [
        {
          title: currentRankLabel.value,
          columns: quoteExportColumns,
          rows: displayedRows.value as unknown as Record<string, unknown>[],
        },
      ];
  }
};

/**
 * 导出文件名时间戳
 * @returns YYYYMMDD-HHmm 格式时间戳
 */
const exportStamp = (): string => {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  );
};

/** 「AI 分析」：把当前页签榜单数据 + 榜单类型交给 Agent 分析 */
const onRankAiAnalysis = (): void => {
  const prompt = buildRankAnalysisPrompt(currentRankLabel.value, collectRankDatasets());
  if (prompt === '') {
    notifications.push({
      title: '暂无可分析的榜单数据',
      body: '请等待当前榜单数据加载完成后再发起 AI 分析',
      tone: NOTIFY_TONE.FLAT,
    });
    return;
  }
  void requestAgentAnalysis(prompt);
};

/** 「导出 Excel」：把当前页签榜单数据导出为 .xlsx（多数据段 = 多工作表） */
const onRankExport = async (): Promise<void> => {
  const datasets = collectRankDatasets();
  if (datasets.every((dataset) => dataset.rows.length === 0)) {
    notifications.push({
      title: '暂无可导出的榜单数据',
      body: '请等待当前榜单数据加载完成后再导出',
      tone: NOTIFY_TONE.FLAT,
    });
    return;
  }
  try {
    await exportSheetsToExcel(
      datasets.map((dataset) => ({
        name: dataset.title,
        rows: dataset.rows,
        columns: dataset.columns,
      })),
      `市场榜单-${currentRankLabel.value}-${exportStamp()}`,
    );
  } catch (error) {
    console.error('[market-rank] export', error);
    notifications.push({
      title: '导出失败',
      body: '榜单数据导出 Excel 失败，请稍后重试',
      tone: NOTIFY_TONE.FLAT,
    });
  }
};

</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] min-h-0 flex-col gap-4">
    <!-- 排序维度切换（与行情全景一致的 underline 风格） -->
    <div class="flex shrink-0 items-center gap-1">
      <BaseTabs v-model="sortKey" :options="sortTabOptions" variant="underline" />
      <TabConfigButton page-id="market-rank" :options="SORT_TAB_OPTIONS" />
    </div>

    <!-- 榜单工具条：AI 分析 + 导出 Excel -->
    <div class="flex shrink-0 items-center justify-end gap-2">
      <BaseButton v-if="agentEntryVisible" variant="ghost" @click="onRankAiAnalysis">
        <MenuIcon name="agent" :size="14" />
        AI 分析
      </BaseButton>
      <BaseButton variant="ghost" @click="onRankExport">
        <MenuIcon name="export" :size="14" />
        导出 Excel
      </BaseButton>
    </div>

    <!-- 原市场异动页签：涨停 / 异动 / 龙虎榜 / 大宗交易（自管数据，重接口不轮询） -->
    <MarketEventView v-if="sortKey === 'event'" ref="eventViewRef" mode="zt" class="min-h-0 flex-1" />
    <MarketEventView v-else-if="sortKey === 'events'" ref="eventViewRef" mode="events" class="min-h-0 flex-1" />
    <DragonTigerView v-else-if="isMoodTab" ref="dragonViewRef" v-model="dragonTab" class="min-h-0 flex-1" />

    <!-- 个股主力资金榜 -->
    <BaseCard v-else-if="isFlowTab" fill class="min-h-0 flex-1">
      <div v-if="isFlowLoading && currentFlowItems.length === 0"><BaseSkeleton /></div>
      <div v-else-if="flowError && currentFlowItems.length === 0" class="py-10">
        <BaseEmpty text="资金流榜单加载失败，请稍后重试" />
      </div>
      <BaseTable
        v-else-if="currentFlowItems.length > 0"
        :columns="currentFlowColumns"
        :rows="currentFlowItems.slice(0, RANK_DISPLAY_COUNT)"
        :row-key="(row: FlowRow) => String(row.code)"
        min-width="720px"
        scroll-class="table-scroll-fill"
        row-clickable
        :enable-dblclick-nav="true"
        @row-click="(row: FlowRow) => openDetail(String(row.code))"
        @row-dblclick="(row: FlowRow) => openPage(String(row.code), flowContextList)"
      >
        <template #name="{ row }: { row: FlowRow }">
          <span class="font-medium text-text">{{ row.name }}</span>
          <span v-if="row.code" class="ml-1 text-xs text-text-tertiary">{{ row.code }}</span>
        </template>
        <template #price="{ row }: { row: FlowRow }">
          <span :class="TREND_TEXT_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]">
            {{ formatPrice(row.price) }}
          </span>
        </template>
        <template #changePercent="{ row }: { row: FlowRow }">
          <span
            class="rounded-full px-2 py-0.5 font-semibold"
            :class="TREND_PILL_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]"
          >
            {{ formatPercent(row.changePercent) }}
          </span>
        </template>
        <template #mainNetInflow="{ row }: { row: FlowRow }">
          <span
            class="font-medium"
            :class="(row.mainNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'"
          >
            {{ formatYuanWithSign(row.mainNetInflow) }}
          </span>
        </template>
      </BaseTable>
      <BaseEmpty v-else text="暂无数据" />
    </BaseCard>

    <!-- 报价排序榜 -->
    <BaseCard v-else fill class="min-h-0 flex-1">
      <div v-if="isLoading && allQuotes.length === 0"><BaseSkeleton /></div>
      <div v-else-if="isError && allQuotes.length === 0" class="py-10">
        <BaseEmpty text="市场榜单加载失败，请稍后重试（上游可能限频或封禁）" />
      </div>
      <BaseTable
        v-else-if="displayedRows.length > 0"
        :columns="columns"
        :rows="displayedRows"
        :row-key="(row) => row.code"
        min-width="900px"
        scroll-class="table-scroll-fill"
        row-clickable
        @row-click="(row) => openDetail(row.code)"
        :enable-dblclick-nav="true"
        @row-dblclick="(row) => openPage(row.code, toContextList(displayedRows, (item) => item.code))"
      >
        <template #name="{ row }">
          <span class="font-medium text-text">{{ row.name }}</span>
          <span class="ml-1 text-xs text-text-tertiary">{{ row.code }}</span>
        </template>
        <template #price="{ row }">
          <span
            class="tabular-nums"
            :class="TREND_TEXT_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]"
          >
            {{ formatPrice(row.price) }}
          </span>
        </template>
        <template #changePercent="{ row }">
          <span
            class="rounded-full px-2 py-0.5 text-xs font-semibold"
            :class="TREND_PILL_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]"
          >
            {{ formatPercent(row.changePercent) }}
          </span>
        </template>
        <template #change="{ row }">
          <span
            class="tabular-nums"
            :class="(row.change ?? 0) >= 0 ? 'text-up' : 'text-down'"
          >
            {{ row.change > 0 ? '+' : '' }}{{ formatPrice(row.change) }}
          </span>
        </template>
        <template #volume="{ row }">
          <span class="tabular-nums text-text-secondary">{{ formatVolume(row.volume) }}</span>
        </template>
        <template #amount="{ row }">
          <span class="tabular-nums text-text-secondary">{{ formatAmount(row.amount) }}</span>
        </template>
        <template #turnoverRate="{ row }">
          <span class="tabular-nums text-text-secondary">{{ formatPercentUnsigned(row.turnoverRate) }}</span>
        </template>
        <template #volumeRatio="{ row }">
          <span class="tabular-nums text-text-secondary">
            {{ row.volumeRatio === null ? '--' : row.volumeRatio.toFixed(2) }}
          </span>
        </template>
        <template #pe="{ row }">
          <span class="tabular-nums text-text-secondary">
            {{ row.pe === null ? '--' : row.pe.toFixed(2) }}
          </span>
        </template>
      </BaseTable>
      <BaseEmpty v-else text="暂无数据" />
    </BaseCard>
  </div>
</template>
