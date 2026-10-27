<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BaseTable from '../components/ui/BaseTable.vue';
import DistributionChart from '../components/charts/DistributionChart.vue';
import HeatmapChart from '../components/charts/HeatmapChart.vue';
import HeatmapBoardList from '../components/business/HeatmapBoardList.vue';
import RealtimeTurnoverCard from '../components/business/RealtimeTurnoverCard.vue';
import MarketBreadthCard from '../components/business/MarketBreadthCard.vue';
import MarketRatingCard from '../components/business/MarketRatingCard.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import StockQuoteCard from '../components/business/StockQuoteCard.vue';
import {
  fetchAllMarketQuotes,
  fetchFullQuotes,
} from '../../common/api/quotes.api.ts';
import { fetchGlobalIndexQuotes } from '../../common/api/panorama.api.ts';
import { fetchIndustryBoards } from '../../common/api/board.api.ts';
import { fetchMarketFundFlow } from '../../common/api/flow.api.ts';
import { fetchZtPool } from '../../common/api/event.api.ts';
import { usePolling } from '../../common/composables/use-polling';
import {
  INDEX_SYMBOLS,
} from '../../common/constants/index-symbols.constants.ts';
import {
  HEATMAP_TOP_TAB_OPTIONS,
  HEATMAP_VIEW_MODE,
  HEATMAP_VIEW_MODE_OPTIONS,
} from '../../common/constants/heatmap.constants.ts';
import { POLLING_INTERVAL } from '../../common/constants/polling.constants.ts';
import { PANORAMA_GLOBAL_INDEX_SECIDS } from '../../common/constants/panorama.constants.ts';
import { useHeatmapDrill } from '../../common/composables/use-heatmap-drill';
import { usePageHeaderSlot, PAGE_HEADER_ACTIONS_TARGET } from '../../common/composables/use-page-header-slot';
import { useRowClamp } from '../../common/composables/use-row-clamp';
import { useStockOpen } from '../../common/composables/use-stock-open';
import type { DistributionCount } from '../../common/types/distribution.types.ts';
import type { GlobalIndexQuote } from '../../common/types/panorama.types.ts';
import type {
  HeatmapBoard,
  IndustryBoard,
} from '../../common/types/board.types.ts';
import type { MarketFundFlow } from '../../common/types/flow.types.ts';
import type { ZTPoolItem } from '../../common/types/event.types.ts';
import type { MarketSentiment } from '../../common/types/market-sentiment.types.ts';
import type { MarketBreadth } from '../../common/types/market-breadth.types.ts';
import { ingestBreadthSnapshot } from '../../common/api/market-breadth-db.api.ts';
import type { TableColumn } from '../../common/types/table.types.ts';
import type { FullQuote } from '../../common/types/stock-quote.types.ts';
import { formatPercent, formatPercentUnsigned } from '../../common/utils/format-percent';
import { formatAmount } from '../../common/utils/format-amount';
import { computeMarketSentiment } from '../../common/utils/compute-market-sentiment';
import { formatYuanWithSign } from '../../common/utils/format-yuan';
import { countDistribution } from '../../common/utils/count-distribution';
import { delay } from '../../common/utils/delay';
import { useRouter } from 'vue-router';
import { useSettingsStore } from '../../common/stores/settings';
import { useDataCacheStore } from '../../common/stores/data-cache';
import { DATA_CACHE_KEY } from '../../common/constants/data-cache.constants.ts';
import { ROUTE_PATH } from '../../common/constants/router-meta.constants.ts';

/** 市场宽度各接口请求间隔（毫秒）：对同一上游串行错峰 */
const BREADTH_REQUEST_GAP_MS = 500;

/** 展示形式：图表（默认） / 列表（涨跌分布与成交额共用同一组值） */
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

