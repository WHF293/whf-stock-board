<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseModal from '../components/ui/BaseModal.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BaseTable from '../components/ui/BaseTable.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import TabConfigButton from '../components/ui/TabConfigButton.vue';
import SectorFlowCurveChart from '../components/charts/SectorFlowCurveChart.vue';
import { useTabConfig } from '../composables/use-tab-config';
import type { TableColumn } from '../types/table.types';
import { sdk } from '../api/sdk';
import { usePolling } from '../composables/use-polling';
import { useDataCacheStore } from '../stores/data-cache';
import { useStockOpen } from '../composables/use-stock-open';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants';
import { POLLING_INTERVAL } from '../constants/polling.constants';
import {
  SECTOR_CURVE_MAX_COUNT,
} from '../constants/sector-flow-curve.constants';
import { STORAGE_NS_MARKET_RANK_CURVE, STORAGE_NS_MARKET_RANK_SECTOR_VIEW } from '../constants/storage-key.constants';
import {
  fetchFundFlowRank,
  fetchNorthboundHoldingRank,
  fetchSectorFundFlowRank,
} from '../api/flow.api';
import {
  fetchSectorFlowCurves,
  pickDefaultCurveCodes,
} from '../api/sector-flow-curve.api';
import { fetchIndustryConstituents } from '../api/board.api';
import { getTrendByChangePercent } from '../constants/trend.constants';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../constants/stock-colors.constants';
import { formatAmount } from '../utils/format-amount';
import { formatPercent, formatPercentUnsigned } from '../utils/format-percent';
import { formatPrice } from '../utils/format-price';
import { formatVolume } from '../utils/format-volume';
import { formatYuanWithSign } from '../utils/format-yuan';
import type { FullQuote } from '../types/stock-quote.types';
import { appStorage } from '../utils/app-local-storage';
import type {
  FundFlowRankItem,
  NorthboundHoldingRankItem,
  SectorFundFlowItem,
} from '../types/flow.types';
import type { SectorFlowCurve, SectorFlowCurveView } from '../types/sector-flow-curve.types';
import type { IndustryBoardConstituent } from '../types/board.types';
import { delay } from '../utils/delay';

/**
 * 市场榜单：全 A 股行情按指定列排序（涨跌幅 / 涨跌额 / 成交量 / 换手率），
 * 数据源 stock-sdk `getAllAShareQuotes`（上游东方财富 push2.eastmoney.com，代理通道）。
 *
 * 一次拉取全市场报价（约 5k+ 只），在前端按 sortKey 排序展示前 N 条；
 * 默认轮询 30 秒（与市场宽度一致）；行点击打开右侧个股详情
 */
const { openSidebar, openPage, toContextList } = useStockOpen();

/** 资金流表上下文列表（板块 tab 行非个股，给空列表走单只兜底） */
const flowContextList = computed(() =>
  sortKey.value === 'sector'
    ? []
    : toContextList(currentFlowItems.value, (row) => String(row.code)),
);
const dataCache = useDataCacheStore();

/** 列表展示条数（Top N） */
const DISPLAY_COUNT = 100;

  /** 页签：板块净流入（资金视角主入口）默认排第一，其余为全 A 报价排序榜与资金流榜单（自管数据；板块净流入内含 曲线 / 列表 双视图） */
const SORT_TAB_OPTIONS = [
  { label: '板块净流入', value: 'sector' },
  { label: '涨幅榜', value: 'changePercent' },
  { label: '跌幅榜', value: 'changePercentDesc' },
  { label: '成交额榜', value: 'amount' },
  { label: '换手率榜', value: 'turnoverRate' },
  { label: '个股主力', value: 'stock' },
  { label: '北向持股', value: 'north' },
] as const;

/** 页签值 */
type RankTab = (typeof SORT_TAB_OPTIONS)[number]['value'];

// 页签显隐 + 顺序可配置（持久化）；激活值被隐藏时自动回退首个可见 tab
const { visibleOptions: sortTabOptions, activeValue: sortKey } = useTabConfig<RankTab>(
  'market-rank',
  SORT_TAB_OPTIONS,
);

