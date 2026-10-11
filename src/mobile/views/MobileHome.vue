<script setup lang="ts">
/**
 * 首页（v3 Tab1）：按 .ai/项目资源/stock-board-mobile-home-tab-v3.html 版式
 *
 * 自上而下：navbar（股票看板+搜索）→ 金刚区 5×2（通栏）→ 指数条 → 成交额曲线
 * → 涨跌分布·市场情绪合并卡 → 今天炒什么。
 * - 金刚区：自选/今天炒什么/热点新闻/行情全景/市场榜单/板块日历 + 4 预留位（新模块补位）
 * - 成交额：fetchMarketTurnover 重接口拉一次 + 快照缓存；30/60/180 交易日本地切片；
 *   自研 SVG 折线（两市总额面积线 + 上证/深证），仿 MobilePanorama 轻量方案
 * - 涨跌分布·情绪：fetchAllMarketQuotes→countDistribution（8 桶）；
 *   涨停四池串行错峰→computeMarketSentiment；30s 前台轮询（useMobilePolling）
 * - 分区独立降级：指数/成交额/分布/情绪/热榜各自重试，互不阻塞
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchFullQuotes, fetchAllMarketQuotes } from '../../common/api/quotes.api';
import { fetchMarketTurnover } from '../../common/api/turnover.api';
import { fetchZtPool } from '../../common/api/event.api';
import { fetchHotBoard } from '../../common/api/hot-board.api';
import { INDEX_SYMBOLS } from '../../common/constants/index-symbols.constants';
import { TURNOVER_RANGE_DEFAULT } from '../../common/constants/turnover.constants';
import type { TurnoverRange } from '../../common/constants/turnover.constants';
import type { TurnoverDayItem } from '../../common/types/turnover.types';
import { countDistribution } from '../../common/utils/count-distribution';
import type { DistributionCount } from '../../common/types/distribution.types';
import { computeMarketSentiment } from '../../common/utils/compute-market-sentiment';
import type { MarketSentiment } from '../../common/types/market-sentiment.types';
import {
  BOARD_GROUPS,
  BOARD_SOURCE_LABELS,
  BOARD_SOURCE_ORDER,
} from '../../common/constants/hot-board.constants';
import type { BoardSource } from '../../common/constants/hot-board.constants';
import type { HotBoardItem } from '../../common/types/hot-board.types';
import type { FullQuote } from '../../common/types/stock-quote.types';
import { appStorage } from '../../common/utils/app-local-storage';
import { STORAGE_NS_MOBILE_BOARD_SETTINGS } from '../../common/constants/storage-key.constants';
import { mobileCacheGet, mobileCacheSet } from '../cache';
import { fetchIndustryBoards } from '../../common/api/board.api';
import type { HeatmapBoard } from '../../common/types/board.types';
import MobileHeatmap from '../components/MobileHeatmap.vue';
import { useMobilePolling } from '../composables/use-mobile-polling';

const router = useRouter();
const goTarget = (to: string): void => {
  void router.push(to);
};

/* === 金刚区（5×2：8 实位 + 2 预留，v3.1 稿；搜索入口在 navbar 不占格） ===
   v4.2.1：icon 换 Vant 线性图标（unicode 观感差）；移除自选 / 热点新闻（TabBar 已有入口）；
   连板 / 异动 / 龙虎榜独立榜页（/rank/:rank）与历史牛熊（/bull-review）为独立二级页。
   2026-10-11：tile 底改浅灰（--m-king-ic-bg），icon 改每项固定彩色（color 字段，不随主题） */