/**
 * 市场总览：指数卡片（轮询，点击跳 K 线详情）+ 全部指数一次渲染、收起只看首行（见 useRowClamp）+
 * 涨跌分布 / 资金速览 + 市场情绪（涨停 / 跌停 / 炸板 / 连板梯队 / 打板溢价）+ 市场宽度 · ARMS +
 * 板块热力（轮询，支持热力图 / 列表两种展示形式，
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
const router = useRouter();

/** 页头动作挂载守卫（KeepAlive 下切走页面时撤离 Teleport 内容，见 use-page-header-slot） */
const { active: headerSlotActive } = usePageHeaderSlot();

/** 跳盘面雷达（成交额 / 主力净流入卡片标题入口） */
const goMarketRank = (): void => {
  void router.push(ROUTE_PATH.MARKET_RANK);
};

/** 跳资金流向页（成交额卡标题落点，2026-10-13 起独立成页） */
const goBoardFlow = (): void => {
  void router.push(ROUTE_PATH.BOARD_FLOW);
};

/** 跳行情全景（涨跌分布 / 板块热力卡片标题入口；默认即 A 股全景模块） */
const goPanorama = (): void => {
  void router.push(ROUTE_PATH.PANORAMA);
};

/** 跳宽基ETF页（页头按钮入口，国家队/汇金系宽基监控） */
const goWideBaseEtf = (): void => {
  void router.push(ROUTE_PATH.WIDE_BASE_ETF);
};

/** 跳大盘云图（页头按钮入口；侧栏入口 2026-10-22 移除，与本页宽基ETF按钮同位） */
const goHeatmap = (): void => {
  void router.push(ROUTE_PATH.HEATMAP);
};

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
/** 当日大盘资金流（取最新一条；成交额卡资金速览「主力净流入」消费） */
const marketFundFlow = ref<MarketFundFlow | null>(null);
/** 两市成交额合计（万） */
const totalAmountWan = ref<number | null>(null);

/** 市场宽度 · ARMS 统计（随 fetchMarketBreadth 同源快照写入，供 MarketBreadthCard 消费） */
const marketBreadth = ref<MarketBreadth | null>(null);

/** 市场宽度快照结构 */
interface BreadthSnapshot {
  distribution: DistributionCount[];
  totalAmountWan: number;
  boards: IndustryBoard[];
  fundFlow: MarketFundFlow | null;
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
    // 市场宽度 · ARMS：与涨跌分布同源快照，ingest 落分钟点 / 收盘定稿日 bar（零新增请求）
    marketBreadth.value = ingestBreadthSnapshot(quotes);
    industryBoards.value = boards;
    marketFundFlow.value = flows.at(-1) ?? null;

