<script setup lang="ts">
/**
 * 市场榜单（v2 二期二级页，稿：market-modules-v2 R0-R1；规范：design-mobile.md §5.2）
 *
 * 9 榜 chips 与 PC SORT_TAB_OPTIONS 对齐：
 * - 主力 fetchFundFlowRank；连板 fetchZtPool('zt')；异动 fetchStockChanges；
 *   龙虎榜 fetchDragonTigerDetail；大宗 fetchBlockTradeDetail；
 * - 涨幅/跌幅/成交额/换手率四榜共用一次全量报价（sdk.batch.cn()）前端排序取前 100
 * 所有股票行点击进个股页 /stock/:code（v1「点击不响应」终结）
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { sdk } from '../../common/api/sdk';
import { fetchFundFlowRank } from '../../common/api/flow.api';
import { fetchStockChanges, fetchZtPool } from '../../common/api/event.api';
import { fetchDragonTigerDetail, fetchBlockTradeDetail } from '../../common/api/dragon-tiger.api';
import type { FundFlowRankItem } from '../../common/types/flow.types';
import type { ZTPoolItem, StockChangeItem } from '../../common/types/event.types';
import type {
  DragonTigerDetailItem,
  BlockTradeDetailItem,
} from '../../common/types/dragon-tiger.types';
import type { FullQuote } from 'stock-sdk';
import { toFullSymbol } from '../../common/utils/to-full-symbol';

const router = useRouter();

/** 9 榜定义（value 与 PC SORT_TAB_OPTIONS 一致） */
const RANKS = [
  { key: 'stock', label: '主力' },
  { key: 'event', label: '连板' },
  { key: 'events', label: '异动' },
  { key: 'dragon-tiger', label: '龙虎榜' },
  { key: 'block-trade', label: '大宗' },
  { key: 'changePercent', label: '涨幅榜' },
  { key: 'changePercentDesc', label: '跌幅榜' },
  { key: 'amount', label: '成交额榜' },
  { key: 'turnoverRate', label: '换手率榜' },
] as const;
type RankKey = (typeof RANKS)[number]['key'];
const activeRank = ref<RankKey>('stock');

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
}

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
    sub: `${r.continuousBoardCount ?? 1}连板 · 封单 ${fmtYi(r.boardAmount)}`,
    v1: r.price?.toFixed(2) ?? '--',
    v1Cls: '',
    v2: pct(r.changePercent),
    v2Cls: cls(r.changePercent),
  }));

const buildChangeRows = (list: StockChangeItem[]): RankRowView[] =>
  list.slice(0, 60).map((r, i) => ({
    key: `sc-${r.code}-${i}`,
    code: String(r.code),
    name: r.name,
    sub: `${r.time.slice(0, 5)} ${r.changeTypeLabel || r.info}`,
    v1: r.changeTypeLabel || '--',
    v1Cls: 'm-flat',
    v2: r.info,
    v2Cls: 'm-flat',
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
      return { ...base, sub: `现价 ${q.price?.toFixed(2) ?? '--'}`, v1: pct(q.changePercent), v1Cls: cls(q.changePercent) };
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
    } else if (key === 'events') {
      rows = buildChangeRows(await fetchStockChanges());
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

const activeRows = computed(() => rowsByRank.value[activeRank.value] ?? []);

const onRankClick = (key: RankKey): void => {
  activeRank.value = key;
  void loadRank(key);
};

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

loadRank('stock');
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar
      title="市场榜单"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="router.back()"
    />

    <!-- 9 榜 chips -->
    <div class="m-chips">
      <button
        v-for="r in RANKS"
        :key="r.key"
        class="m-chip"
        :class="{ 'm-chip--active': activeRank === r.key }"
        @click="onRankClick(r.key)"
      >
        {{ r.label }}
      </button>
    </div>

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
          <div
            v-for="row in activeRows"
            :key="row.key"
            class="m-row"
            @click="goStock(row.code)"
          >
            <div class="m-row__nm">
              {{ row.name }}
              <span class="sub">{{ row.sub }}</span>
            </div>
            <span class="m-row__val" :class="[row.v1Cls, 'sm']">{{ row.v1 }}</span>
            <span class="m-row__pct" :class="row.v2Cls">{{ row.v2 }}</span>
          </div>
          <div v-if="!activeRows.length" class="m-state">暂无数据</div>
        </div>
      </van-pull-refresh>
      <div class="m-sub-tail"></div>
    </div>
  </div>
</template>
