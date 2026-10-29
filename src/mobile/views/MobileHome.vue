<script setup lang="ts">
/**
 * 首页（v3 Tab1）：按 .ai/项目资源/stock-board-mobile-home-tab-v3.html 版式
 *
 * 自上而下：navbar（股票看板+搜索）→ 金刚区 5×2（通栏）→ 成交额曲线
 * → 涨跌分布·市场情绪合并卡 → 板块热力。
 * 2026-10-20：指数模块与金刚区四项（今天炒什么/连板/异动/龙虎榜）迁至新行情 Tab
 * （MobileQuote，/quote）；资金流向自 TabBar 移出改入金刚区；大盘评级与今天炒什么
 * 两卡迁至行情页平铺，板块热力自行情页迁回（王总指定两模块互换）。
 * - 金刚区：行情全景/板块日历/历史牛熊/(次)新股/个股行情/资金流向（显隐排序可设置；
 *   2026-10-20 盘面雷达（原市场榜单）亦迁至行情页金刚区）
 * - 成交额：fetchMarketTurnover 重接口拉一次 + 快照缓存；30/60/180 交易日本地切片；
 *   自研 SVG 折线（两市总额面积线 + 上证/深证），仿 MobilePanorama 轻量方案
 * - 涨跌分布·情绪：fetchAllMarketQuotes→countDistribution（8 桶）；
 *   涨停四池串行错峰→computeMarketSentiment；30s 前台轮询（useMobilePolling）
 * - 分区独立降级：成交额/分布/情绪/热榜各自重试，互不阻塞
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showFailToast } from 'vant';
import { VueDraggable } from 'vue-draggable-plus';
import { fetchAllMarketQuotes } from '../../common/api/quotes.api';
import { fetchMarketTurnover } from '../../common/api/turnover.api';
import { fetchZtPool } from '../../common/api/event.api';
import { fetchIndustryConstituents } from '../../common/api/board.api';
import { fetchCalendarBoardPanorama } from '../../common/api/board-calendar.api';
import { HEATMAP_DRILL_STOCK_COUNT } from '../../common/constants/heatmap.constants';
import { toFullSymbol } from '../../common/utils/to-full-symbol';
import {
  CHART_LINE_BLUE,
  CHART_LINE_GREEN,
  CHART_LINE_PURPLE,
} from '../../common/constants/chart.constants';
import type { TurnoverDayItem } from '../../common/types/turnover.types';
import type { HeatmapBoard } from '../../common/types/board.types';
import type { IndustryBoardConstituent } from 'stock-sdk';
import { countDistribution } from '../../common/utils/count-distribution';
import type { DistributionCount } from '../../common/types/distribution.types';
import { computeMarketSentiment } from '../../common/utils/compute-market-sentiment';
import type { MarketSentiment } from '../../common/types/market-sentiment.types';
import { appStorage } from '../../common/utils/app-local-storage';
import { STORAGE_NS_MOBILE_KING_SETTINGS } from '../../common/constants/storage-key.constants';
import { mobileCacheGet, mobileCacheSet } from '../cache';
import { MOBILE_TURNOVER_RANGE_DEFAULT, MOBILE_TURNOVER_RANGES } from '../constants';
import { useMobilePolling } from '../composables/use-mobile-polling';
import MobileHeatmap from '../components/MobileHeatmap.vue';
import ArmsSparkline from '../components/ArmsSparkline.vue';
import { ingestBreadthSnapshot, readBreadthDay } from '../../common/api/market-breadth-db.api';
import type { MarketBreadth, BreadthPoint } from '../../common/types/market-breadth.types.ts';
import { classifyArms } from '../../common/utils/classify-arms';
import { toDayKey } from '../../common/utils/to-day-key';
import { fetchThsTurnoverDay, fetchThsTurnoverMinute } from '../../common/api/ths-market-analysis.api.ts';
import { computeTurnoverAverage5 } from '../../common/utils/compute-turnover-averages';
import { formatAmount } from '../../common/utils/format-amount';
import { formatYuanWithSign } from '../../common/utils/format-yuan';
import type { ThsTurnoverDay, ThsTurnoverMinute } from '../../common/types/ths-market.types.ts';

const router = useRouter();
const goTarget = (to: string): void => {
  void router.push(to);
};

/* === 金刚区（5×2：入口数动态，v3.1 稿；搜索入口在 navbar 不占格） ===
   v4.2.1：icon 换 Vant 线性图标（unicode 观感差）；移除自选 / 热点新闻（TabBar 已有入口）；
   连板 / 异动 / 龙虎榜独立榜页（/rank/:rank）与历史牛熊（/bull-review）为独立二级页。
   2026-10-11：tile 底改浅灰（--m-king-ic-bg），icon 改每项固定彩色（color 字段，不随主题）；
   2026-10-12：新股次新股自行情全景拆出独立页（/ipo）补位；「新股」更名「(次)新股」；
   长按任意 tile 弹出入口设置（显隐 + 排序，参考热点新闻源设置，超 10 入口时用户自行取舍）
   2026-10-20：今天炒什么 / 连板 / 异动 / 龙虎榜迁出行情页金刚区（首页不再展示）；
   资金流向自 TabBar 移出后改入金刚区（/fund-flow 二级页） */