    const snapshot: BreadthSnapshot = {
      distribution: distribution.value,
      totalAmountWan: totalAmountWan.value,
      boards: industryBoards.value,
      fundFlow: marketFundFlow.value,
    };
    dataCache.set(DATA_CACHE_KEY.DASHBOARD_BREADTH, snapshot);
  } catch (error) {
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

// ---------- 市场情绪（涨停 / 炸板 / 跌停 / 昨日涨停四池聚合；与市场宽度同频轮询） ----------

/** 市场情绪速览（快照播种 + 轮询刷新） */
const sentiment = ref<MarketSentiment | null>(null);

/** 情绪首载是否失败（且无快照）——供卡片空态展示 */
const isSentimentError = ref(false);

// 快照播种：切换回本页先展示上次数据
const cachedSentiment = dataCache.get<MarketSentiment>(DATA_CACHE_KEY.DASHBOARD_SENTIMENT);
if (cachedSentiment) {
  sentiment.value = cachedSentiment;
}

/** 拉取情绪四池（串行错峰，与市场宽度同上游）并聚合指标（成功后写快照） */
const fetchMarketSentiment = async (): Promise<void> => {
  try {
    const limitUp: ZTPoolItem[] = await fetchZtPool('zt');
    await delay(BREADTH_REQUEST_GAP_MS);
    const broken: ZTPoolItem[] = await fetchZtPool('broken');
    await delay(BREADTH_REQUEST_GAP_MS);
    const limitDown: ZTPoolItem[] = await fetchZtPool('dt');
    await delay(BREADTH_REQUEST_GAP_MS);
    const yesterdayZt: ZTPoolItem[] = await fetchZtPool('yesterday');
    sentiment.value = computeMarketSentiment(limitUp, broken, limitDown, yesterdayZt);
    dataCache.set(DATA_CACHE_KEY.DASHBOARD_SENTIMENT, sentiment.value);
  } catch (error) {
    isSentimentError.value = sentiment.value === null;
    console.error('[dashboard] sentiment', error);
  }
};

usePolling({
  task: fetchMarketSentiment,
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

// ---------- 成交额卡（2026-10-27 王总指定：只保留当日成交额曲线 RealtimeTurnoverCard；
// 历史成交量 / 相对成交量两量纲移除 —— 资金流向页已有完整图表（fetchMarketTurnover 链路随之移除，
// 该页数据快照键 DASHBOARD_TURNOVER 仍由资金流向页自己读写） ----------

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

/** 涨跌分布是否就绪（首次加载完成） */
const isDistributionReady = computed(() => distribution.value.length > 0);
</script>

<template>
  <div class="space-y-6">
    <!-- 页头快捷入口：大盘云图（侧栏入口已移除，2026-10-22 王总指定）+ 宽基ETF
        （Teleport 投射，本页激活时才挂载） -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <BaseButton variant="ghost" data-track="DASHBOARD_OPEN_HEATMAP" @click="goHeatmap">
        <MenuIcon name="cloud" :size="14" />
        大盘云图
      </BaseButton>
      <BaseButton variant="ghost" data-track="DASHBOARD_OPEN_WIDE_BASE_ETF" @click="goWideBaseEtf">
        <MenuIcon name="chartBars" :size="14" />
        宽基ETF
      </BaseButton>
    </Teleport>
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

    <!--
      市场情绪 + 大盘评级（等宽 flex 左右分布，gap 20px；2026-10-13 实时成交额并入下方成交额卡后，
      本行左侧由市场情绪补位）：四池数据与市场宽度同上游（东财），每轮串行错峰 4 请求；
      梯队口径与盘面雷达-连板页签一致；大盘评级数据源同花顺 q 域 indexflash
    -->
    <div class="flex flex-wrap gap-5">
      <BaseCard
        title="市场情绪"
        clickable-title
        class="min-w-[320px] flex-1"
        @title-click="goMarketRank"
      >
        <div v-if="isSentimentError" class="py-8">
          <BaseEmpty text="情绪数据加载失败，请稍后重试" />
        </div>
        <BaseSkeleton v-else-if="!sentiment" />
        <template v-else>
          <!-- 速览六格：窄容器 3×2，宽容器（≥1024px）6×1（主区已开 @container；
               2026-10-24 抽屉挤窄主区时六格单格仅 ~55px，标签逐字竖排，故收窄切六列的档位，
               标签 nowrap 防一字一行） -->
          <div class="grid grid-cols-3 gap-4 @5xl:grid-cols-6">
            <div>
              <p class="whitespace-nowrap text-xs text-text-tertiary">涨停</p>
              <p class="mt-1 text-xl font-semibold tabular-nums text-up">
                {{ sentiment.limitUpCount }}
              </p>
            </div>
            <div>
              <p class="whitespace-nowrap text-xs text-text-tertiary">跌停</p>
              <p class="mt-1 text-xl font-semibold tabular-nums text-down">
                {{ sentiment.limitDownCount }}
              </p>
            </div>
            <div>
              <p class="whitespace-nowrap text-xs text-text-tertiary">炸板</p>
              <p class="mt-1 text-xl font-semibold tabular-nums text-text">
                {{ sentiment.brokenCount }}
              </p>
            </div>
            <div>
              <p class="whitespace-nowrap text-xs text-text-tertiary">炸板率</p>
              <p class="mt-1 text-xl font-semibold tabular-nums text-text">
                {{ sentiment.brokenRate === null ? '--' : formatPercentUnsigned(sentiment.brokenRate) }}
              </p>
            </div>
            <div>
              <p class="whitespace-nowrap text-xs text-text-tertiary">连板高度</p>
              <p
                class="mt-1 text-xl font-semibold tabular-nums"
                :class="sentiment.maxLadder >= 3 ? 'text-up' : 'text-text'"
              >
                {{ sentiment.maxLadder > 0 ? `${sentiment.maxLadder} 板` : '--' }}
              </p>
            </div>
            <div>
              <p class="whitespace-nowrap text-xs text-text-tertiary">昨日涨停均涨</p>
              <p
                class="mt-1 text-xl font-semibold tabular-nums"
                :class="
                  sentiment.yesterdayZtAvgPct === null
                    ? 'text-text'
                    : sentiment.yesterdayZtAvgPct >= 0
                      ? 'text-up'
                      : 'text-down'
                "
              >
                {{ sentiment.yesterdayZtAvgPct === null ? '--' : formatPercent(sentiment.yesterdayZtAvgPct) }}
              </p>
            </div>
          </div>
          <!-- 连板梯队药丸：与盘面雷达-连板页签同款样式（≥3 板红色高亮） -->
          <div v-if="sentiment.ladder.length > 0" class="mt-4 flex flex-wrap items-center gap-2">
            <span
              v-for="tier in sentiment.ladder"
              :key="tier.board"
              class="rounded-full px-3 py-1 text-xs font-medium"
              :class="tier.board >= 3 ? 'bg-up-weak text-up' : 'bg-flat-weak text-text-secondary'"
            >
              {{ tier.board >= 2 ? `${tier.board}板` : '首板' }} · {{ tier.count }} 家
            </span>
          </div>
          <p v-else class="mt-4 text-xs text-text-tertiary">今日暂无涨停个股</p>
        </template>
      </BaseCard>
      <BaseCard title="大盘评级" class="min-w-[320px] flex-1">
        <MarketRatingCard />
      </BaseCard>
    </div>

    <!-- 成交额（资金速览 + 当日成交额曲线合并为一张卡：两者本质同属市场成交维度；标题跳资金流向页，2026-10-24 王总指定）。
         2026-10-27 王总指定：历史成交量 / 相对成交量两量纲移除（资金流向页已有完整图表），卡片只剩当日成交额曲线 -->
    <BaseCard
      title="成交额"
      clickable-title
      @title-click="goBoardFlow"
    >
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

      <!-- 当日成交额曲线（当日 vs 昨日同时刻分时累计，组件内自管数据） -->
      <RealtimeTurnoverCard />
    </BaseCard>

    <!-- 涨跌分布 + 市场宽度：等宽 flex 左右分布（gap 20px，与上方新行同口径），窄窗 320px 以下换行。
         市场宽度 2026-10-24 起由独占整行改入本行右位、宽度减半（王总指定），
         原右位「主力净流入（近10日）」卡同日删除（大盘资金流下钻走资金流向页） -->
    <div class="flex flex-wrap gap-5">
      <BaseCard
        title="涨跌分布"
        clickable-title
        class="min-w-[320px] flex-1"
        @title-click="goPanorama"
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

      <!-- 市场宽度 · ARMS（当日分时；近 30/60 日等长历史在右上角「市场宽度详情」入口页；数据随行情快照本地积累） -->
      <MarketBreadthCard
        :breadth="marketBreadth"
        :sentiment="sentiment"
        class="min-w-[320px] flex-1"
      />
    </div>

    <!-- 板块热力（标题跳大盘云图，2026-10-24 王总指定） -->
    <BaseCard
      title="板块热力（按总市值加权）"
      clickable-title
      @title-click="goHeatmap"
    >
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
