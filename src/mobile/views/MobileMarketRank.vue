<script setup lang="ts">
/**
 * 盘面雷达（原市场榜单，v2 二期二级页，稿：market-modules-v2 R0-R1；规范：DESIGN-MOBILE.md §5.2）
 *
 * 双模式（v4.2.1 起）：
 * - 盘面雷达页 /market-rank：6 榜 chips（主力/大宗/涨幅/跌幅/成交额/换手率）；
 * - 独立榜页 /rank/:rank（连板 event / 异动 events / 龙虎榜 dragon-tiger，入口在首页金刚区）：
 *   无 chips、navbar 标题为榜名，只渲染该榜。
 *
 * 数据源与 PC SORT_TAB_OPTIONS 对齐：
 * - 主力 fetchFundFlowRank；连板 fetchZtPool('zt')；异动 fetchStockChanges；
 *   龙虎榜 fetchDragonTigerDetail；大宗 fetchBlockTradeDetail；
 * - 涨幅/跌幅/成交额/换手率四榜共用一次全量报价（sdk.batch.cn()）前端排序取前 100
 * 所有股票行点击进个股页 /stock/:code
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { sdk } from '../../common/api/sdk';
import { fetchFundFlowRank } from '../../common/api/flow.api';
import { fetchBoardChanges, fetchStockChanges, fetchZtPool } from '../../common/api/event.api';
import { fetchDragonTigerDetail, fetchBlockTradeDetail } from '../../common/api/dragon-tiger.api';
import type { FundFlowRankItem } from '../../common/types/flow.types';
import type { BoardChangeItem, ZTPoolItem, StockChangeItem } from '../../common/types/event.types';
import { delay } from '../../common/utils/delay';
import { useMobilePolling } from '../composables/use-mobile-polling';
import type {
  DragonTigerDetailItem,
  BlockTradeDetailItem,
} from '../../common/types/dragon-tiger.types';
import type { FullQuote } from 'stock-sdk';
import { toFullSymbol } from '../../common/utils/to-full-symbol';

const router = useRouter();
const route = useRoute();

/** 拆分为独立页的 3 榜（入口在首页金刚区，路由 /rank/:rank；不再作为盘面雷达 chips 子项） */
const STANDALONE_RANKS = {
  event: '连板',
  events: '异动',
  'dragon-tiger': '龙虎榜',
} as const satisfies Record<string, string>;
type StandaloneKey = keyof typeof STANDALONE_RANKS;

/**
 * 异动独立页内部子榜：`event-board`（板块异动）不对应路由，
 * 只作为 /rank/events 页内第二个 Tab 的数据键（王总 2026-10-13 同步 PC 双列表）
 */
const EVENT_BOARD_KEY = 'event-board';

/** 盘面雷达页 chips（6 榜；连板 / 异动 / 龙虎榜已拆为独立页） */
const RANKS = [
  { key: 'stock', label: '主力' },
  { key: 'block-trade', label: '大宗' },
  { key: 'changePercent', label: '涨幅榜' },
  { key: 'changePercentDesc', label: '跌幅榜' },
  { key: 'amount', label: '成交额榜' },
  { key: 'turnoverRate', label: '换手率榜' },
] as const;
type RankKey = (typeof RANKS)[number]['key'] | StandaloneKey | typeof EVENT_BOARD_KEY;

/** 异动独立页顶部双 Tab（盘口异动 / 板块异动；对齐 PC 盘面雷达-异动页签） */
const EVENT_TABS = [
  { key: 'events', label: '盘口异动' },
  { key: EVENT_BOARD_KEY, label: '板块异动' },
] as const satisfies readonly { key: RankKey; label: string }[];
const activeRank = ref<RankKey>('stock');

/** 各榜表头（名称列 / 值1 列 / 值2 列；空串渲染占位空槽，保持列对齐）
 *  王总 2026-10-12：异动 / 连板 / 龙虎榜三页表格缺表头，补齐（对全部 10 榜生效） */