interface KingItem {
  icon: string;
  label: string;
  to: string;
  /** icon 固定彩色（2026-10-11 王总指定：彩色不随主题，亮暗同一套） */
  color: string;
}
/** 金刚区全部候选入口（key = to 路由路径，唯一）；显隐/顺序由用户设置持久化决定 */
const KING_ITEMS: readonly KingItem[] = [
  { icon: 'eye-o', label: '行情全景', to: '/panorama', color: '#0ea5e9' },
  { icon: 'calendar-o', label: '板块日历', to: '/board-calendar', color: '#3b82f6' },
  { icon: 'replay', label: '历史牛熊', to: '/bull-review', color: '#10b981' },
  { icon: 'gem-o', label: '(次)新股', to: '/ipo', color: '#eab308' },
  // 个股行情（2026-10-13 新增；icon 固定彩色不随主题）
  { icon: 'bars', label: '个股行情', to: '/stock-market', color: '#14b8a6' },
  // 资金流向（2026-10-20 自 TabBar 移出改入金刚区）
  { icon: 'gold-coin-o', label: '资金流向', to: '/fund-flow', color: '#0e9488' },
  // 机构行为 / 市场宽度（2026-10-29 下线：PC 侧转插件分发，移动端无插件体系不再提供）
  // 行业龙头（2026-10-29 新增；PC 行情全景-行业龙头模块移动版：板块/细分赛道固定清单 + 报价）
  { icon: 'medal-o', label: '行业龙头', to: '/industry-leaders', color: '#ef4444' },
];
/** to → 定义（设置弹窗行渲染 / 持久化序回填用） */
const KING_BY_TO = new Map(KING_ITEMS.map((item) => [item.to, item]));

/** 金刚区入口设置持久化形态（order 全量序 / hidden 隐藏集合），与新闻源设置同构 */
interface KingSettings {
  order: string[];
  hidden: string[];
}

const readKingSettings = (): KingSettings => {
  const raw = appStorage.getItem(STORAGE_NS_MOBILE_KING_SETTINGS);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<KingSettings>;
      if (Array.isArray(parsed.order) && Array.isArray(parsed.hidden)) {
        // 未知 key 剔除、新入口按默认序补尾（版本升级后 defs 增删的兜底）
        const known = parsed.order.filter((to) => KING_BY_TO.has(to));
        for (const item of KING_ITEMS) {
          if (!known.includes(item.to)) known.push(item.to);
        }
        return { order: known, hidden: parsed.hidden.filter((to) => KING_BY_TO.has(to)) };
      }
    } catch {
      // 坏包回落默认
    }
  }
  return { order: KING_ITEMS.map((item) => item.to), hidden: [] };
};

const kingSettings = reactive<KingSettings>(readKingSettings());

const persistKingSettings = (): void => {
  appStorage.setItem(
    STORAGE_NS_MOBILE_KING_SETTINGS,
    JSON.stringify({ order: kingSettings.order, hidden: kingSettings.hidden }),
  );
};

/** 可见入口（隐藏项不渲染；顺序 = 设置调整后的持久化序） */
const visibleKingItems = computed<KingItem[]>(() =>
  kingSettings.order
    .filter((to) => !kingSettings.hidden.includes(to))
    .map((to) => KING_BY_TO.get(to))
    .filter((item): item is KingItem => item !== undefined),
);

/** 预留虚线位：补齐 5×2 版面（入口满 10 个时为 0） */
const kingTodoCount = computed(() => Math.max(0, 10 - visibleKingItems.value.length));

/* --- 金刚区设置弹窗（长按 tile 打开；桌面浏览器右键同开，便于调试） --- */
const kingSettingsOpen = ref(false);

/**
 * 入口显隐开关（至少保留一个入口）
 * @param to 入口路由路径
 * @param visible true 显示，false 隐藏
 */