interface KingItem {
  icon: string;
  label: string;
  to: string;
  /** icon 固定彩色（2026-10-11 王总指定：彩色不随主题，亮暗同一套） */
  color: string;
}
const KING_ITEMS: readonly KingItem[] = [
  { icon: 'fire-o', label: '今天炒什么', to: '/board', color: '#f97316' },
  { icon: 'eye-o', label: '行情全景', to: '/panorama', color: '#0ea5e9' },
  { icon: 'chart-trending-o', label: '市场榜单', to: '/market-rank', color: '#8b5cf6' },
  { icon: 'calendar-o', label: '板块日历', to: '/board-calendar', color: '#3b82f6' },
  { icon: 'medal-o', label: '连板', to: '/rank/event', color: '#f59e0b' },
  { icon: 'bell', label: '异动', to: '/rank/events', color: '#ef4444' },
  { icon: 'flag-o', label: '龙虎榜', to: '/rank/dragon-tiger', color: '#ec4899' },
  { icon: 'replay', label: '历史牛熊', to: '/bull-review', color: '#10b981' },
];
/** 预留虚线位数量（后续新模块直接补位） */
const KING_TODO_COUNT = 2;

/* === 指数情绪条（一期 4 项：进入首页刷新一次，30s TTL） === */
const INDEX_LABELS: Record<string, string> = {
  sh000001: '上证指数',
  sz399001: '深证成指',
  sz399006: '创业板指',
  sh000688: '科创50',
};
interface IndexPill {
  code: string;
  name: string;
  price: number;
  changePct: number | null;
}
const indices = ref<IndexPill[]>([]);
const indicesError = ref(false);
const INDEX_TTL_MS = 30_000;
let indicesAt = 0;

const loadIndices = async (force = false): Promise<void> => {
  if (!force && Date.now() - indicesAt < INDEX_TTL_MS) return;
  try {
    const quotes: FullQuote[] = await fetchFullQuotes(INDEX_SYMBOLS);
    indices.value = quotes.map((q) => ({
      code: q.code,
      name: q.name || INDEX_LABELS[q.code] || q.code,
      price: q.price,
      changePct: q.changePercent,
    }));
    indicesError.value = false;
    indicesAt = Date.now();
  } catch {
    indicesError.value = true;
  }
};

/* === 成交额曲线：重接口拉一次 + 快照缓存；窗口本地切片 === */
const turnover = ref<TurnoverDayItem[]>([]);
const turnoverError = ref(false);
const turnoverLoading = ref(false);
const turnoverRange = ref<TurnoverRange>(TURNOVER_RANGE_DEFAULT);
const TURN_CACHE_KEY = 'home.turnover';

const loadTurnover = async (force = false): Promise<void> => {
  if (turnoverLoading.value) return;
  turnoverLoading.value = true;
  try {
    const cached = force ? null : mobileCacheGet<TurnoverDayItem[]>(TURN_CACHE_KEY);
    if (cached) {
      turnover.value = cached.value;
    } else {
      const list = await fetchMarketTurnover();
      turnover.value = list;
      mobileCacheSet(TURN_CACHE_KEY, list);
    }
    turnoverError.value = false;
  } catch {
    turnoverError.value = true;
  } finally {
    turnoverLoading.value = false;
  }
};

/** 当前窗口的逐日序列（亿元） */
const rangeDays = computed(() => turnover.value.slice(-turnoverRange.value));

/** y 轴刻度（亿元，取整千；3 线共域） */
const turnAxis = computed(() => {
  const days = rangeDays.value;
  if (days.length < 2) return null;
  const all = days.flatMap((d) => [d.totalAmount, d.shanghaiAmount, d.shenzhenAmount]).map((v) => v / 1e8);
  const rawMax = Math.max(...all);
  const rawMin = Math.min(...all);
  const span = rawMax - rawMin || 1;
  const unit = span > 4000 ? 2000 : span > 1500 ? 1000 : 500;
  const max = Math.ceil(rawMax / unit) * unit;
  const min = Math.floor((rawMin - span * 0.05) / unit) * unit;
  const ticks = [0, 1, 2, 3].map((i) => min + ((max - min) / 3) * i);
  return { max, min, ticks, days };
});

