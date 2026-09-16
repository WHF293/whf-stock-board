<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BaseTable from '../components/ui/BaseTable.vue';
import DistributionChart from '../components/charts/DistributionChart.vue';
import HeatmapChart from '../components/charts/HeatmapChart.vue';
import HeatmapBoardList from '../components/business/HeatmapBoardList.vue';
import MarketFundFlowTrendChart from '../components/charts/MarketFundFlowTrendChart.vue';
import TurnoverTrendChart from '../components/charts/TurnoverTrendChart.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import StockQuoteCard from '../components/business/StockQuoteCard.vue';
import {
  fetchAllMarketQuotes,
  fetchFullQuotes,
} from '../api/quotes.api';
import { fetchGlobalIndexQuotes } from '../api/panorama.api';
import { fetchIndustryBoards } from '../api/board.api';
import { fetchMarketFundFlow } from '../api/flow.api';
import { fetchMarketTurnover } from '../api/turnover.api';
import { usePolling } from '../composables/use-polling';
import {
  INDEX_SYMBOLS,
} from '../constants/index-symbols.constants';
import {
  HEATMAP_TOP_TAB_OPTIONS,
  HEATMAP_VIEW_MODE,
  HEATMAP_VIEW_MODE_OPTIONS,
} from '../constants/heatmap.constants';
import { YUAN_PER_YI } from '../constants/format.constants';
import {
  TURNOVER_RANGE_DEFAULT,
  TURNOVER_RANGE_TAB_OPTIONS,
  type TurnoverRange,
} from '../constants/turnover.constants';
import { POLLING_INTERVAL } from '../constants/polling.constants';
import { PANORAMA_GLOBAL_INDEX_SECIDS } from '../constants/panorama.constants';
import { useHeatmapDrill } from '../composables/use-heatmap-drill';
import { useRowClamp } from '../composables/use-row-clamp';
import { useStockOpen } from '../composables/use-stock-open';
import type { DistributionCount } from '../types/distribution.types';
import type { GlobalIndexQuote } from '../types/panorama.types';
import type {
  HeatmapBoard,
  IndustryBoard,
} from '../types/board.types';
import type { MarketFundFlow } from '../types/flow.types';
import type { TurnoverDayItem } from '../types/turnover.types';
import type { TurnoverTableRow } from '../constants/turnover.constants';
import type { TableColumn } from '../types/table.types';
import type { FullQuote } from '../types/stock-quote.types';
import { formatPercent } from '../utils/format-percent';
import { formatAmount } from '../utils/format-amount';
import { formatYuanWithSign } from '../utils/format-yuan';
import { formatTurnoverChange } from '../utils/format-turnover-change';
import { countDistribution } from '../utils/count-distribution';
import { delay } from '../utils/delay';
import { useSettingsStore } from '../stores/settings';
import { useDataCacheStore } from '../stores/data-cache';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants';

/** 市场宽度各接口请求间隔（毫秒）：对同一上游串行错峰 */
const BREADTH_REQUEST_GAP_MS = 500;

/** 大盘资金流保留的交易日数（近 10 日） */
const MARKET_FLOW_DAYS = 10;

/** 大盘资金流视图高度（像素）：与涨跌分布图表等高，保证同排两卡视觉一致 */
const MARKET_FLOW_VIEW_HEIGHT_PX = 220;

/** 展示形式：图表（默认） / 列表（涨跌分布与大盘资金流共用同一组值） */
const VIEW_MODE = {
  CHART: 'chart',
  TABLE: 'table',
} as const;

/** 展示形式按钮组选项 */
const VIEW_MODE_OPTIONS = [
  { label: '图表', value: VIEW_MODE.CHART },
  { label: '列表', value: VIEW_MODE.TABLE },
] as const;

/** 涨跌分布当前展示形式（局部状态，不持久化） */
const distributionViewMode = ref<typeof VIEW_MODE[keyof typeof VIEW_MODE]>(VIEW_MODE.CHART);