const toggleKing = (to: string, visible: boolean): void => {
  const nextHidden = new Set(kingSettings.hidden);
  if (visible) {
    nextHidden.delete(to);
  } else {
    if (kingSettings.order.length - nextHidden.size <= 1) {
      showFailToast('至少保留一个入口');
      return;
    }
    nextHidden.add(to);
  }
  kingSettings.hidden = [...nextHidden];
  persistKingSettings();
};

/* --- 长按手势（pointer 事件统一覆盖触屏长按与桌面按住；阈值 500ms，位移 >10px 视为滚动取消） --- */
const KING_LONG_PRESS_MS = 500;
let kingPressTimer: number | null = null;
let kingPressStart: { x: number; y: number } | null = null;
/** 长按已触发标记：吞掉长按后 pointerup 派生的 click，避免弹窗打开同时跳页 */
let kingLongPressFired = false;

const clearKingPress = (): void => {
  if (kingPressTimer !== null) {
    clearTimeout(kingPressTimer);
    kingPressTimer = null;
  }
  kingPressStart = null;
};

/** tile 按下：启动长按计时
 * @param e 指针按下事件（记录起点坐标，供移动阈值判定） */
const onKingPressStart = (e: PointerEvent): void => {
  clearKingPress();
  kingLongPressFired = false;
  kingPressStart = { x: e.clientX, y: e.clientY };
  kingPressTimer = window.setTimeout(() => {
    kingPressTimer = null;
    kingLongPressFired = true;
    kingSettingsOpen.value = true;
  }, KING_LONG_PRESS_MS);
};

/** tile 抬起 / 取消：停表（长按已触发的场景由 click 兜底吞掉跳页） */
const onKingPressEnd = (): void => {
  clearKingPress();
};

/** tile 移动：超过阈值判定为滚动/拖动，取消长按
 * @param e 指针移动事件 */
const onKingPressMove = (e: PointerEvent): void => {
  if (!kingPressStart) return;
  const dx = e.clientX - kingPressStart.x;
  const dy = e.clientY - kingPressStart.y;
  if (dx * dx + dy * dy > 100) clearKingPress();
};

/**
 * tile 点击跳页（长按触发过的当次点击吞掉）
 * @param to 入口路由路径
 */
const goTile = (to: string): void => {
  if (kingLongPressFired) {
    kingLongPressFired = false;
    return;
  }
  goTarget(to);
};

/* === 指数模块已迁至行情页 MobileQuote（2026-10-20 王总指定；首页金刚区四项同步迁出） === */

/* === 成交额曲线：重接口拉一次 + 快照缓存；窗口本地切片 === */
const turnover = ref<TurnoverDayItem[]>([]);
const turnoverError = ref(false);
const turnoverLoading = ref(false);
const turnoverRange = ref<number>(MOBILE_TURNOVER_RANGE_DEFAULT);
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
    // 固定配色 蓝/绿/紫（2026-10-13 王总：成交额曲线不随主题变化，常量同 PC TurnoverTrendChart）
    { key: 'total', color: CHART_LINE_BLUE, d: toPath((d) => d.totalAmount), area: true },
    { key: 'sh', color: CHART_LINE_GREEN, d: toPath((d) => d.shanghaiAmount), area: false },
    { key: 'sz', color: CHART_LINE_PURPLE, d: toPath((d) => d.shenzhenAmount), area: false },
  ];
});

/** 最新一日图例（两市/上证/深证，亿元） */
const turnLegend = computed(() => {
  const last = rangeDays.value.at(-1);
  if (!last) return null;
  const yi = (v: number): string => Math.round(v / 1e8).toLocaleString();
  return { total: yi(last.totalAmount), sh: yi(last.shanghaiAmount), sz: yi(last.shenzhenAmount) };
});

/** 逐日常驻数据点（三线全画，与 PC TurnoverTrendChart showSymbol 同口径；
 * 用 HTML overlay 而非 SVG circle——图区 preserveAspectRatio=none 会把圆拉扁，
 * 与 crosshair 圆点同方案） */