/** 3 条折线 path（0-100 归一视窗，preserveAspectRatio=none + non-scaling-stroke） */
const turnPaths = computed(() => {
  const axis = turnAxis.value;
  if (!axis) return [];
  const { max, min, days } = axis;
  const toPath = (pick: (d: TurnoverDayItem) => number): string =>
    days
      .map((d, i) => {
        const x = (i / (days.length - 1)) * 100;
        const y = 100 - ((pick(d) / 1e8 - min) / (max - min)) * 100;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  return [
    { key: 'total', color: 'var(--color-primary)', d: toPath((d) => d.totalAmount), area: true },
    { key: 'sh', color: '#f97316', d: toPath((d) => d.shanghaiAmount), area: false },
    { key: 'sz', color: '#22d3ee', d: toPath((d) => d.shenzhenAmount), area: false },
  ];
});

/** 最新一日图例（两市/上证/深证，亿元） */
const turnLegend = computed(() => {
  const last = rangeDays.value.at(-1);
  if (!last) return null;
  const yi = (v: number): string => Math.round(v / 1e8).toLocaleString();
  return { total: yi(last.totalAmount), sh: yi(last.shanghaiAmount), sz: yi(last.shenzhenAmount) };
});

/** y 轴刻度文案（亿 → 万亿）
 * @param v 刻度值（亿元）
 * @returns 展示文案 */
const fmtTickYi = (v: number): string => (v >= 10000 ? `${(v / 10000).toFixed(1)}万亿` : v.toLocaleString());

/* === 成交额图 crosshair + tooltip（HTML overlay：SVG 非均匀缩放会把圆点拉扁） === */
/** crosshair 悬停的交易日下标（null = 未悬停） */
const hoverIdx = ref<number | null>(null);
/** 图区容器（pointer 命中与坐标换算基准） */
const plotEl = ref<HTMLElement | null>(null);
/** 悬停点信息：x 位置、日期、三线数值（亿元）、较上日差额与圆点坐标 */
interface HoverPoint {
  x: number;
  date: string;
  total: string;
  sh: string;
  sz: string;
  /** 较上一交易日差额（亿元，放量 + / 缩量 −；首日无前值） */
  delta: string;
  /** 差额的涨跌配色类（m-up / m-down / m-flat） */
  deltaCls: string;
  dots: { k: string; x: number; y: number }[];
}
const hoverPoint = computed<HoverPoint | null>(() => {
  const axis = turnAxis.value;
  if (!axis || hoverIdx.value === null || axis.days.length < 2) return null;
  const i = Math.min(hoverIdx.value, axis.days.length - 1);
  const d = axis.days[i]!;
  const { max, min } = axis;
  const yOf = (v: number): number => 100 - ((v / 1e8 - min) / (max - min)) * 100;
  const x = (i / (axis.days.length - 1)) * 100;
  // 相对成交量（PC 市场总览同口径）：当日总成交额 − 上一交易日，放量 + / 缩量 −（亿元，1 位小数）
  const prev = i > 0 ? axis.days[i - 1]! : null;
  const deltaRaw = prev ? (d.totalAmount - prev.totalAmount) / 1e8 : null;
  return {
    x,
    date: d.date,
    total: Math.round(d.totalAmount / 1e8).toLocaleString(),
    sh: Math.round(d.shanghaiAmount / 1e8).toLocaleString(),
    sz: Math.round(d.shenzhenAmount / 1e8).toLocaleString(),
    delta: deltaRaw === null ? '--' : `${deltaRaw > 0 ? '+' : ''}${deltaRaw.toFixed(1)}`,
    deltaCls: deltaRaw === null || deltaRaw === 0 ? 'm-flat' : deltaRaw > 0 ? 'm-up' : 'm-down',
    dots: [
      { k: 'total', x, y: yOf(d.totalAmount) },
      { k: 'sh', x, y: yOf(d.shanghaiAmount) },
      { k: 'sz', x, y: yOf(d.shenzhenAmount) },
    ],
  };
});

/** 图上横移：换算最近交易日下标（touch-action: pan-y，垂直滚动不受影响）
 * @param e 指针移动事件 */
const onPlotMove = (e: PointerEvent): void => {
  const el = plotEl.value;
  const axis = turnAxis.value;
  if (!el || !axis || axis.days.length < 2) return;
  const rect = el.getBoundingClientRect();
  const pct = ((e.clientX - rect.left) / rect.width) * 100;
  const i = Math.round((pct / 100) * (axis.days.length - 1));
  hoverIdx.value = Math.max(0, Math.min(i, axis.days.length - 1));
};

/** 指针离开图区：收起 crosshair */
const onPlotLeave = (): void => {
  hoverIdx.value = null;
};

const onRangeChange = (days: TurnoverRange): void => {
  turnoverRange.value = days;
};

/* === 涨跌分布（全市场快照 → 8 桶；30s TTL 缓存 + 轮询） === */
const dist = ref<DistributionCount[]>([]);
const riseCount = ref(0);
const fallCount = ref(0);
const distError = ref(false);
const distLoading = ref(false);
const BREADTH_CACHE_KEY = 'home.breadth';

const loadBreadth = async (force = false): Promise<void> => {
  if (distLoading.value) return;
  distLoading.value = true;
  try {
    const cached = force ? null : mobileCacheGet<{ dist: DistributionCount[]; rise: number; fall: number }>(BREADTH_CACHE_KEY, 30_000);
    if (cached) {
      dist.value = cached.value.dist;
      riseCount.value = cached.value.rise;
      fallCount.value = cached.value.fall;
    } else {
      const quotes = await fetchAllMarketQuotes();
      const dist0 = countDistribution(quotes.map((q) => q.changePercent ?? 0));
      dist.value = dist0;
      riseCount.value = quotes.filter((q) => (q.changePercent ?? 0) > 0).length;
      fallCount.value = quotes.filter((q) => (q.changePercent ?? 0) < 0).length;
      mobileCacheSet(BREADTH_CACHE_KEY, { dist: dist0, rise: riseCount.value, fall: fallCount.value });
    }
    distError.value = false;
  } catch {
    distError.value = true;
  } finally {
    distLoading.value = false;
  }
};

/** 柱状几何（0-100 归一；8 桶均分横向，柱宽 8%，居中留缝） */
const distBars = computed(() => {
  const max = Math.max(...dist.value.map((d) => d.count), 1);
  return dist.value.map((d, i) => ({
    ...d,
    x: i * 12.5 + 2.25,
    w: 8,
    h: Math.max((d.count / max) * 100, d.count > 0 ? 1.2 : 0),
  }));
});

/* === 市场情绪（涨停四池串行错峰 → computeMarketSentiment；30s TTL） === */
const senti = ref<MarketSentiment | null>(null);
const sentiError = ref(false);
const sentiLoading = ref(false);
const SENTI_CACHE_KEY = 'home.sentiment';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const loadSenti = async (force = false): Promise<void> => {
  if (sentiLoading.value) return;
  sentiLoading.value = true;
  try {
    const cached = force ? null : mobileCacheGet<MarketSentiment>(SENTI_CACHE_KEY, 30_000);
    if (cached) {
      senti.value = cached.value;
    } else {
      // 串行错峰 500ms：与 PC 同口径，避免同上游连发限频
      const limitUp = await fetchZtPool('zt');
      await wait(500);
      const broken = await fetchZtPool('broken');
      await wait(500);
      const limitDown = await fetchZtPool('dt');
      await wait(500);
      const yesterdayZt = await fetchZtPool('yesterday');
      senti.value = computeMarketSentiment(limitUp, broken, limitDown, yesterdayZt);
      mobileCacheSet(SENTI_CACHE_KEY, senti.value);
    }
    sentiError.value = false;
  } catch {
    sentiError.value = true;
  } finally {
    sentiLoading.value = false;
  }
};

/** 分布 + 情绪并行刷新（各自独立降级，useMobilePolling 30s 档） */
const loadMarketPulse = async (): Promise<void> => {
  await Promise.all([loadBreadth(), loadSenti()]);
};
useMobilePolling(loadMarketPulse);

/* === 今天炒什么入口卡：主线 + Top5 预览（六平台榜单第一名口径，v2 稿沿用） === */
interface BoardCardState {
  source: BoardSource | null;
  mainline: string;
  top5: HotBoardItem[];
}
const boardCard = ref<BoardCardState>({ source: null, mainline: '', top5: [] });
const boardError = ref(false);

/** 与 MobileBoard 同口径读平台设置（顺序 + 显隐）
 * @returns 平台设置对象：order 为展示顺序，hidden 为隐藏平台列表 */
const readBoardSettings = (): { order: BoardSource[]; hidden: BoardSource[] } => {
  const raw = appStorage.getItem(STORAGE_NS_MOBILE_BOARD_SETTINGS);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<{ order: BoardSource[]; hidden: BoardSource[] }>;
      if (Array.isArray(parsed.order) && Array.isArray(parsed.hidden)) {
        return { order: parsed.order, hidden: parsed.hidden };
      }
    } catch {
      // 坏包回落默认
    }
  }
  return { order: [...BOARD_SOURCE_ORDER], hidden: [] };
};