/** 是否为资金流榜单类页签 */
const isFlowTab = computed(() =>
  sortKey.value === 'sector' || sortKey.value === 'stock' || sortKey.value === 'north',
);

// ---------- 板块净流入视图切换（模块内「曲线 / 列表」按钮组） ----------
/** 板块净流入模块内视图选项（segmented 按钮组） */
const SECTOR_VIEW_OPTIONS = [
  { label: '曲线', value: 'curve' },
  { label: '列表', value: 'list' },
] as const;

/** 板块净流入视图模式 */
type SectorViewMode = (typeof SECTOR_VIEW_OPTIONS)[number]['value'];

/**
 * 读取持久化的板块净流入视图模式（未设置 / 坏数据一律回退曲线——曲线是本模块主视图）
 * @returns 视图模式
 */
const readSectorViewMode = (): SectorViewMode => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_MARKET_RANK_SECTOR_VIEW);
    const parsed = raw ? (JSON.parse(raw) as { view?: string }) : null;
    return parsed?.view === 'list' ? 'list' : 'curve';
  } catch {
    return 'curve';
  }
};

/** 板块净流入当前视图（跨会话持久化） */
const sectorViewMode = ref<SectorViewMode>(readSectorViewMode());

// 视图模式变化时持久化（JSON 比对避免无效写入）
watch(sectorViewMode, (view) => {
  const serialized = JSON.stringify({ view });
  if (appStorage.getItem(STORAGE_NS_MARKET_RANK_SECTOR_VIEW) !== serialized) {
    appStorage.setItem(STORAGE_NS_MARKET_RANK_SECTOR_VIEW, serialized);
  }
});

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

// ---------- 资金流三榜单（板块净流入 / 个股主力 / 北向持股；自管数据，进页拉一次） ----------
/** 各接口请求间隔（毫秒）：对同一上游串行错峰 */
const FLOW_REQUEST_GAP_MS = 500;

/** 表格展示条数 */
const RANK_DISPLAY_COUNT = 15;

const sectorRank = ref<SectorFundFlowItem[]>(
  dataCache.get<SectorFundFlowItem[]>(DATA_CACHE_KEY.FUNDS_SECTOR_RANK) ?? [],
);
const stockRank = ref<FundFlowRankItem[]>(
  dataCache.get<FundFlowRankItem[]>(DATA_CACHE_KEY.FUNDS_STOCK_RANK) ?? [],
);
const northRank = ref<NorthboundHoldingRankItem[]>(
  dataCache.get<NorthboundHoldingRankItem[]>(DATA_CACHE_KEY.FUNDS_NORTH_RANK) ?? [],
);
const isFlowLoading = ref(false);
const flowError = ref(false);

// ---------- 板块净流入扩展行：成分股 ----------
/** 已展开的板块 code 列表（BK 编号） */
const expandedSectorCodes = ref<string[]>([]);
/** 各板块成分股（BK 编号 -> 列表） */
const sectorConstituentsMap = ref<Record<string, IndustryBoardConstituent[]>>({});
/** 正在拉取成分股的板块 code */
const loadingSectorCode = ref<string | null>(null);

/**
 * 板块行 / 展开图标点击：切换扩展行，并按需拉取成分股
 * @param board 板块净流入行
 */
const onSectorToggle = (board: SectorFundFlowItem): void => {
  expandedSectorCodes.value = expandedSectorCodes.value.includes(board.code)
    ? expandedSectorCodes.value.filter((code) => code !== board.code)
    : [...expandedSectorCodes.value, board.code];
  if (expandedSectorCodes.value.includes(board.code) && !sectorConstituentsMap.value[board.code]) {
    void loadSectorConstituents(board.code);
  }
};

const loadSectorConstituents = async (code: string): Promise<void> => {
  loadingSectorCode.value = code;
  try {
    const list = await fetchIndustryConstituents(code);
    sectorConstituentsMap.value = { ...sectorConstituentsMap.value, [code]: list };
  } catch (error) {
    console.error('[market-rank] sector constituents', error);
  } finally {
    loadingSectorCode.value = null;
  }
};