const RANK_HEADERS: Record<RankKey, [string, string, string]> = {
  stock: ['股票', '净流入', '涨跌幅'],
  'block-trade': ['股票', '收盘价', '涨跌幅'],
  changePercent: ['股票', '现价', '涨跌幅'],
  changePercentDesc: ['股票', '现价', '涨跌幅'],
  amount: ['股票', '成交额', '涨跌幅'],
  turnoverRate: ['股票', '换手率', '涨跌幅'],
  event: ['股票', '连板', '涨跌幅'],
  events: ['股票', '异动类型', ''],
  [EVENT_BOARD_KEY]: ['板块', '主力净流入', '涨跌幅'],
  'dragon-tiger': ['股票', '净买额', '涨跌幅'],
};

/** 可排序榜：表头列下标（0=值1 列，1=值2 列）→ 排序键；不在表内的榜表头不可点 */
const SORTABLE: Partial<Record<RankKey, readonly (SortKey | null)[]>> = {
  event: ['boardCount', 'changePct'],
  'dragon-tiger': ['netBuy', 'changePct'],
};

/** 当前排序键（null = 上游默认序）；点击表头切换列，再点同列升降序翻转 */
const sortKey = ref<SortKey | null>(null);
const sortAsc = ref(false);

/** 重置排序（切榜时回落上游默认序） */
const resetSort = (): void => {
  sortKey.value = null;
  sortAsc.value = false;
};

/**
 * 取某榜某列的排序键（不可排序榜返回 null）
 * @param rank 榜 key
 * @param colIndex 值列下标（0 / 1）
 * @returns 排序键或 null
 */
const sortKeyOf = (rank: RankKey, colIndex: number): SortKey | null =>
  SORTABLE[rank]?.[colIndex] ?? null;

/**
 * 表头点击排序：点新列默认降序，点同列翻转升降
 * @param rank 榜 key
 * @param colIndex 值列下标
 */
const onHeaderSort = (rank: RankKey, colIndex: number): void => {
  const key = sortKeyOf(rank, colIndex);
  if (!key) return;
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value;
  } else {
    sortKey.value = key;
    sortAsc.value = false;
  }
};

/** 独立页模式：/rank/:rank 命中拆出榜时非空（隐藏 chips、标题用榜名、锁定该榜） */
const standaloneRank = computed<StandaloneKey | null>(() => {
  const rank = route.params.rank;
  return typeof rank === 'string' && rank in STANDALONE_RANKS ? (rank as StandaloneKey) : null;
});

/** navbar 标题：独立页为榜名，盘面雷达页为「盘面雷达」 */
const pageTitle = computed(() =>
  standaloneRank.value ? STANDALONE_RANKS[standaloneRank.value] : '盘面雷达',
);

/** 报价榜的排序键 */
const QUOTE_SORT_KEYS: Record<string, (a: FullQuote, b: FullQuote) => number> = {
  changePercent: (a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999),
  changePercentDesc: (a, b) => (a.changePercent ?? 999) - (b.changePercent ?? 999),
  amount: (a, b) => (b.amount ?? 0) - (a.amount ?? 0),
  turnoverRate: (a, b) => (b.turnoverRate ?? -1) - (a.turnoverRate ?? -1),
};

/** 行视图：各榜归一到 左名/副行 + 两个右值，模板单轨渲染 */
interface RankRowView {
  key: string;
  code: string;
  name: string;
  sub: string;
  v1: string;
  v1Cls: string;
  v2: string;
  v2Cls: string;
  /** 可排序数值键（连板数 / 涨跌幅 / 净买额；表头排序用） */
  sort?: Partial<Record<SortKey, number>>;
}

/** 排序键 */
type SortKey = 'boardCount' | 'changePct' | 'netBuy';