const loadBoardCard = async (): Promise<void> => {
  try {
    const { order, hidden } = readBoardSettings();
    const source = order.find((key) => !hidden.includes(key)) ?? BOARD_SOURCE_ORDER[0]!;
    const group = BOARD_GROUPS[source][0]!.value;
    const items = await fetchHotBoard(source, group);
    boardCard.value = {
      source,
      mainline: items[0]?.name ?? '',
      top5: items.slice(0, 5),
    };
    boardError.value = false;
  } catch {
    boardError.value = true;
  }
};

/** 整页下拉刷新：全部分区并行重拉（强制越过缓存）
 * @returns 无返回值，finally 里复位 v-model 收起下拉状态 */
const refreshing = ref(false);
const onRefresh = async (): Promise<void> => {
  try {
    await Promise.all([loadIndices(true), loadTurnover(true), loadMarketPulse(), loadBoardCard(), loadHeat(true)]);
  } finally {
    refreshing.value = false;
  }
};

onMounted(() => {
  void loadIndices(true);
  void loadTurnover();
  void loadMarketPulse();
  void loadBoardCard();
  void loadHeat();
});

/* === 板块热力图（PC 市场总览同口径：总市值 Top 20，面积 = 市值，色 = 涨跌四档；30s TTL） === */
const heatBoards = ref<HeatmapBoard[]>([]);
const heatLoading = ref(false);
const heatError = ref(false);
const HEAT_CACHE_KEY = 'home.heatmap';