/** 大盘资金流当前展示形式（局部状态，不持久化） */
const marketViewMode = ref<typeof VIEW_MODE[keyof typeof VIEW_MODE]>(VIEW_MODE.CHART);

/**
 * 市场总览：指数卡片（轮询，点击跳 K 线详情）+ 全部指数一次渲染、收起只看首行（见 useRowClamp）+
 * 涨跌分布 / 资金速览 + 板块热力（轮询，支持热力图 / 列表两种展示形式，
 * 下钻状态两视图共享；点击下钻成分股 → 点击个股跳详情）
 *
 * 数据先取内存快照秒出 UI，接口成功后写回快照并刷新显示
 *
 * 注：北向净买额已从资金速览移除——上游实时与历史口径均已停止披露（NET_DEAL_AMT 恒 null）；
 * 板块名称不再点击打开右侧停靠面板（看成分股统一走行展开）
 */
const { openSidebar, openPage, toContextList } = useStockOpen();
const settingsStore = useSettingsStore();
const dataCache = useDataCacheStore();

// 板块下钻状态机：热力图 / 列表两视图共享，切换展示形式不丢下钻位置
const { drillView, drillTarget, isDrillLoading, drillError, drillInto, backToBoards } =
  useHeatmapDrill();

/** Top 数量按钮组 v-model 适配：BaseTabs 要求字符串 value，设置项存 number */
const heatmapTopNModel = computed<string>({
  get: () => String(settingsStore.heatmapTopN),
  set: (value) => settingsStore.setHeatmapTopN(Number(value)),
});

/** 指数报价（快照播种） */
const indexQuotes = ref<FullQuote[]>([]);

/** 涨跌分布分桶计数 */
const distribution = ref<DistributionCount[]>([]);
/** 行业板块列表 */
const industryBoards = ref<IndustryBoard[]>([]);
/** 当日大盘资金流（取最新一条） */
const marketFundFlow = ref<MarketFundFlow | null>(null);
/** 大盘资金流历史（近 10 日，升序；供曲线 / 列表） */
const marketFlowHistory = ref<MarketFundFlow[]>([]);
/** 两市成交额合计（万） */
const totalAmountWan = ref<number | null>(null);

/** 市场宽度快照结构 */
interface BreadthSnapshot {
  distribution: DistributionCount[];
  totalAmountWan: number;
  boards: IndustryBoard[];
  fundFlow: MarketFundFlow | null;
  flowHistory: MarketFundFlow[];
}

// 快照播种：切换回本页先展示上次数据
const cachedIndex = dataCache.get<FullQuote[]>(DATA_CACHE_KEY.DASHBOARD_INDEX_QUOTES);
if (cachedIndex) {
  indexQuotes.value = cachedIndex;
}
const cachedBreadth = dataCache.get<BreadthSnapshot>(DATA_CACHE_KEY.DASHBOARD_BREADTH);
if (cachedBreadth) {
  distribution.value = cachedBreadth.distribution;
  totalAmountWan.value = cachedBreadth.totalAmountWan;
  industryBoards.value = cachedBreadth.boards;
  marketFundFlow.value = cachedBreadth.fundFlow;
  marketFlowHistory.value = cachedBreadth.flowHistory ?? [];
}

/** 拉取指数行情（成功后写快照） */
const fetchIndexQuotes = async (): Promise<void> => {
  indexQuotes.value = await fetchFullQuotes(INDEX_SYMBOLS);
  dataCache.set(DATA_CACHE_KEY.DASHBOARD_INDEX_QUOTES, indexQuotes.value);
};

// ---------- 全球指数（恒生 / 道琼斯 / 纳斯达克 / 标普500 / 日经225 / KOSPI） ----------