/** 异动类型 → 涨跌语义色（changeType 枚举映射，比中文标签匹配稳） */
const CHANGE_TONE: Record<string, 'm-up' | 'm-down'> = {
  // 多方 / 拉升类（红）
  rocket_launch: 'm-up',
  quick_rebound: 'm-up',
  large_buy: 'm-up',
  limit_up_seal: 'm-up',
  limit_down_open: 'm-up',
  big_buy_order: 'm-up',
  auction_up: 'm-up',
  high_open_5d: 'm-up',
  gap_up: 'm-up',
  high_60d: 'm-up',
  surge_60d: 'm-up',
  // 空方 / 下杀类（绿）
  accelerate_down: 'm-down',
  high_dive: 'm-down',
  large_sell: 'm-down',
  limit_down_seal: 'm-down',
  limit_up_open: 'm-down',
  big_sell_order: 'm-down',
  auction_down: 'm-down',
  low_open_5d: 'm-down',
  gap_down: 'm-down',
  low_60d: 'm-down',
  drop_60d: 'm-down',
};

const loading = ref(false);
const error = ref(false);
const rowsByRank = ref<Partial<Record<RankKey, RankRowView[]>>>({});

const fmtYi = (v: number | null): string =>
  v === null || v === undefined ? '--' : `${(v / 1e8).toFixed(2)}亿`;