const loadHeat = async (force = false): Promise<void> => {
  if (heatLoading.value) return;
  heatLoading.value = true;
  try {
    const cached = force ? null : mobileCacheGet<{ boards: HeatmapBoard[] }>(HEAT_CACHE_KEY, 30_000);
    if (cached) {
      heatBoards.value = cached.value.boards;
    } else {
      const boards = (await fetchIndustryBoards())
        .filter((board) => board.changePercent !== null && board.totalMarketCap !== null)
        .sort((a, b) => (b.totalMarketCap ?? 0) - (a.totalMarketCap ?? 0))
        .slice(0, 20)
        .map((board) => ({
          code: board.code,
          name: board.name,
          changePercent: board.changePercent ?? 0,
          weight: board.totalMarketCap ?? 0,
        }));
      heatBoards.value = boards;
      mobileCacheSet(HEAT_CACHE_KEY, { boards });
    }
    heatError.value = false;
  } catch {
    if (heatBoards.value.length === 0) heatError.value = true;
  } finally {
    heatLoading.value = false;
  }
};

/* === 格式化 === */
const fmtPrice = (v: number): string => v.toFixed(2);
const fmtPct = (v: number | null): string =>
  v === null ? '--' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const pctClass = (v: number | null): string =>
  v === null || v === 0 ? 'm-flat' : v > 0 ? 'm-up' : 'm-down';
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar title="股票看板" class="m-nav" safe-area-inset-top>
      <template #right>
        <van-icon name="search" size="19" @click="router.push('/search')" />
      </template>
    </van-nav-bar>

    <!-- 整页下拉刷新（面板内滚动 + PullRefresh 宿主结构，与 news/board 同构） -->
    <van-pull-refresh v-model="refreshing" class="m-home-scroll" @refresh="onRefresh">
      <!-- 1. 金刚区 5×2（通栏贴边，v3 稿） -->
      <div class="m-home-king">
        <div
          v-for="item in KING_ITEMS"
          :key="item.label"
          class="m-home-king__item"
          @click="goTarget(item.to)"
        >
          <span class="m-home-king__ic"><van-icon :name="item.icon" :style="{ color: item.color }" /></span>
          <span class="m-home-king__name">{{ item.label }}</span>
        </div>
        <div v-for="n in KING_TODO_COUNT" :key="`todo-${n}`" class="m-home-king__item m-home-king__item--todo">
          <span class="m-home-king__ic">＋</span>
          <span class="m-home-king__name">预留</span>
        </div>
      </div>

      <!-- 2. 指数情绪条（沿用现样式） -->
      <div class="m-home-index-bar">
        <template v-if="indices.length > 0">
          <div v-for="item in indices" :key="item.code" class="m-home-index">
            <div class="m-home-index__name">{{ item.name }}</div>
            <div class="m-home-index__px" :class="pctClass(item.changePct)">
              {{ fmtPrice(item.price) }}
            </div>
            <div class="m-home-index__pct" :class="pctClass(item.changePct)">
              {{ fmtPct(item.changePct) }}
            </div>
          </div>
        </template>
        <div v-else-if="indicesError" class="m-home-err-box m-home-err-box--idx">
          <van-icon name="warning-o" />
          指数加载失败
          <span class="retry" @click="loadIndices(true)">重试</span>
        </div>
        <div v-for="n in 4" v-else :key="n" class="m-home-index m-home-index--skeleton">
          <van-skeleton title :row="1" :loading="true" />
        </div>
      </div>

      <!-- 3. 成交额曲线（240px，PC 市场总览口径） -->
      <div class="m-home-sec">
        <span class="m-home-sec__t">成交额</span>
        <span class="m-home-sec__s">单位：亿元</span>
      </div>
      <div class="m-home-panel">
        <div v-if="turnoverError" class="m-home-err-box m-home-err-box--turn">
          <van-icon name="warning-o" />
          成交额加载失败
          <span class="retry" @click="loadTurnover(true)">重试</span>
        </div>
        <template v-else-if="turnPaths.length > 0">
          <div class="m-home-panel__head">
            <span class="m-home-panel__t">近 {{ turnoverRange }} 日成交额</span>
            <div class="m-home-chips">
              <button
                v-for="(label, days) in { 30: '30日', 60: '60日', 180: '180日' }"
                :key="days"
                class="m-home-chip"
                :class="{ on: turnoverRange === Number(days) }"
                @click="onRangeChange(Number(days) as TurnoverRange)"
              >
                {{ label }}
              </button>
            </div>
          </div>
          <div v-if="turnLegend" class="m-home-legend">
            <span><i class="lg" style="background: var(--color-primary)"></i>两市 <b>{{ turnLegend.total }}</b></span>
            <span><i class="lg" style="background: #f97316"></i>上证 <b>{{ turnLegend.sh }}</b></span>
            <span><i class="lg" style="background: #22d3ee"></i>深证 <b>{{ turnLegend.sz }}</b></span>
          </div>
          <div class="m-home-chart">
            <div class="m-home-chart__y">
              <span v-for="tick in (turnAxis?.ticks ?? []).slice().reverse()" :key="tick">{{ fmtTickYi(tick) }}</span>
            </div>
            <div
              ref="plotEl"
              class="m-home-chart__plot"
              @pointermove="onPlotMove"
              @pointerdown="onPlotMove"
              @pointerleave="onPlotLeave"
              @pointercancel="onPlotLeave"
            >
              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                <g stroke="rgba(140,152,155,.14)" stroke-width="1" vector-effect="non-scaling-stroke">
                  <line x1="0" y1="0" x2="100" y2="0" vector-effect="non-scaling-stroke" />
                  <line x1="0" y1="33.33" x2="100" y2="33.33" vector-effect="non-scaling-stroke" />
                  <line x1="0" y1="66.66" x2="100" y2="66.66" vector-effect="non-scaling-stroke" />
                  <line x1="0" y1="100" x2="100" y2="100" vector-effect="non-scaling-stroke" />
                </g>
                <path
                  v-for="line in turnPaths.filter((l) => l.area)"
                  :key="`${line.key}-area`"
                  :d="`${line.d} L100,100 L0,100 Z`"
                  fill="var(--color-primary)"
                  opacity="0.06"
                />
                <path
                  v-for="line in turnPaths"
                  :key="line.key"
                  :d="line.d"
                  fill="none"
                  :stroke="line.color"
                  stroke-width="1.6"
                  vector-effect="non-scaling-stroke"
                  stroke-linejoin="round"
                  :opacity="line.area ? 1 : 0.9"
                />
              </svg>
              <!-- crosshair overlay：竖线 + 三线圆点 + 数值浮层 -->
              <template v-if="hoverPoint">
                <div class="m-home-cross" :style="{ left: `${hoverPoint.x}%` }"></div>
                <span
                  v-for="dot in hoverPoint.dots"
                  :key="dot.k"
                  class="m-home-dot"
                  :class="dot.k"
                  :style="{ left: `${dot.x}%`, top: `${dot.y}%` }"
                ></span>
                <div
                  class="m-home-tip"
                  :class="hoverPoint.x > 55 ? 'm-home-tip--r' : 'm-home-tip--l'"
                  :style="{ left: `${hoverPoint.x}%` }"
                >
                  <div class="m-home-tip__d">{{ hoverPoint.date.slice(5) }}</div>
                  <div class="m-home-tip__row"><i class="lg" style="background: var(--color-primary)"></i>两市<b>{{ hoverPoint.total }}亿</b></div>
                  <div class="m-home-tip__row"><i class="lg" style="background: #f97316"></i>上证<b>{{ hoverPoint.sh }}亿</b></div>
                  <div class="m-home-tip__row"><i class="lg" style="background: #22d3ee"></i>深证<b>{{ hoverPoint.sz }}亿</b></div>
                  <div class="m-home-tip__row"><i class="lg" style="background: transparent"></i>较上日<b :class="hoverPoint.deltaCls">{{ hoverPoint.delta }}亿</b></div>
                </div>
              </template>
            </div>
          </div>
          <div v-if="turnAxis" class="m-home-chart__x">
            <span>{{ turnAxis.days[0]!.date.slice(5) }}</span>
            <span>{{ turnAxis.days.at(-1)!.date.slice(5) }}</span>
          </div>
        </template>
        <div v-else class="m-home-panel__skel">
          <van-skeleton title :row="4" :loading="true" />
        </div>
      </div>

      <!-- 4. 涨跌分布 · 市场情绪（合并卡，PC 市场总览口径） -->
      <div class="m-home-sec">
        <span class="m-home-sec__t">涨跌分布 · 市场情绪</span>
        <span class="m-home-sec__s">全市场 A 股 · 30s 轮询</span>
      </div>
      <div class="m-home-panel">
        <div v-if="distError" class="m-home-err-box m-home-err-box--dist">
          <van-icon name="warning-o" />
          涨跌分布加载失败
          <span class="retry" @click="loadBreadth(true)">重试</span>
        </div>
        <template v-else-if="distBars.length > 0">
          <div class="m-home-dist-head">
            <span class="m-home-panel__t">今日涨跌分布</span>
            <div class="m-home-dist-cnt">
              <span class="m-up">上涨 <b>{{ riseCount.toLocaleString() }}</b> 家</span>
              <span class="m-down">下跌 <b>{{ fallCount.toLocaleString() }}</b> 家</span>
            </div>
          </div>
          <div class="m-home-dist">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <g stroke="rgba(140,152,155,.14)" stroke-width="1">
                <line x1="0" y1="0" x2="100" y2="0" vector-effect="non-scaling-stroke" />
                <line x1="0" y1="50" x2="100" y2="50" vector-effect="non-scaling-stroke" />
                <line x1="0" y1="100" x2="100" y2="100" vector-effect="non-scaling-stroke" />
              </g>
              <rect
                v-for="bar in distBars"
                :key="bar.key"
                :x="bar.x"
                :y="100 - bar.h"
                :width="bar.w"
                :height="bar.h"
                rx="1"
                :fill="bar.color"
                opacity="0.88"
              />
            </svg>
          </div>
          <div class="m-home-dist__labels">
            <span v-for="bar in distBars" :key="`lb-${bar.key}`">{{ bar.label }}</span>
          </div>
        </template>
        <div v-else class="m-home-panel__skel">
          <van-skeleton title :row="4" :loading="true" />
        </div>

        <!-- 市场情绪：图下小字提示行 + 连板梯队药丸 -->
        <div v-if="sentiError" class="m-home-err-box m-home-err-box--senti">
          <van-icon name="warning-o" />
          情绪数据加载失败
          <span class="retry" @click="loadSenti(true)">重试</span>
        </div>
        <template v-else-if="senti">
          <div class="m-home-senti-line">
            <span>涨停 <b class="m-up">{{ senti.limitUpCount }}</b></span><i>/</i>
            <span>跌停 <b class="m-down">{{ senti.limitDownCount }}</b></span><i>/</i>
            <span>炸板 <b>{{ senti.brokenCount }}</b>{{ senti.brokenRate === null ? '' : `（${senti.brokenRate.toFixed(0)}%）` }}</span><i>/</i>
            <span>最高连板 <b class="m-up">{{ senti.maxLadder }}</b> 板</span><i>/</i>
            <span>昨涨停均涨 <b :class="pctClass(senti.yesterdayZtAvgPct)">{{ fmtPct(senti.yesterdayZtAvgPct) }}</b></span>
          </div>
          <div v-if="senti.ladder.length > 0" class="m-home-ladder">
            <span
              v-for="step in senti.ladder"
              :key="step.board"
              class="m-home-lad"
              :class="{ hot: step.board >= 3 }"
            >
              {{ step.board === 1 ? '首板' : `${step.board}板` }} · {{ step.count }} 家
            </span>
          </div>
        </template>
        <div v-else class="m-home-panel__skel">
          <van-skeleton title :row="2" :loading="true" />
        </div>
      </div>

      <!-- 4.5 板块热力图（PC 市场总览同款口径：面积 = 总市值，固定 Top 20，颜色随涨跌四档色阶） -->
      <div class="m-home-sec">
        <span class="m-home-sec__t">板块热力</span>
        <span class="m-home-sec__s">Top 20 · 面积 = 总市值</span>
      </div>
      <div class="m-card m-home-heat">
        <MobileHeatmap :boards="heatBoards" :loading="heatLoading" :error="heatError" />
        <div v-if="heatError" class="m-state">
          <span class="retry" @click="loadHeat(true)">重试</span>
        </div>
      </div>

      <!-- 5. 今天炒什么（保留现状，压轴） -->
      <div class="m-home-sec">
        <span class="m-home-sec__t">今天炒什么</span>
        <span class="m-home-sec__s">热度主线 · Top5 预览</span>
      </div>
      <div v-if="boardError" class="m-home-err-box m-home-err-box--board">
        <van-icon name="warning-o" />
        榜单加载失败
        <span class="retry" @click="loadBoardCard()">重试</span>
      </div>
      <div v-else-if="boardCard.top5.length === 0" class="m-home-board-card">
        <van-skeleton title :row="3" :loading="true" />
      </div>
      <div v-else class="m-home-board-card" @click="goTarget('/board')">
        <div class="m-home-board-card__head">
          <span class="m-home-board-card__badge">
            {{ boardCard.source ? BOARD_SOURCE_LABELS[boardCard.source] : '' }}
          </span>
          <span class="m-home-board-card__more">查看更多 ›</span>
        </div>
        <div
          v-for="(item, i) in boardCard.top5"
          :key="item.code"
          class="m-home-board-row"
          @click.stop="goTarget('/board')"
        >
          <span class="m-home-board-row__rank" :class="{ top: i === 0 }">{{ i + 1 }}</span>
          <span class="m-home-board-row__nm">
            {{ item.name }}<span class="code">{{ item.code }}</span>
          </span>
          <span class="m-home-board-row__heat">{{ item.heatLabel }}</span>
          <span class="m-home-board-row__pct" :class="pctClass(item.changePct)">
            {{ fmtPct(item.changePct) }}
          </span>
        </div>
      </div>

      <!-- 底部让位（悬浮 TabBar + 手势区，DESIGN-MOBILE.md §2.1） -->
      <div class="m-home-tail"></div>
    </van-pull-refresh>
  </div>
</template>