/** 成分股列配置 */
const sectorConstituentColumns: TableColumn<IndustryBoardConstituent>[] = [
  { key: 'name', label: '名称' },
  { key: 'price', label: '现价', align: 'right' },
  {
    key: 'changePercent',
    label: '涨跌幅',
    align: 'right',
    sortable: true,
    sortValue: (stock) => stock.changePercent,
  },
  { key: 'amount', label: '成交额', align: 'right' },
];

/**
 * 拉取资金流三榜单（串行错峰；成功写快照）。
 * 进行中调用共享同一任务（板块净流入页签与曲线视图可能同帧各触发一次，防重复拉取）
 */
let flowRanksTask: Promise<void> | null = null;
const loadFlowRanks = (): Promise<void> => {
  if (!flowRanksTask) {
    flowRanksTask = (async () => {
      isFlowLoading.value = true;
      flowError.value = false;
      try {
        sectorRank.value = await fetchSectorFundFlowRank();
        dataCache.set(DATA_CACHE_KEY.FUNDS_SECTOR_RANK, sectorRank.value);
        await delay(FLOW_REQUEST_GAP_MS);
        stockRank.value = await fetchFundFlowRank();
        dataCache.set(DATA_CACHE_KEY.FUNDS_STOCK_RANK, stockRank.value);
        await delay(FLOW_REQUEST_GAP_MS);
        northRank.value = await fetchNorthboundHoldingRank();
        dataCache.set(DATA_CACHE_KEY.FUNDS_NORTH_RANK, northRank.value);
      } catch (error) {
        flowError.value = sectorRank.value.length === 0;
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

// 首次切到资金流页签时拉取（快照已有数据则跳过；重复触发由共享任务防重入）
watch(isFlowTab, (active) => {
  if (active && sectorRank.value.length === 0) {
    void loadFlowRanks();
  }
});
void (async () => {
  // 首屏即处于资金流页签（如路由记忆）时补拉
  await delay(FLOW_REQUEST_GAP_MS);
  if (isFlowTab.value && sectorRank.value.length === 0) {
    void loadFlowRanks();
  }
})();

// ---------- 板块净流入 · 曲线视图 = 行业资金曲线（自管数据；进视图触发一次，不轮询） ----------
/**
 * 行业资金曲线：多行业当日累计主力净流入分时叠加（数据源东财板块分时资金流），
 * 在「板块净流入」页签内经「曲线 / 列表」按钮切换显示。
 * 重接口（每行业 1 请求，并发 3 上限）——仅在进入视图 / 刷新 / 增删行业时触发；
 * 曲线本体进 dataCache 内存快照，已选行业列表经 appStorage 跨会话持久化
 */

/** 曲线缓存结构（dataCache 内存快照） */
interface SectorCurveCache {
  /** 曲线归属交易日（YYYY-MM-DD，展示「截至」用） */
  tradeDate: string;
  /** 曲线视图模型列表 */
  curves: SectorFlowCurveView[];
}

/** 已选行业持久化结构 */
interface CurveSelectionStorage {
  /** 已选板块代码列表（BK 编号，展示顺序） */
  codes: string[];
}

/**
 * 读取持久化的已选行业（坏数据一律回退空，进入曲线视图时会按排名补默认勾选）
 * @returns 已选板块代码列表
 */
const readCurveSelection = (): string[] => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_MARKET_RANK_CURVE);
    const parsed = raw ? (JSON.parse(raw) as CurveSelectionStorage) : null;
    return Array.isArray(parsed?.codes)
      ? parsed.codes.filter((code) => typeof code === 'string')
      : [];
  } catch {
    return [];
  }
};

/** 曲线视图模型列表（流入值降序在前、流出幅度降序在后；渐进渲染逐条插入） */
const curveViews = ref<SectorFlowCurveView[]>(
  dataCache.get<SectorCurveCache>(DATA_CACHE_KEY.FUNDS_SECTOR_CURVE)?.curves ?? [],
);
/** 已选板块代码（BK 编号） */
const selectedCurveCodes = ref<string[]>(readCurveSelection());
const isCurveLoading = ref(false);
const curveError = ref(false);
/** 本轮加载进度（已完成 / 总数；含失败条目，仅作进度展示） */
const curveProgress = ref({ done: 0, total: 0 });
/** 选择行业弹窗显隐 */
const isCurvePickerOpen = ref(false);
/** 弹窗内暂存勾选（确认时才生效） */
const pendingCurveCodes = ref<string[]>([]);

/** 曲线视图是否激活（板块净流入页签内切换） */
const isCurveMode = computed(
  () => sortKey.value === 'sector' && sectorViewMode.value === 'curve',
);

/** 板块排名索引（BK 编号 -> 排名行），合并曲线的名称 / 涨跌幅用 */
const sectorRankByCode = computed(
  () => new Map(sectorRank.value.map((item) => [item.code, item])),
);

/** 曲线「截至」文案（交易日 + 最后分钟点） */
const curveAsOfText = computed(() => {
  const first = curveViews.value[0];
  const lastPoint = first?.points[first.points.length - 1];
  if (!first || !lastPoint) {
    return '';
  }
  return `${first.tradeDate} ${lastPoint.time}`;
});

/** 曲线缓存写回（数据非空时） */
const persistCurveCache = (): void => {
  const first = curveViews.value[0];
  if (!first) {
    return;
  }
  dataCache.set(DATA_CACHE_KEY.FUNDS_SECTOR_CURVE, {
    tradeDate: first.tradeDate,
    curves: curveViews.value,
  } satisfies SectorCurveCache);
};

/**
 * 合并单条曲线为视图模型：补名称 / 涨跌幅，并按「流入值降序 → 流出幅度降序」插入
 * @param curve 刚拉到的曲线
 */
const mergeCurveView = (curve: SectorFlowCurve): void => {
  const rankItem = sectorRankByCode.value.get(curve.code);
  const finalOf = (row: SectorFlowCurveView): number =>
    row.points[row.points.length - 1]?.mainNetInflow ?? 0;
  const rest = curveViews.value.filter((row) => row.code !== curve.code);
  rest.push({
    ...curve,
    name: rankItem?.name ?? curve.code,
    changePercent: rankItem?.changePercent ?? null,
  });
  rest.sort((a, b) => {
    const fa = finalOf(a);
    const fb = finalOf(b);
    if (fa >= 0 && fb < 0) return -1;
    if (fa < 0 && fb >= 0) return 1;
    return fa >= 0 ? fb - fa : fa - fb;
  });
  curveViews.value = rest;
};

/**
 * 拉取已选行业里尚无曲线的部分（并发 3 限流；每条到位即插图表，渐进渲染）
 * @param codes 目标板块代码列表
 */
const loadSectorCurves = async (codes: readonly string[]): Promise<void> => {
  const targets = codes.filter(
    (code) => !curveViews.value.some((row) => row.code === code),
  );
  if (targets.length === 0) {
    return;
  }
  isCurveLoading.value = true;
  curveError.value = false;
  curveProgress.value = { done: 0, total: targets.length };
  try {
    await fetchSectorFlowCurves(targets, {
      onCurve: (curve) => {
        mergeCurveView(curve);
        curveProgress.value.done += 1;
      },
    });
    persistCurveCache();
  } catch (error) {
    curveError.value = curveViews.value.length === 0;
    console.error('[market-rank] sector curve', error);
  } finally {
    isCurveLoading.value = false;
  }
};

/** 切到曲线视图：备齐排名 → 补默认勾选 → 按需拉曲线（快照已有则跳过） */
watch(isCurveMode, (active) => {
  if (!active || isCurveLoading.value) {
    return;
  }
  void (async () => {
    // 曲线的行业名单 / 名称 / 涨跌幅都来自板块排名，未就绪先拉
    if (sectorRank.value.length === 0) {
      await loadFlowRanks();
    }
    if (selectedCurveCodes.value.length === 0 && sectorRank.value.length > 0) {
      selectedCurveCodes.value = pickDefaultCurveCodes(sectorRank.value);
    }
    if (curveViews.value.length === 0 && selectedCurveCodes.value.length > 0) {
      await loadSectorCurves(selectedCurveCodes.value);
    }
  })();
});

// 已选行业变化时整包持久化（JSON 比对避免无效写入）
watch(selectedCurveCodes, (codes) => {
  const serialized = JSON.stringify({ codes } satisfies CurveSelectionStorage);
  if (appStorage.getItem(STORAGE_NS_MARKET_RANK_CURVE) !== serialized) {
    appStorage.setItem(STORAGE_NS_MARKET_RANK_CURVE, serialized);
  }
});

/** 打开选择行业弹窗：以当前已选初始化暂存勾选 */
const openCurvePicker = (): void => {
  pendingCurveCodes.value = [...selectedCurveCodes.value];
  isCurvePickerOpen.value = true;
};

/**
 * 弹窗内切换某个行业的勾选（达上限后禁止继续勾选）
 * @param code 板块代码
 */
const togglePendingCurve = (code: string): void => {
  if (pendingCurveCodes.value.includes(code)) {
    pendingCurveCodes.value = pendingCurveCodes.value.filter((item) => item !== code);
    return;
  }
  if (pendingCurveCodes.value.length < SECTOR_CURVE_MAX_COUNT) {
    pendingCurveCodes.value = [...pendingCurveCodes.value, code];
  }
};

/** 确认选择：移除未勾选的曲线 + 增量拉取新勾选 */
const confirmCurvePicker = (): void => {
  isCurvePickerOpen.value = false;
  selectedCurveCodes.value = [...pendingCurveCodes.value];
  curveViews.value = curveViews.value.filter((row) =>
    selectedCurveCodes.value.includes(row.code),
  );
  persistCurveCache();
  void loadSectorCurves(selectedCurveCodes.value);
};

/** 刷新曲线：清空现有数据按当前已选整场重拉（拉取新交易日 / 更新当日进度） */
const refreshCurves = (): void => {
  if (isCurveLoading.value || selectedCurveCodes.value.length === 0) {
    return;
  }
  curveViews.value = [];
  void loadSectorCurves(selectedCurveCodes.value);
};


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

/** 当前资金流榜单数据 */
const currentFlowItems = computed<FlowRow[]>(() => {
  if (sortKey.value === 'sector') return sectorRank.value;
  if (sortKey.value === 'stock') return stockRank.value;
  return northRank.value;
});

/** 当前资金流榜单列配置（行对象按联合类型宽松消费） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlowRow = any;

const currentFlowColumns = computed<TableColumn<FlowRow>[]>(() => {
  if (sortKey.value === 'sector') return sectorColumns;
  if (sortKey.value === 'stock') return stockColumns;
  return northColumns;
});

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

/** 板块净流入排名列配置 */
const sectorColumns: TableColumn<SectorFundFlowItem>[] = [
  { key: 'name', label: '板块' },
  {
    key: 'changePercent',
    label: '涨跌幅',
    align: 'right',
    sortable: true,
    sortValue: (sector) => sector.changePercent,
  },
  { key: 'mainNetInflow', label: '主力净流入' },
];

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

/** 北向持股排名列配置 */
const northColumns: TableColumn<NorthboundHoldingRankItem>[] = [
  { key: 'name', label: '个股' },
  { key: 'holdMarketValue', label: '持股市值', align: 'right' },
  { key: 'holdRatioFloat', label: '占流通比' },
];

/**
 * 个股代码跳详情（6 位纯代码 -> 完整符号）
 * @param code 个股 6 位代码
 */
const openDetail = (code: string): void => {
  openSidebar(code);
};

</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] min-h-0 flex-col gap-4">
    <!-- 排序维度切换（与行情全景一致的 underline 风格） -->
    <div class="flex shrink-0 items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <BaseTabs v-model="sortKey" :options="sortTabOptions" variant="underline" />
        <TabConfigButton page-id="market-rank" :options="SORT_TAB_OPTIONS" />
      </div>
      <span v-if="isCurveMode" class="text-xs text-text-tertiary">
        行业当日累计主力净流入 · 收盘后为全天曲线
      </span>
      <span v-else class="text-xs text-text-tertiary">
        共 {{ allQuotes.length }} 只 · 前 {{ displayedRows.length }} 名 · 30 秒自动刷新
      </span>
    </div>

    <!-- 资金流榜单（板块净流入页签内可切换 曲线 / 列表 视图） -->
    <BaseCard v-if="isFlowTab" fill class="min-h-0 flex-1">
      <!-- 板块净流入模块工具条：曲线 / 列表切换 + 曲线专属操作 -->
      <div v-if="sortKey === 'sector'" class="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div class="text-xs text-text-tertiary">
          <template v-if="sectorViewMode === 'curve'">
            <template v-if="curveAsOfText">截至 {{ curveAsOfText }}</template>
            <template v-if="isCurveLoading">
              · 加载曲线 {{ curveProgress.done }}/{{ curveProgress.total }}
            </template>
          </template>
        </div>
        <div class="flex items-center gap-2">
          <BaseTabs v-model="sectorViewMode" :options="SECTOR_VIEW_OPTIONS" aria-label="板块净流入视图" />
          <template v-if="sectorViewMode === 'curve'">
            <BaseButton variant="ghost" @click="openCurvePicker">
              选择行业 {{ selectedCurveCodes.length }}/{{ SECTOR_CURVE_MAX_COUNT }}
            </BaseButton>
            <BaseButton variant="ghost" :disabled="isCurveLoading" @click="refreshCurves">
              刷新
            </BaseButton>
          </template>
        </div>
      </div>

      <!-- 曲线视图：多行业当日累计主力净流入叠加（进视图拉一次，不轮询） -->
      <template v-if="isCurveMode">
        <div v-if="isCurveLoading && curveViews.length === 0" class="min-h-0 flex-1">
          <BaseSkeleton />
        </div>
        <div v-else-if="curveError && curveViews.length === 0" class="min-h-0 flex-1 py-10">
          <BaseEmpty text="行业资金曲线加载失败，请稍后重试" />
        </div>
        <div v-else-if="curveViews.length > 0" class="min-h-0 flex-1">
          <SectorFlowCurveChart :curves="curveViews" />
        </div>
        <BaseEmpty v-else text="暂无曲线数据，请点击「选择行业」添加" />
      </template>
      <template v-else>
        <!-- 列表视图：资金流三榜单 -->
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
          :row-clickable="sortKey !== 'sector'"
          :expandable="sortKey === 'sector'"
          :expanded-keys="expandedSectorCodes"
          :enable-dblclick-nav="true"
          @row-click="
            (row: FlowRow) =>
              sortKey !== 'sector' && openDetail(String(row.code))
          "
          @row-dblclick="(row) => sortKey !== 'sector' && openPage(String(row.code), flowContextList)"
          @toggle-expand="(row: FlowRow) => onSectorToggle(row as SectorFundFlowItem)"
        >
          <template #name="{ row }: { row: FlowRow }">
            <span class="font-medium text-text">{{ row.name }}</span>
            <span v-if="row.topStockName" class="block text-[10px] text-text-tertiary">{{ row.topStockName }}</span>
            <span v-else-if="row.code" class="ml-1 text-xs text-text-tertiary">{{ row.code }}</span>
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
          <template #holdMarketValue="{ row }: { row: FlowRow }">
            <span class="text-text-secondary">{{ formatYuanWithSign(row.holdMarketValue) }}</span>
          </template>
          <template #holdRatioFloat="{ row }: { row: FlowRow }">
            <span class="text-text-secondary">{{ formatPercentUnsigned(row.holdRatioFloat) }}</span>
          </template>

          <!-- 扩展行（仅板块净流入）：成分股表格 -->
          <template v-if="sortKey === 'sector'" #expanded="{ row }: { row: FlowRow }">
            <div
              v-if="loadingSectorCode === String(row.code) && !sectorConstituentsMap[String(row.code)]"
              class="py-4"
            >
              <BaseSkeleton />
            </div>
            <BaseTable
              v-else-if="sectorConstituentsMap[String(row.code)]?.length"
              :columns="sectorConstituentColumns"
              :rows="sectorConstituentsMap[String(row.code)]"
              :row-key="(stock: IndustryBoardConstituent) => stock.code"
              min-width="560px"
              row-clickable
              @row-click="(stock: IndustryBoardConstituent) => openDetail(stock.code)"
              :enable-dblclick-nav="true"
              @row-dblclick="(stock) => openPage(stock.code, toContextList(sectorConstituentsMap[String(row.code)] ?? [], (item) => item.code))"
            >
              <template #name="{ row: stock }: { row: IndustryBoardConstituent }">
                <span class="font-medium text-text">{{ stock.name }}</span>
                <span class="ml-2 text-xs text-text-tertiary">{{ stock.code }}</span>
              </template>
              <template #price="{ row: stock }: { row: IndustryBoardConstituent }">
                <span
                  :class="
                    TREND_TEXT_CLASS[getTrendByChangePercent(stock.changePercent ?? 0)]
                  "
                >
                  {{ formatPrice(stock.price) }}
                </span>
              </template>
              <template #changePercent="{ row: stock }: { row: IndustryBoardConstituent }">
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-semibold"
                  :class="
                    TREND_PILL_CLASS[getTrendByChangePercent(stock.changePercent ?? 0)]
                  "
                >
                  {{ formatPercent(stock.changePercent) }}
                </span>
              </template>
              <template #amount="{ row: stock }: { row: IndustryBoardConstituent }">
                <span class="text-text-secondary">{{ formatAmount(stock.amount) }}</span>
              </template>
            </BaseTable>
            <p v-else class="py-2 text-xs text-text-tertiary">暂无成分股数据</p>
          </template>
        </BaseTable>
        <BaseEmpty v-else text="暂无数据" />
      </template>
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

    <!-- 选择行业弹窗（按当日主力净流入降序全量列出，上限 SECTOR_CURVE_MAX_COUNT） -->
    <BaseModal
      v-model:open="isCurvePickerOpen"
      title="选择行业"
      max-width-class="max-w-2xl"
      height-class="h-[70dvh]"
    >
      <template #filters>
        <div class="flex items-center justify-between gap-2 text-xs text-text-tertiary">
          <span>按当日主力净流入排序，最多选择 {{ SECTOR_CURVE_MAX_COUNT }} 个行业</span>
          <button
            type="button"
            class="pressable text-xs text-primary disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="pendingCurveCodes.length === 0"
            @click="pendingCurveCodes = []"
          >
            清空
          </button>
        </div>
      </template>
      <div class="grid grid-cols-1 gap-1 @2xl:grid-cols-2">
        <label
          v-for="item in sectorRank"
          :key="item.code"
          class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-flat-weak"
          :class="{
            'opacity-50':
              !pendingCurveCodes.includes(item.code) &&
              pendingCurveCodes.length >= SECTOR_CURVE_MAX_COUNT,
          }"
        >
          <input
            type="checkbox"
            class="accent-primary"
            :checked="pendingCurveCodes.includes(item.code)"
            :disabled="
              !pendingCurveCodes.includes(item.code) &&
                pendingCurveCodes.length >= SECTOR_CURVE_MAX_COUNT
            "
            @change="togglePendingCurve(item.code)"
          />
          <span class="min-w-0 flex-1 truncate text-sm text-text">{{ item.name }}</span>
          <span
            class="shrink-0 text-xs tabular-nums"
            :class="(item.mainNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'"
          >
            {{ formatYuanWithSign(item.mainNetInflow) }}
          </span>
        </label>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="isCurvePickerOpen = false">取消</BaseButton>
        <BaseButton :disabled="pendingCurveCodes.length === 0" @click="confirmCurvePicker">
          确定（{{ pendingCurveCodes.length }}）
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