const turnDots = computed(() => {
  const axis = turnAxis.value;
  if (!axis) return [];
  const { max, min, days } = axis;
  const yOf = (v: number): number => 100 - ((v / 1e8 - min) / (max - min)) * 100;
  return days.flatMap((d, i) => {
    const x = (i / (days.length - 1)) * 100;
    return [
      { k: 'total', x, y: yOf(d.totalAmount) },
      { k: 'sh', x, y: yOf(d.shanghaiAmount) },
      { k: 'sz', x, y: yOf(d.shenzhenAmount) },
    ];
  });
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

/**
 * 切换成交额窗口（移动端 10/30/60 交易日；PC 市场总览的 30/60/180 不受影响）
 * @param days 目标窗口（交易日数）
 */
const onRangeChange = (days: number): void => {
  turnoverRange.value = days;
};

/* === 实时成交额（同花顺 dq 域，同时刻环比后端直出；30s TTL + 随脉冲轮询） === */
const rtMinute = ref<ThsTurnoverMinute | null>(null);
const rtDay = ref<ThsTurnoverDay | null>(null);
const rtError = ref(false);
const RT_CACHE_KEY = 'home.thsRealtime';
let rtLoading = false;

/**
 * 元 → 万（formatAmount 入参口径：万）
 * @param v 金额原值（元；null 透传）
 * @returns 万为单位的金额；null 透传
 */
const toWan = (v: number | null): number | null => (v === null ? null : v / 1e4);

const loadRealtime = async (force = false): Promise<void> => {
  if (rtLoading) return;
  rtLoading = true;
  try {
    const cached = force ? null : mobileCacheGet<{ minute: ThsTurnoverMinute; day: ThsTurnoverDay }>(RT_CACHE_KEY, 30_000);
    if (cached) {
      rtMinute.value = cached.value.minute;
      rtDay.value = cached.value.day;
    } else {
      const [minute, day] = await Promise.all([fetchThsTurnoverMinute(), fetchThsTurnoverDay()]);
      rtMinute.value = minute;
      rtDay.value = day;
      mobileCacheSet(RT_CACHE_KEY, { minute, day });
    }
    rtError.value = false;
  } catch {
    rtError.value = true;
  } finally {
    rtLoading = false;
  }
};

/** 今日实时成交额文案 */
const rtRealtimeText = computed(() => {
  const wan = toWan(rtMinute.value?.turnover ?? null);
  return wan === null ? '--' : formatAmount(wan);
});
/** 较上一日（同时刻环比） */
const rtChangeText = computed(() => formatYuanWithSign(rtMinute.value?.turnoverChange ?? null));
const rtChangeCls = computed(() => {
  const v = rtMinute.value?.turnoverChange;
  if (v === null || v === undefined || v === 0) return 'm-flat';
  return v > 0 ? 'm-up' : 'm-down';
});
/** 预测全天 */
const rtPredictText = computed(() => {
  const wan = toWan(rtMinute.value?.predictTurnover ?? null);
  return wan === null ? '--' : formatAmount(wan);
});
/** 5 日均（本地近 5 条平均） */
const rtAvg5Text = computed(() => {
  const avg = rtDay.value ? computeTurnoverAverage5(rtDay.value.points) : null;
  const wan = toWan(avg);
  return wan === null ? '--' : formatAmount(wan);
});
/** 60 日均（后端直出） */
const rtAvg60Text = computed(() => {
  const wan = toWan(rtDay.value?.averageTurnover ?? null);
  return wan === null ? '--' : formatAmount(wan);
});
/** 较 5 日均 */
const rtVsAvg5 = computed(() => {
  const realtime = rtMinute.value?.turnover ?? null;
  const avg = rtDay.value ? computeTurnoverAverage5(rtDay.value.points) : null;
  if (realtime === null || avg === null || avg === 0) return null;
  const pct = ((realtime - avg) / avg) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
});
const rtVsAvg5Cls = computed(() => {
  const realtime = rtMinute.value?.turnover ?? null;
  const avg = rtDay.value ? computeTurnoverAverage5(rtDay.value.points) : null;
  if (realtime === null || avg === null) return 'm-flat';
  return realtime >= avg ? 'm-up' : 'm-down';
});

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
      // 市场宽度 · ARMS：与涨跌分布同源快照，ingest 落分钟点 / 收盘定稿日 bar（零新增请求）
      breadth.value = ingestBreadthSnapshot(quotes);
      armsSeries.value = readBreadthDay(toDayKey(Date.now()));
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

/* === 市场宽度 · ARMS（与涨跌分布同源快照；分时序列本地按日积累） === */
const breadth = ref<MarketBreadth | null>(null);
const armsSeries = ref<BreadthPoint[]>([]);
const armsState = computed(() => classifyArms(breadth.value?.arms ?? null));
const armsText = computed(() => (breadth.value?.arms == null ? '--' : breadth.value!.arms!.toFixed(2)));
const armsTone = computed(() => armsState.value?.tone ?? 'flat');
const armsLabel = computed(() => armsState.value?.label ?? '--');

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

/** 分布 + 情绪 + 实时成交额并行刷新（各自独立降级，useMobilePolling 30s 档） */
const loadMarketPulse = async (): Promise<void> => {
  await Promise.all([loadBreadth(), loadSenti(), loadRealtime()]);
};
useMobilePolling(loadMarketPulse);

/* === 板块热力图（自行情页迁回，2026-10-20 王总指定两模块互换；
       2026-10-29 起换 36 板块统一池（板块日历 CALENDAR_BOARDS）：成交额 Top 10，
       面积 = 成交额，色 = 涨跌四档；30s TTL） === */
const heatBoards = ref<HeatmapBoard[]>([]);
const heatLoading = ref(false);
const heatError = ref(false);
const HEAT_CACHE_KEY = 'home.heatmap';

/** 热力图展示格数（36 板块池内按成交额取前 10，手机屏 treemap 过多格可读性差） */
const HOME_HEAT_BOARD_COUNT = 10;

const loadHeat = async (force = false): Promise<void> => {
  if (heatLoading.value) return;
  heatLoading.value = true;
  try {
    const cached = force ? null : mobileCacheGet<{ boards: HeatmapBoard[] }>(HEAT_CACHE_KEY, 30_000);
    if (cached) {
      heatBoards.value = cached.value.boards;
    } else {
      const boards = (await fetchCalendarBoardPanorama())
        .sort((a, b) => b.amount - a.amount)
        .slice(0, HOME_HEAT_BOARD_COUNT)
        .map((board) => ({
          code: board.code,
          name: board.name,
          changePercent: board.changePercent,
          weight: board.amount,
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

/* === 板块热力下钻：成分股弹窗（对齐 PC 下钻口径：按成交额 Top 30；重接口仅点击触发，不缓存） === */
const consOpen = ref(false);
const consBoard = ref<HeatmapBoard | null>(null);
const consLoading = ref(false);
const consError = ref(false);
const consRows = ref<IndustryBoardConstituent[]>([]);

/**
 * 点击热力图板块格子 → 弹出成分股列表
 * @param board 目标板块
 */
const openConstituents = async (board: HeatmapBoard): Promise<void> => {
  if (consLoading.value) return;
  consBoard.value = board;
  consOpen.value = true;
  consLoading.value = true;
  consError.value = false;
  consRows.value = [];
  try {
    // 与 PC useHeatmapDrill 同口径：过滤无效值 → 成交额降序 → Top 30
    consRows.value = (await fetchIndustryConstituents(board.code))
      .filter((item) => item.changePercent !== null && (item.amount ?? 0) > 0)
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
      .slice(0, HEATMAP_DRILL_STOCK_COUNT);
  } catch {
    consError.value = true;
  } finally {
    consLoading.value = false;
  }
};

/**
 * 成分股行点击 → 个股详情页（code 为 6 位纯代码，归一化为 sh/sz 完整符号）
 * @param code 成分股 6 位代码
 */
const goConstituent = (code: string): void => {
  const symbol = toFullSymbol(code);
  if (symbol) void router.push(`/stock/${symbol}`);
};

/** 整页下拉刷新：全部分区并行重拉（强制越过缓存）
 * @returns 无返回值，finally 里复位 v-model 收起下拉状态 */
const refreshing = ref(false);
const onRefresh = async (): Promise<void> => {
  try {
    await Promise.all([loadTurnover(true), loadMarketPulse(), loadHeat(true)]);
  } finally {
    refreshing.value = false;
  }
};

onMounted(() => {
  void loadTurnover();
  void loadMarketPulse();
  void loadHeat();
});

/* === 大盘评级与今天炒什么已迁至行情页 MobileQuote（2026-10-20 王总指定，板块热力回迁首页） === */

/* === 格式化 === */
/**
 * 最新价文案（两位小数）
 * @param v 价格
 * @returns 形如 `12.34`
 */
const fmtPrice = (v: number): string => v.toFixed(2);
/**
 * 成交额（元）→ 亿元文案
 * @param v 成交额（元；null 显示 `--`）
 * @returns 形如 `12.34亿`
 */
const fmtAmountYi = (v: number | null): string =>
  v === null ? '--' : `${(v / 1e8).toFixed(2)}亿`;
const fmtPct = (v: number | null): string =>
  v === null ? '--' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const pctClass = (v: number | null): string =>
  v === null || v === 0 ? 'm-flat' : v > 0 ? 'm-up' : 'm-down';
</script>

<template>
  <div class="m-page-flex">
    <!-- 2026-10-20：移除左侧 app logo（原「我的」入口，我的已回归 TabBar 冗余）；右搜索不变 -->
    <van-nav-bar title="股票看板" class="m-nav" safe-area-inset-top>
      <template #right>
        <van-icon name="search" size="19" @click="router.push('/search')" />
      </template>
    </van-nav-bar>

    <!-- 整页下拉刷新（面板内滚动 + PullRefresh 宿主结构，与 news/board 同构） -->
    <van-pull-refresh v-model="refreshing" class="m-home-scroll" @refresh="onRefresh">
      <!-- 1. 金刚区 5×2（通栏贴边，v3 稿；长按任意 tile 弹出入口设置，桌面右键同开） -->
      <div class="m-home-king">
        <div
          v-for="item in visibleKingItems"
          :key="item.to"
          class="m-home-king__item"
          @click="goTile(item.to)"
          @pointerdown="onKingPressStart"
          @pointerup="onKingPressEnd"
          @pointercancel="onKingPressEnd"
          @pointermove="onKingPressMove"
          @contextmenu.prevent="kingSettingsOpen = true"
        >
          <span class="m-home-king__ic"><van-icon :name="item.icon" :style="{ color: item.color }" /></span>
          <span class="m-home-king__name">{{ item.label }}</span>
        </div>
        <div v-for="n in kingTodoCount" :key="`todo-${n}`" class="m-home-king__item m-home-king__item--todo">
          <span class="m-home-king__ic">＋</span>
          <span class="m-home-king__name">预留</span>
        </div>
      </div>


      <!-- 3~4 成交额 / 涨跌分布·情绪：平铺直排（2026-10-20 王总指定，
           移除书本翻页容器；大盘评级/今天炒什么同日迁至行情页。数据加载逻辑不变） -->
      <div class="m-home-panel">
        <!-- 标题行移入卡内（王总 2026-10-12：三模块标题统一进卡片，视觉更整体） -->
        <div class="m-home-sec m-home-sec--in">
          <span class="m-home-sec__t">成交额</span>
          <span class="m-home-sec__s">单位：亿元</span>
        </div>
        <div v-if="turnoverError" class="m-home-err-box m-home-err-box--turn">
          <van-icon name="warning-o" />
          成交额加载失败
          <span class="retry" @click="loadTurnover(true)">重试</span>
        </div>
        <template v-else-if="turnPaths.length > 0">
          <!-- 实时摘要（2026-10-13 并入：同花顺 dq 域，同时刻环比后端直出；失败静默隐藏） -->
          <div v-if="!rtError && rtMinute" class="m-home-rt">
            <div class="m-home-rt__main">
              <span class="m-home-rt__label">今日实时</span>
              <b class="m-home-rt__num">{{ rtRealtimeText }}</b>
            </div>
            <span class="m-home-rt__item">较上一日 <b :class="rtChangeCls">{{ rtChangeText }}</b></span>
            <span class="m-home-rt__item">预测全天 <b>{{ rtPredictText }}</b></span>
          </div>
          <div v-if="!rtError && rtDay" class="m-home-rt-avg">
            <span>5日均 <b>{{ rtAvg5Text }}</b></span>
            <span>60日均 <b>{{ rtAvg60Text }}</b></span>
            <span>较5日均 <b :class="rtVsAvg5Cls">{{ rtVsAvg5 ?? '--' }}</b></span>
          </div>
          <div class="m-home-panel__head">
            <span class="m-home-panel__t">近 {{ turnoverRange }} 日成交额</span>
            <div class="m-home-chips">
              <button
                v-for="days in MOBILE_TURNOVER_RANGES"
                :key="days"
                class="m-home-chip"
                :class="{ on: turnoverRange === days }"
                @click="onRangeChange(days)"
              >
                {{ days }}日
              </button>
            </div>
          </div>
          <div v-if="turnLegend" class="m-home-legend">
            <span><i class="lg" :style="{ background: CHART_LINE_BLUE }"></i>两市 <b>{{ turnLegend.total }}</b></span>
            <span><i class="lg" :style="{ background: CHART_LINE_GREEN }"></i>上证 <b>{{ turnLegend.sh }}</b></span>
            <span><i class="lg" :style="{ background: CHART_LINE_PURPLE }"></i>深证 <b>{{ turnLegend.sz }}</b></span>
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
                  :fill="CHART_LINE_BLUE"
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
              <!-- 逐日常驻数据点（小号；crosshair 悬停时由大号白边点覆盖强调） -->
              <span
                v-for="(pt, idx) in turnDots"
                :key="`${idx}-${pt.k}`"
                class="m-home-dot m-home-dot--sm"
                :class="pt.k"
                :style="{ left: `${pt.x}%`, top: `${pt.y}%` }"
              ></span>
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
                  <div class="m-home-tip__row"><i class="lg" :style="{ background: CHART_LINE_BLUE }"></i>两市<b>{{ hoverPoint.total }}亿</b></div>
                  <div class="m-home-tip__row"><i class="lg" :style="{ background: CHART_LINE_GREEN }"></i>上证<b>{{ hoverPoint.sh }}亿</b></div>
                  <div class="m-home-tip__row"><i class="lg" :style="{ background: CHART_LINE_PURPLE }"></i>深证<b>{{ hoverPoint.sz }}亿</b></div>
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

      <div class="m-home-panel">
        <div class="m-home-sec m-home-sec--in">
          <span class="m-home-sec__t">涨跌分布 · 市场情绪</span>
          <span class="m-home-sec__s">全市场 A 股 · 30s 轮询</span>
        </div>
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

          <!-- ARMS 分时（与涨跌分布同源快照；随行情 30s 更新，零新增请求） -->
          <div v-if="armsSeries.length > 0 && breadth" class="m-home-arms">
            <div class="m-home-arms-head">
              <span class="t">ARMS 分时</span>
              <span class="v" :class="armsTone === 'up' ? 'm-up' : armsTone === 'down' ? 'm-down' : ''">
                {{ armsText }}
              </span>
              <span class="pill" :class="`pill--${armsTone}`">{{ armsLabel }}</span>
              <span class="hint">1.0 平衡线 · 随快照更新</span>
            </div>
            <ArmsSparkline :points="armsSeries" />
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

      <!-- 5. 板块热力（自行情页迁回，2026-10-20 王总指定两模块互换；点击格子下钻成分股） -->
      <div class="m-card m-home-heat">
        <div class="m-home-sec m-home-sec--in">
          <span class="m-home-sec__t">板块热力</span>
          <span class="m-home-sec__s">Top 10 · 面积 ∝ 总市值</span>
        </div>
        <MobileHeatmap
          v-if="!heatError"
          :boards="heatBoards"
          :loading="heatLoading"
          :error="false"
          @select="openConstituents"
        />
        <div v-else class="m-state m-heat-err">
          <van-icon name="warning-o" size="32" />
          <div>板块数据加载失败</div>
          <span class="retry" @click="loadHeat(true)">重试</span>
        </div>
      </div>

      <!-- 底部让位（悬浮 TabBar + 手势区，DESIGN-MOBILE.md §2.1） -->
      <div class="m-home-tail"></div>
    </van-pull-refresh>

    <!-- 板块热力下钻：成分股弹窗（表格形式，王总 2026-10-12；PC 同口径 Top 30） -->
    <van-popup v-model:show="consOpen" position="bottom" round style="height: 75dvh">
      <div class="m-cons">
        <div class="m-cons__head">
          <div class="m-cons__title">
            {{ consBoard?.name }} · 成分股
            <span class="m-cons__sub">成交额 Top {{ consRows.length }}</span>
          </div>
          <van-icon name="cross" size="18" @click="consOpen = false" />
        </div>
        <div class="m-cons__row m-cons__row--head">
          <span>名称</span>
          <span class="num">最新价</span>
          <span class="num">涨跌幅</span>
          <span class="num">成交额</span>
          <span class="num">换手</span>
        </div>
        <div class="m-cons__list">
          <div v-if="consLoading" class="m-cons__state">
            <van-loading size="26" />
            成分股加载中…
          </div>
          <div v-else-if="consError" class="m-cons__state">
            <van-icon name="warning-o" size="30" />
            <div>成分股加载失败</div>
            <button v-if="consBoard" class="m-cons__retry" @click="openConstituents(consBoard)">
              ↻ 重新加载
            </button>
          </div>
          <div v-else-if="consRows.length === 0" class="m-cons__state">该板块暂无成分股数据</div>
          <template v-else>
            <div
              v-for="row in consRows"
              :key="row.code"
              class="m-cons__row"
              @click="goConstituent(row.code)"
            >
              <span class="nm">
                <b>{{ row.name }}</b>
                <i>{{ row.code }}</i>
              </span>
              <span class="num m-num">{{ row.price === null ? '--' : fmtPrice(row.price) }}</span>
              <span class="num m-num" :class="pctClass(row.changePercent)">
                {{ fmtPct(row.changePercent) }}
              </span>
              <span class="num m-num">{{ fmtAmountYi(row.amount) }}</span>
              <span class="num m-num">
                {{ row.turnoverRate === null ? '--' : `${row.turnoverRate.toFixed(2)}%` }}
              </span>
            </div>
          </template>
        </div>
      </div>
    </van-popup>

    <!-- 金刚区入口设置弹层（长按 tile 打开；显隐 + 拖拽排序，与热点新闻源设置同构；
         拖拽用 vue-draggable-plus，handle 限定手柄 + force-fallback（WebView 必需）） -->
    <van-popup v-model:show="kingSettingsOpen" position="bottom" round>
      <div style="padding: 14px 16px 18px">
        <div class="m-board-head" style="padding-top: 0">
          <div class="m-board-head__title">金刚区入口设置</div>
          <div class="m-board-head__time">开关显隐 · 拖拽调整顺序</div>
        </div>
        <VueDraggable
          v-model="kingSettings.order"
          tag="div"
          :animation="150"
          handle=".m-drag-handle"
          :force-fallback="true"
          fallback-class="sortable-fallback"
          ghost-class="m-drag-ghost"
          chosen-class="m-drag-chosen"
          :fallback-tolerance="6"
          @update="persistKingSettings()"
        >
          <div
            v-for="to in kingSettings.order"
            :key="to"
            class="m-sheet-row"
          >
            <span class="m-drag-handle"><van-icon name="wap-nav" /></span>
            <div
              class="m-sheet-row__name"
              :class="{ 'm-sheet-row__name--off': kingSettings.hidden.includes(to) }"
            >
              {{ KING_BY_TO.get(to)?.label ?? to }}
              <span v-if="kingSettings.hidden.includes(to)">已隐藏</span>
            </div>
            <van-switch
              :model-value="!kingSettings.hidden.includes(to)"
              size="20px"
              @update:model-value="(value: boolean) => toggleKing(to, value)"
            />
          </div>
        </VueDraggable>
        <van-button type="primary" block round style="margin-top: 14px" @click="kingSettingsOpen = false">
          完成
        </van-button>
      </div>
    </van-popup>
  </div>
</template>


<style scoped>
/* === 实时成交额摘要行（2026-10-13 并入成交额卡） === */
.m-home-rt {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 16px;
  margin-bottom: 8px;
}
.m-home-rt__main { display: flex; align-items: baseline; gap: 6px; }
.m-home-rt__label { font-size: 11px; color: var(--color-text-3); }
.m-home-rt__num { font-size: 20px; font-weight: 700; color: var(--color-text-1); font-variant-numeric: tabular-nums; }
.m-home-rt__item { font-size: 11.5px; color: var(--color-text-3); }
.m-home-rt__item b { font-weight: 600; font-variant-numeric: tabular-nums; }
.m-home-rt-avg {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--color-text-3);
  padding: 0 16px 8px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 8px;
}
.m-home-rt-avg b { font-weight: 500; color: var(--color-text-2); font-variant-numeric: tabular-nums; }

/* 热力卡错误态（自行情页迁回；平铺自适应，居中即可） */
.m-heat-err {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 0;
  color: var(--color-text-3);
}

/* === 板块热力下钻 · 成分股表格弹窗（自行情页迁回，王总 2026-10-12） === */
.m-cons { height: 100%; display: flex; flex-direction: column; padding: 16px 16px calc(12px + env(safe-area-inset-bottom, 0px)); }
.m-cons__head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 10px; }
.m-cons__title { font-size: 15.5px; font-weight: 700; color: var(--color-text-1); }
.m-cons__sub { font-size: 11px; font-weight: 500; color: var(--color-text-3); margin-left: 6px; }
/* 表格行：5 列 grid，名称列自适应、数值列等宽右对齐 */
.m-cons__row {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) repeat(4, minmax(0, 1fr));
  align-items: center;
  gap: 6px;
  padding: 9px 2px;
  border-bottom: 1px solid var(--color-border);
}
.m-cons__row--head {
  font-size: 11px;
  color: var(--color-text-3);
  border-bottom-width: 1px;
  padding-bottom: 7px;
}
.m-cons__list { flex: 1; min-height: 0; overflow-y: auto; }
.m-cons__row .nm { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.m-cons__row .nm b { font-size: 13px; font-weight: 600; color: var(--color-text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-cons__row .nm i { font-style: normal; font-size: 10px; color: var(--color-text-3); font-family: var(--font-num); }
.m-cons__row .num { text-align: right; font-size: 12px; }
.m-cons__row--head .num { font-size: 11px; }
.m-cons__state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-3);
  font-size: 13px;
}
.m-cons__retry {
  border: none;
  background: none;
  color: var(--color-primary);
  font-size: 13px;
  padding: 4px 8px;
}

</style>