/**
 * 全球指数与主指数同处一个栅格，且**始终全部渲染**：收起态不是「不渲染」，
 * 而是由容器裁掉首行以外的部分（见 `useRowClamp`）。
 *
 * 这样做的好处：「一行显示几张」纯由可用宽度决定，窄屏被裁掉的卡片点一下
 * 展开开关即出现；若按展开与否增删卡片，栅格列数会在切换瞬间跳变（卡片换行）。
 *
 * 数据走东财全球指数 ulist（腾讯源不覆盖日经 225 / KOSPI）；
 * 属轻量行情，挂载即拉取并跟随轮询，不再等「首次展开」。
 */

/** 全球指数轻量报价 */
const globalIndexQuotes = ref<GlobalIndexQuote[]>([]);

/** 尚未返回的卡片占位骨架数（与真实卡片同规格，保持栅格列宽 / 行高稳定） */
const indexSkeletonCount = computed<number>(
  () =>
    Math.max(0, INDEX_SYMBOLS.length - indexQuotes.value.length) +
    Math.max(0, PANORAMA_GLOBAL_INDEX_SECIDS.length - globalIndexQuotes.value.length),
);

/** 刷新全球指数报价 */
const refreshGlobalIndexQuotes = async (): Promise<void> => {
  globalIndexQuotes.value = await fetchGlobalIndexQuotes();
};

usePolling({
  task: refreshGlobalIndexQuotes,
  intervalMs: POLLING_INTERVAL.QUOTES_INTRADAY,
});

// ---------- 顶部指数卡片：收起只看首行，展开看全部（高度过渡动画） ----------

const {
  setGridRef: setIndexGridRef,
  isExpanded: isIndexExpanded,
  hasOverflow: hasIndexOverflow,
  clampStyle,
  toggle: toggleIndexExpanded,
} = useRowClamp();

/** 市场宽度首载是否失败（且无快照）——供资金流卡片空态展示 */
const isBreadthError = ref(false);

/** 拉取市场宽度数据（全市场快照 + 板块 + 资金流；成功后写快照） */
const fetchMarketBreadth = async (): Promise<void> => {
  try {
    // 对同一上游（东财系）串行错峰请求，避免并发齐射触发反爬封禁
    const quotes = await fetchAllMarketQuotes();
    await delay(BREADTH_REQUEST_GAP_MS);
    const boards = await fetchIndustryBoards();
    await delay(BREADTH_REQUEST_GAP_MS);
    const flows = await fetchMarketFundFlow();

  distribution.value = countDistribution(quotes.map((quote) => quote.changePercent));
  totalAmountWan.value = quotes.reduce((acc, quote) => acc + (quote.amount ?? 0), 0);
  industryBoards.value = boards;
  marketFundFlow.value = flows.at(-1) ?? null;
  marketFlowHistory.value = flows.slice(-MARKET_FLOW_DAYS);

    const snapshot: BreadthSnapshot = {
      distribution: distribution.value,
      totalAmountWan: totalAmountWan.value,
      boards: industryBoards.value,
      fundFlow: marketFundFlow.value,
      flowHistory: marketFlowHistory.value,
    };
    dataCache.set(DATA_CACHE_KEY.DASHBOARD_BREADTH, snapshot);
  } catch (error) {
    isBreadthError.value = marketFlowHistory.value.length === 0;
    console.error('[dashboard] breadth', error);
  }
};