const pct = (v: number | null): string => (v === null || v === undefined ? '--' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const cls = (v: number | null): string => (v === null || v === undefined ? 'm-flat' : v > 0 ? 'm-up' : v < 0 ? 'm-down' : 'm-flat');

const buildFundFlowRows = (list: FundFlowRankItem[]): RankRowView[] =>
  list.slice(0, 60).map((r, i) => ({
    key: `ff-${r.code}-${i}`,
    code: String(r.code),
    name: r.name,
    sub: `现价 ${r.price?.toFixed(2) ?? '--'}`,
    v1: fmtYi(r.mainNetInflow),
    v1Cls: cls(r.mainNetInflow),
    v2: pct(r.changePercent),
    v2Cls: cls(r.changePercent),
  }));

const buildZtRows = (list: ZTPoolItem[]): RankRowView[] =>
  list.slice(0, 60).map((r, i) => ({
    key: `zt-${r.code}-${i}`,
    code: String(r.code),
    name: r.name,
    // 连板数升级为独立列（王总 2026-10-12：新增【连板】列 + 可排序），现价/封单留在副行
    sub: `现价 ${r.price?.toFixed(2) ?? '--'} · 封单 ${fmtYi(r.boardAmount)}`,
    v1: `${r.continuousBoardCount ?? 1}板`,
    v1Cls: 'm-up',
    v2: pct(r.changePercent),
    v2Cls: cls(r.changePercent),
    sort: { boardCount: r.continuousBoardCount ?? 0, changePct: r.changePercent ?? -999 },
  }));

const buildChangeRows = (list: StockChangeItem[]): RankRowView[] =>
  list.slice(0, 60).map((r, i) => ({
    key: `sc-${r.code}-${i}`,
    code: String(r.code),
    name: r.name,
    // ⚠️ info 可能是上游原始逗号串（如 "236500,72.04,..."），曾直接塞进右侧定宽槽把名称
    //    挤成竖排（王总 2026-10-12 截图反馈）；现与时间并排放在名称下的副行（CSS 截断，
    //    王总 2026-10-13 要求同步 PC 的丰富内容）
    sub: [r.time.slice(0, 5), r.info].filter(Boolean).join(' '),
    v1: r.changeTypeLabel || r.changeType,
    // 类型按涨跌语义着色（王总 2026-10-12）：火箭发射/封涨停等红，高台跳水/封跌停等绿
    v1Cls: CHANGE_TONE[r.changeType] ?? 'm-flat',
    v2: '',
    v2Cls: '',
  }));

/**
 * 板块异动行（对齐 PC 板块异动表：板块 / 涨跌幅 / 主力净流入 / 异动次数 / 最频繁个股）
 * @param list 板块异动清单（上游默认序）
 * @returns 行视图列表
 */
const buildBoardChangeRows = (list: BoardChangeItem[]): RankRowView[] =>
  list.slice(0, 60).map((r, i) => ({
    key: `bc-${r.name}-${i}`,
    code: '',
    name: r.name,
    sub: `异动 ${r.totalChangeCount ?? '--'} 次 · 最频繁 ${r.topStockName}`,
    v1: fmtYi(r.mainNetInflow),
    v1Cls: cls(r.mainNetInflow),
    v2: pct(r.changePercent),
    v2Cls: cls(r.changePercent),
  }));

const buildDragonRows = (list: DragonTigerDetailItem[]): RankRowView[] =>
  list.slice(0, 60).map((r, i) => ({
    key: `dt-${r.code}-${i}`,
    code: String(r.code),
    name: r.name,
    sub: `${r.date} 收盘 ${r.close?.toFixed(2) ?? '--'}`,
    v1: fmtYi(r.netBuyAmount),
    v1Cls: cls(r.netBuyAmount),
    v2: pct(r.changePercent),
    v2Cls: cls(r.changePercent),
    // 龙虎榜支持按净买额 / 涨跌幅排序（王总 2026-10-12）
    sort: { netBuy: r.netBuyAmount ?? 0, changePct: r.changePercent ?? -999 },
  }));

const buildBlockRows = (list: BlockTradeDetailItem[]): RankRowView[] =>
  list.slice(0, 60).map((r, i) => ({
    key: `bt-${r.code}-${i}`,
    code: String(r.code),
    name: r.name,
    sub: `${r.date} 成交价 ${r.dealPrice?.toFixed(2) ?? '--'}`,
    v1: r.close?.toFixed(2) ?? '--',
    v1Cls: '',
    v2: pct(r.changePercent),
    v2Cls: cls(r.changePercent),
  }));

/** 报价 4 榜：一次全量 → 按 key 排序前 100
 * @param quotes 全量 A 股报价
 * @param rank 榜 key（决定排序键与展示列）
 * @returns 行视图列表 */
const buildQuoteRows = (quotes: FullQuote[], rank: RankKey): RankRowView[] => {
  const sortFn = QUOTE_SORT_KEYS[rank];
  const sorted = [...quotes].sort(sortFn).slice(0, 100);
  return sorted.map((q, i) => {
    const base = {
      key: `q-${rank}-${q.code}-${i}`,
      code: q.code,
      name: q.name,
      v2: pct(q.changePercent),
      v2Cls: cls(q.changePercent),
    };
    if (rank === 'changePercent' || rank === 'changePercentDesc') {
      // 表头列 = 现价（此前 v1 与 v2 重复显示涨跌幅）
      return { ...base, sub: '', v1: q.price?.toFixed(2) ?? '--', v1Cls: '' };
    }
    if (rank === 'amount') {
      return { ...base, sub: `现价 ${q.price?.toFixed(2) ?? '--'}`, v1: fmtYi(q.amount), v1Cls: 'm-flat' };
    }
    return { ...base, sub: `现价 ${q.price?.toFixed(2) ?? '--'}`, v1: `${q.turnoverRate?.toFixed(2) ?? '--'}%`, v1Cls: 'm-flat' };
  });
};

/** 全量报价缓存（四个报价榜共享，页面级） */
let quoteCache: FullQuote[] | null = null;
const loadAllQuotes = async (): Promise<FullQuote[]> => {
  if (quoteCache) return quoteCache;
  const data = await sdk.batch.cn();
  quoteCache = data;
  return data;
};

/** 异动双榜串行请求间隔（毫秒）：与 PC MarketEventView 同口径，对上游保持克制 */
const EVENT_REQUEST_GAP_MS = 500;

const loadRank = async (key: RankKey, force = false): Promise<void> => {
  if (!force && rowsByRank.value[key]) return;
  loading.value = true;
  error.value = false;
  try {
    let rows: RankRowView[];
    if (key === 'stock') {
      rows = buildFundFlowRows(await fetchFundFlowRank());
    } else if (key === 'event') {
      rows = buildZtRows(await fetchZtPool('zt'));
    } else if (key === 'events' || key === EVENT_BOARD_KEY) {
      // 异动页双榜一次取齐（对齐 PC events 模式；两个上游串行 500ms 错峰防封禁）
      const stockRows = buildChangeRows(await fetchStockChanges());
      await delay(EVENT_REQUEST_GAP_MS);
      const boardRows = buildBoardChangeRows(await fetchBoardChanges());
      rowsByRank.value.events = stockRows;
      rowsByRank.value[EVENT_BOARD_KEY] = boardRows;
      rows = key === 'events' ? stockRows : boardRows;
    } else if (key === 'dragon-tiger') {
      rows = buildDragonRows(await fetchDragonTigerDetail());
    } else if (key === 'block-trade') {
      rows = buildBlockRows(await fetchBlockTradeDetail());
    } else {
      rows = buildQuoteRows(await loadAllQuotes(), key);
    }
    rowsByRank.value[key] = rows;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
};

const activeRows = computed(() => {
  const base = rowsByRank.value[activeRank.value] ?? [];
  const key = sortKey.value;
  // 仅可排序榜（连板 / 龙虎榜）应用表头排序；无键 = 上游默认序
  if (!key || !(activeRank.value in SORTABLE)) return base;
  const dir = sortAsc.value ? 1 : -1;
  return [...base].sort(
    (a, b) => ((a.sort?.[key] ?? -Infinity) - (b.sort?.[key] ?? -Infinity)) * dir,
  );
});

const onRankClick = (key: RankKey): void => {
  resetSort();
  activeRank.value = key;
  void loadRank(key);
};

/** 6 榜 Tabs 绑定下标（van-tabs 的 active 是 index，这里做 index ↔ rank key 互转） */
const activeRankIndex = computed({
  get: () => Math.max(0, RANKS.findIndex((r) => r.key === activeRank.value)),
  set: (index: number) => onRankClick(RANKS[index]!.key),
});

/** 异动独立页（/rank/events）：顶部双 Tab 盘口异动 / 板块异动 */
const isEventStandalone = computed(() => standaloneRank.value === 'events');
/** 双 Tab 绑定下标（van-tabs 的 active 是 index，这里做 index ↔ rank key 互转） */
const activeEventTabIndex = computed({
  get: () => Math.max(0, EVENT_TABS.findIndex((t) => t.key === activeRank.value)),
  set: (index: number) => onRankClick(EVENT_TABS[index]!.key),
});

const goStock = (code: string): void => {
  if (!code) return;
  void router.push(`/stock/${toFullSymbol(code)}`);
};

/** 整页下拉刷新
 * @returns 无返回值，finally 里复位 v-model 收起下拉状态 */
const refreshing = ref(false);
const onRefresh = async (): Promise<void> => {
  try {
    quoteCache = null;
    await loadRank(activeRank.value, true);
  } finally {
    refreshing.value = false;
  }
};

// 独立页模式锁定对应榜（进入即装载）；盘面雷达页保持默认主力榜
watch(standaloneRank, (rank) => {
  if (rank) {
    resetSort();
    activeRank.value = rank;
    void loadRank(rank);
  }
}, { immediate: true });
if (!standaloneRank.value) void loadRank('stock');

// 异动独立页轮询（王总 2026-10-13）：间隔跟随「我的 → 轮询间隔」设置，与 PC 异动页同口径；
// 仅异动独立页生效（其余榜保持进入加载 + 手动下拉刷新），强刷当前子榜（一次取齐双榜）
useMobilePolling(() => {
  if (!isEventStandalone.value) return;
  void loadRank(activeRank.value, true);
});
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar
      :title="pageTitle"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="router.back()"
    />

    <!-- 6 榜分组 Tabs（参考今天炒什么：van-tabs 选择器模式；独立页模式隐藏） -->
    <van-tabs
      v-if="!standaloneRank"
      v-model:active="activeRankIndex"
      class="m-tabs m-tabs--selector"
      :ellipsis="false"
    >
      <van-tab v-for="r in RANKS" :key="r.key" :title="r.label" />
    </van-tabs>

    <!-- 异动独立页双 Tab：盘口异动 / 板块异动（对齐 PC 盘面雷达-异动页签的双列表） -->
    <van-tabs
      v-if="isEventStandalone"
      v-model:active="activeEventTabIndex"
      class="m-tabs m-tabs--selector"
      :ellipsis="false"
    >
      <van-tab v-for="t in EVENT_TABS" :key="t.key" :title="t.label" />
    </van-tabs>

    <div class="m-sub-scroll">
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <div v-if="loading" class="m-card m-skel-fill">
          <div v-for="i in 10" :key="i" class="m-skel-row"></div>
        </div>
        <div v-else-if="error" class="m-state">
          榜单加载失败
          <span class="retry" @click="loadRank(activeRank, true)">重试</span>
        </div>
        <div v-else class="m-card">
          <!-- 表头（王总 2026-10-12：异动 / 连板 / 龙虎榜三页缺表头，对全部榜补齐；
               连板 / 龙虎榜的值列可点击排序，箭头指示当前列与升降序） -->
          <div class="m-rowhead">
            <div class="m-rowhead__nm">{{ RANK_HEADERS[activeRank][0] }}</div>
            <span
              v-for="(head, ci) in RANK_HEADERS[activeRank].slice(1)"
              :key="ci"
              class="m-rowhead__v"
              :class="{
                'm-rowhead__v--sort': sortKeyOf(activeRank, ci),
                'm-rowhead__v--on': sortKey === sortKeyOf(activeRank, ci) && sortKey !== null,
              }"
              @click="onHeaderSort(activeRank, ci)"
            >
              {{ head }}
              <template v-if="sortKey !== null && sortKey === sortKeyOf(activeRank, ci)">
                {{ sortAsc ? '▲' : '▼' }}
              </template>
            </span>
          </div>
          <div
            v-for="row in activeRows"
            :key="row.key"
            class="m-row"
            @click="goStock(row.code)"
          >
            <div class="m-row__nm">
              {{ row.name }}
              <span v-if="row.sub" class="sub">{{ row.sub }}</span>
            </div>
            <span v-if="row.v1" class="m-row__val" :class="[row.v1Cls, 'sm']">{{ row.v1 }}</span>
            <span v-if="row.v2" class="m-row__pct" :class="row.v2Cls">{{ row.v2 }}</span>
          </div>
          <div v-if="!activeRows.length" class="m-state">暂无数据</div>
        </div>
      </van-pull-refresh>
      <div class="m-sub-tail"></div>
    </div>
  </div>
</template>

<style scoped>
/* navbar 与榜单卡之间留空隙（独立页无 chips 缓冲，卡片曾直接顶到 navbar——王总 2026-10-12） */
.m-sub-scroll { padding-top: 10px; }

/* 异动盘口行副行含时间 + 上游说明（可能为长串），单行截断防止换行撑高行 */
.m-row__nm .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 表头行：与 .m-row 同 padding/gap，右两列 min-width 对齐 .m-row__pct(58px) */
.m-rowhead {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px 7px;
  border-bottom: 1px solid var(--color-border);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-text-3);
}
.m-rowhead__nm { flex: 1; min-width: 0; }
.m-rowhead__v { flex-shrink: 0; min-width: 58px; text-align: right; }
/* 可排序值列：可点 + 当前排序列主色高亮 */
.m-rowhead__v--sort { cursor: pointer; user-select: none; }
.m-rowhead__v--on { color: var(--color-primary); }
</style>