usePolling({
  task: fetchIndexQuotes,
  intervalMs: POLLING_INTERVAL.QUOTES_INTRADAY,
  tradingAware: true,
});
usePolling({
  task: fetchMarketBreadth,
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

// ---------- 成交额变化（沪深两市总成交额，挂载拉取一次，不轮询） ----------

/** 两市总成交额历史（近一年日 K，升序；30/60/180 交易日窗口本地切片） */
const turnoverHistory = ref<TurnoverDayItem[]>([]);

/** 成交额首载是否失败（且无快照）——供卡片空态展示 */
const isTurnoverError = ref(false);

/** 成交额当前展示形式（局部状态，不持久化） */
const turnoverViewMode = ref<typeof VIEW_MODE[keyof typeof VIEW_MODE]>(VIEW_MODE.CHART);

/** 成交额当前交易日窗口 */
const turnoverRange = ref<TurnoverRange>(TURNOVER_RANGE_DEFAULT);

/** 交易日窗口按钮组 v-model 适配：BaseTabs 要求字符串 value，窗口存 number */
const turnoverRangeModel = computed<string>({
  get: () => String(turnoverRange.value),
  set: (value) => {
    turnoverRange.value = Number(value) as TurnoverRange;
  },
});

// 快照播种：切换回本页先展示上次数据
// 校验字段口径——历史版本快照用 totalVolume 等旧字段名，直接播种会让图表拿到
// undefined 画出空白曲线、且掩盖后续请求失败（必须丢弃）
const cachedTurnover = dataCache.get<TurnoverDayItem[]>(DATA_CACHE_KEY.DASHBOARD_TURNOVER);
if (cachedTurnover?.length && typeof cachedTurnover[0].totalAmount === 'number') {
  turnoverHistory.value = cachedTurnover;
}

/** 拉取两市总成交额历史（挂载一次；成功后写快照） */
const fetchTurnoverHistory = async (): Promise<void> => {
  try {
    turnoverHistory.value = await fetchMarketTurnover();
    dataCache.set(DATA_CACHE_KEY.DASHBOARD_TURNOVER, turnoverHistory.value);
  } catch (error) {
    isTurnoverError.value = turnoverHistory.value.length === 0;
    console.error('[dashboard] turnover', error);
  }
};

// KeepAlive 下仅首次挂载拉取；历史数据不变性强，无需轮询
onMounted(() => {
  void fetchTurnoverHistory();
});

/** 当前窗口内的成交额序列（升序，供折线图） */
const turnoverRows = computed(() =>
  turnoverHistory.value.slice(-turnoverRange.value),
);

/** 当前窗口内的成交额表格行（升序算较上日变化，再倒序展示 + 亿元换算） */
const turnoverTableRows = computed<TurnoverTableRow[]>(() => {
  const asc = turnoverRows.value;
  const rows = asc.map((day, i) => {
    const prev = i > 0 ? asc[i - 1].totalAmount : null;
    let changeAmount: number | null = null;
    let changePct: number | null = null;
    if (prev !== null) {
      changeAmount = day.totalAmount - prev;
      changePct = prev !== 0 ? (changeAmount / prev) * 100 : null;
    }
    return {
      ...day,
      totalAmountYi: (day.totalAmount / YUAN_PER_YI).toFixed(2),
      shanghaiAmountYi: (day.shanghaiAmount / YUAN_PER_YI).toFixed(2),
      shenzhenAmountYi: (day.shenzhenAmount / YUAN_PER_YI).toFixed(2),
      changePct,
      changeText: formatTurnoverChange(changeAmount, changePct),
    };
  });
  return rows.reverse();
});

/** 成交额列配置（排序用原始元值，展示用亿元字段；较上日按变化率排序、用同名插槽渲染放量/缩量文案） */
const turnoverColumns: TableColumn<TurnoverTableRow>[] = [
  { key: 'date', label: '日期' },
  {
    key: 'totalAmountYi',
    label: '总成交额(亿)',
    align: 'right',
    sortable: true,
    sortValue: (day) => day.totalAmount,
  },
  {
    key: 'changePct',
    label: '较上日',
    align: 'right',
    sortable: true,
    sortValue: (day) => day.changePct ?? -Infinity,
  },
  {
    key: 'shanghaiAmountYi',
    label: '上证(亿)',
    align: 'right',
    sortable: true,
    sortValue: (day) => day.shanghaiAmount,
  },
  {
    key: 'shenzhenAmountYi',
    label: '深证(亿)',
    align: 'right',
    sortable: true,
    sortValue: (day) => day.shenzhenAmount,
  },
];

/** 板块热力数据：按总市值排序取用户设置的 Top N（保留完整字段供列表视图消费） */
const topBoards = computed<IndustryBoard[]>(() =>
  [...industryBoards.value]
    .filter((board) => board.changePercent !== null && board.totalMarketCap !== null)
    .sort((a, b) => (b.totalMarketCap ?? 0) - (a.totalMarketCap ?? 0))
    .slice(0, settingsStore.heatmapTopN),
);

/** 热力图 cell 视图模型（由 topBoards 映射） */
const heatmapBoards = computed<HeatmapBoard[]>(() =>
  topBoards.value.map((board) => ({
    code: board.code,
    name: board.name,
    changePercent: board.changePercent ?? 0,
    weight: board.totalMarketCap ?? 0,
  })),
);

/**
 * 成分股热力图区块展示条件（热力图形式）
 *
 * 下钻中 / 已有成分股数据 / 拉取失败，三者任一即渲染该区块，
 * 使点击板块那一刻就有反馈（标题 + 骨架），而不是等数据回来才整块冒出
 */
const showConstituentSection = computed<boolean>(
  () =>
    settingsStore.heatmapViewMode === HEATMAP_VIEW_MODE.HEATMAP &&
    (isDrillLoading.value || drillView.value !== null || drillError.value !== null),
);

/** 成分股区块标题的板块名：拉取中用请求目标名兜底，避免加载中标题空白 */
const constituentBoardName = computed<string>(
  () => drillView.value?.board.name ?? drillTarget.value?.name ?? '',
);

/**
 * 点击指数卡跳 K 线详情
 *
 * ⚠️ 指数 FullQuote.code 为 6 位纯代码（如 000001），归一化后无法区分上证指数 /
 * 平安银行，故按 INDEX_SYMBOLS 下标还原完整符号（fetchFullQuotes 保持输入顺序）
 * @param index 指数在 INDEX_SYMBOLS 中的下标
 */
const onOpenIndexDetail = (index: number): void => {
  const symbol = INDEX_SYMBOLS[index];
  if (symbol) {
    openSidebar(symbol);
  }
};

/**
 * 指数卡片双击跳股票详情整页
 * @param index 指数在 INDEX_SYMBOLS 中的下标
 */
const onOpenIndexDblclick = (index: number): void => {
  const symbol = INDEX_SYMBOLS[index];
  if (symbol) {
    // 携带 4 个指数作为详情页左侧来源列表
    openPage(symbol, toContextList(indexQuotes.value, (quote) => quote.code));
  }
};

/**
 * 热力图成分股点击跳 K 线详情（6 位纯代码归一化带市场前缀）
 * @param code 成分股 6 位代码
 */
const onOpenHeatmapStock = (code: string): void => {
  openSidebar(code);
};

/** 涨跌分布列配置 */
const distributionColumns: TableColumn<DistributionCount>[] = [
  { key: 'label', label: '涨跌区间' },
  {
    key: 'count',
    label: '家数',
    align: 'right',
    sortable: true,
    sortValue: (bucket) => bucket.count,
  },
  { key: 'ratio', label: '占比', align: 'right' },
];

/** 涨跌分布总家数（占比分母） */
const distributionTotal = computed(() =>
  distribution.value.reduce((acc, bucket) => acc + bucket.count, 0),
);

/** 大盘资金流列配置 */
const marketColumns: TableColumn<MarketFundFlow>[] = [
  { key: 'date', label: '日期' },
  {
    key: 'mainNetInflow',
    label: '主力净流入',
    align: 'right',
    sortable: true,
    sortValue: (day) => day.mainNetInflow,
  },
  { key: 'mainNetInflowPercent', label: '主力占比', align: 'right' },
  { key: 'superLargeNetInflow', label: '超大单', align: 'right' },
  { key: 'largeNetInflow', label: '大单', align: 'right' },
  { key: 'smallNetInflow', label: '小单', align: 'right' },
];

/** 大盘近 10 日数据（倒序展示） */
const marketFlowRows = computed(() => [...marketFlowHistory.value].reverse());

/** 大盘近 10 日数据（升序，供折线图） */
const marketFlowAsc = computed(() => marketFlowHistory.value);

/** 涨跌分布是否就绪（首次加载完成） */
const isDistributionReady = computed(() => distribution.value.length > 0);
</script>

<template>
  <div class="space-y-6">
    <!--
      顶部指数卡片：主指数 + 全球指数共处**同一个栅格**，且一次性全部渲染（DOM 始终完整），
      收起态由 .row-clamp 把容器裁到「首行高度」——所以「一行显示几张」完全由可用宽度决定：
      容器只放得下 3 张时，第 4 张（科创50）就被裁掉，只有点 chevron 展开才可见；
      容器够宽（大屏 / 侧栏折叠）时首行能放下更多，甚至 10 张全部露出来。
      主区已开 @container，侧栏与右侧停靠面板的宽度变化同样实时响应。
    -->
    <div class="row-clamp" :style="clampStyle">
      <div :ref="setIndexGridRef" class="quote-card-grid">
        <StockQuoteCard
          v-for="(quote, index) in indexQuotes"
          :key="quote.code"
          :quote="quote"
          clickable
          @click="onOpenIndexDetail(index)"
          @dblclick="onOpenIndexDblclick(index)"
        />
        <StockQuoteCard
          v-for="quote in globalIndexQuotes"
          :key="quote.code"
          :quote="quote"
        />
        <BaseCard v-for="i in indexSkeletonCount" :key="'index-skeleton-' + i">
          <BaseSkeleton />
        </BaseCard>
      </div>
    </div>

    <!--
      展开 / 收起开关：只在首行之外**确实还有卡片**时出现
      （容器够宽、一行放下全部 → 无需展开，开关整个不渲染）。

      上下各留 12px（= 父级 `space-y-6` 的 24px 减半）：
      - 上：`-mt-3` 抵消一半间距；
      - 下：`mb-3!` —— 必须带 `!`，因为 `space-y-6` 的间距来自
        `.space-y-6 > :not(:last-child)`（特异性 0,2,0），普通 `mb-3` 压不过它。

      ⚠️ 别用 `-my-3`：负的 bottom margin 会让按钮盒下沿**压进**「成交额」卡片 12px，
      视觉上间距反而变成负的。下收只能靠把 24px 改小，不能靠负边距抵消。
    -->
    <div v-if="hasIndexOverflow" class="-mt-3 mb-3! flex justify-center">
      <button
        type="button"
        class="pressable rounded-full p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
        :aria-expanded="isIndexExpanded"
        aria-label="全部指数"
        :title="isIndexExpanded ? '收起指数' : '展开全部指数'"
        @click="toggleIndexExpanded"
      >
        <MenuIcon
          name="chevronDown"
          :size="16"
          class="transition-transform"
          :class="isIndexExpanded ? 'rotate-180' : ''"
        />
      </button>
    </div>

    <!-- 成交额（资金速览 + 成交额变化合并为一张卡：两者本质同属市场成交维度） -->
    <BaseCard title="成交额">
      <template #extra>
        <div class="flex items-center gap-2">
          <BaseTabs v-model="turnoverRangeModel" :options="TURNOVER_RANGE_TAB_OPTIONS" />
          <BaseTabs v-model="turnoverViewMode" :options="VIEW_MODE_OPTIONS" />
        </div>
      </template>

      <!-- 资金速览：当日汇总指标（两市成交额 + 主力净流入） -->
      <div
        v-if="totalAmountWan !== null"
        class="mb-4 grid grid-cols-4 gap-4"
      >
        <div>
          <p class="text-xs text-text-tertiary">两市成交额</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-text">
            {{ formatAmount(totalAmountWan) }}
          </p>
        </div>
        <div>
          <p class="text-xs text-text-tertiary">主力净流入</p>
          <p
            class="mt-1 text-xl font-semibold tabular-nums"
            :class="(marketFundFlow?.mainNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'"
          >
            {{ formatYuanWithSign(marketFundFlow?.mainNetInflow) }}
          </p>
        </div>
      </div>
      <BaseSkeleton v-else class="mb-4" />

      <BaseEmpty v-if="isTurnoverError" text="成交额数据加载失败，请稍后重试" />
      <div v-else-if="turnoverHistory.length === 0"><BaseSkeleton /></div>
      <!-- 图表视图 -->
      <TurnoverTrendChart
        v-else-if="turnoverViewMode === VIEW_MODE.CHART"
        :days="turnoverRows"
      />
      <!-- 表格视图 -->
      <BaseTable
        v-else
        :columns="turnoverColumns"
        :rows="turnoverTableRows"
        :row-key="(row) => row.date"
        scroll-class="table-scroll-chart"
      >
        <template #changePct="{ row }">
          <!-- 量能方向 + 变化额 + 变化率：文案整段不折行，颜色沿用涨红跌绿 -->
          <span
            class="whitespace-nowrap"
            :class="row.changePct === null ? 'text-text-tertiary' : row.changePct >= 0 ? 'text-up' : 'text-down'"
          >{{ row.changeText ?? '--' }}</span>
        </template>
      </BaseTable>
    </BaseCard>

    <!-- 涨跌分布 + 大盘资金流：各占 50%，容器不足（每项最小 500px）时换行为全宽 -->
    <div class="flex flex-wrap gap-4">
      <BaseCard
        title="涨跌分布"
        class="min-w-[500px] flex-1 basis-[calc(50%-0.5rem)]"
      >
        <template #extra>
          <BaseTabs v-model="distributionViewMode" :options="VIEW_MODE_OPTIONS" />
        </template>
        <div v-if="!isDistributionReady"><BaseSkeleton /></div>
        <!-- 图表视图 -->
        <DistributionChart v-else-if="distributionViewMode === VIEW_MODE.CHART" :data="distribution" />
        <!-- 列表视图 -->
        <BaseTable
          v-else
          :columns="distributionColumns"
          :rows="distribution"
          :row-key="(bucket) => bucket.key"
          scroll-class="table-scroll-chart"
        >
          <template #label="{ row }">
            <span class="flex items-center gap-1.5">
              <span class="h-2 w-2 rounded-full" :style="{ backgroundColor: row.color }" />
              <span class="text-text-secondary">{{ row.label }}%</span>
            </span>
          </template>
          <template #count="{ row }">
            <span class="tabular-nums text-text">{{ row.count }}</span>
          </template>
          <template #ratio="{ row }">
            <span class="text-text-secondary">
              {{ distributionTotal ? ((row.count / distributionTotal) * 100).toFixed(2) : '0.00' }}%
            </span>
          </template>
        </BaseTable>
      </BaseCard>

      <!-- 大盘资金流（近10日）：曲线 / 列表 -->
      <BaseCard
        title="主力净流入（近10日）"
        class="min-w-[500px] flex-1 basis-[calc(50%-0.5rem)]"
      >
        <template #extra>
          <BaseTabs v-model="marketViewMode" :options="VIEW_MODE_OPTIONS" />
        </template>
        <div v-if="isBreadthError" class="py-10">
          <BaseEmpty text="资金数据加载失败，请稍后重试（上游可能限频或封禁）" />
        </div>
        <BaseSkeleton v-else-if="marketFlowHistory.length === 0" />
        <template v-else>
          <!-- 曲线视图 -->
          <div v-if="marketViewMode === VIEW_MODE.CHART">
            <MarketFundFlowTrendChart :days="marketFlowAsc" :height="MARKET_FLOW_VIEW_HEIGHT_PX" />
          </div>
          <!-- 列表视图 -->
          <BaseTable
            v-else
            :columns="marketColumns"
            :rows="marketFlowRows"
            :row-key="(day) => day.date"
            scroll-class="table-scroll-chart"
          >
            <template #date="{ row }">
              <span class="text-text-secondary">{{ row.date.slice(5) }}</span>
            </template>
            <template #mainNetInflow="{ row }">
              <span
                class="font-medium"
                :class="(row.mainNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'"
              >
                {{ formatYuanWithSign(row.mainNetInflow) }}
              </span>
            </template>
            <template #mainNetInflowPercent="{ row }">
              <span class="text-text-secondary">{{ formatPercent(row.mainNetInflowPercent) }}</span>
            </template>
            <template #superLargeNetInflow="{ row }">
              <span :class="(row.superLargeNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'">
                {{ formatYuanWithSign(row.superLargeNetInflow) }}
              </span>
            </template>
            <template #largeNetInflow="{ row }">
              <span :class="(row.largeNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'">
                {{ formatYuanWithSign(row.largeNetInflow) }}
              </span>
            </template>
            <template #smallNetInflow="{ row }">
              <span :class="(row.smallNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'">
                {{ formatYuanWithSign(row.smallNetInflow) }}
              </span>
            </template>
          </BaseTable>
        </template>
      </BaseCard>
    </div>

    <!-- 板块热力 -->
    <BaseCard title="板块热力（按总市值加权）">
      <template #extra>
        <div class="flex flex-wrap items-center gap-2">
          <!-- 展示形式：热力图 / 列表 -->
          <BaseTabs v-model="settingsStore.heatmapViewMode" :options="HEATMAP_VIEW_MODE_OPTIONS" />
          <!-- Top 数量：两种展示形式下均生效 -->
          <BaseTabs v-model="heatmapTopNModel" :options="HEATMAP_TOP_TAB_OPTIONS" />
        </div>
      </template>
      <template v-if="topBoards.length > 0">
        <!-- 热力图形式：点击板块不下钻替换，而是在下方追加成分股热力图 -->
        <!-- ⚠️ 板块层恒传 false / null：成分股拉取不得顶掉本图，否则点击瞬间整块闪没、数据回来又和图一起冒出 -->
        <HeatmapChart
          v-if="settingsStore.heatmapViewMode === HEATMAP_VIEW_MODE.HEATMAP"
          :boards="heatmapBoards"
          :drill-view="null"
          :is-drill-loading="false"
          :drill-error="null"
          @board-click="drillInto"
        />
        <!-- 成分股热力图（点击上方板块即出现并带骨架；返回后隐藏） -->
        <template v-if="showConstituentSection">
          <div class="mt-4 flex items-center gap-2 text-sm">
            <button
              type="button"
              class="pressable flex items-center gap-1 rounded-lg px-2 py-1 text-text-secondary hover:bg-flat-weak hover:text-text active:scale-90"
              @click="backToBoards"
            >
              <MenuIcon name="arrowLeft" :size="14" />
              返回板块
            </button>
            <span class="font-medium text-text">{{ constituentBoardName }}</span>
            <span class="text-xs text-text-tertiary">
              {{
                isDrillLoading
                  ? '成分股拉取中…'
                  : '成分股热力（面积 = 成交额）· 点击个股查看详情'
              }}
            </span>
          </div>
          <HeatmapChart
            :boards="[]"
            :drill-view="drillView"
            :is-drill-loading="isDrillLoading"
            :drill-error="drillError"
            :show-back-bar="false"
            @stock-click="onOpenHeatmapStock"
            @stock-dblclick="openPage"
          />
        </template>
        <!-- 列表形式（显式条件：与上方成分股块兄弟时 v-else 链会接错对象） -->
        <HeatmapBoardList
          v-else-if="settingsStore.heatmapViewMode === HEATMAP_VIEW_MODE.LIST"
          :boards="topBoards"
          :drill-view="drillView"
          :is-drill-loading="isDrillLoading"
          :drill-error="drillError"
          @stock-click="onOpenHeatmapStock"
          @stock-dblclick="openPage"
          @board-click="drillInto"
          @back="backToBoards"
        />
      </template>
      <BaseSkeleton v-else />
    </BaseCard>
  </div>
</template>
