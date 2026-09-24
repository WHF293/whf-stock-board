<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseModal from '../components/ui/BaseModal.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BaseTable from '../components/ui/BaseTable.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import TabConfigButton from '../components/ui/TabConfigButton.vue';
import SectorFlowCurveChart from '../components/charts/SectorFlowCurveChart.vue';
import MarketEventView from './MarketEventView.vue';
import DragonTigerView from './DragonTigerView.vue';
import { useTabConfig } from '../composables/use-tab-config';
import { useRouter } from 'vue-router';
import type { TableColumn } from '../types/table.types';
import { sdk } from '../api/sdk';
import { usePolling } from '../composables/use-polling';
import { useDataCacheStore } from '../stores/data-cache';
import { useMarketStatusStore } from '../stores/market-status';
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
import { ROUTE_PATH } from '../constants/router-meta.constants';
import type { RankDataset } from '../types/rank-dataset.types';
import {
  SECTOR_CURVE_MAX_COUNT,
} from '../constants/sector-flow-curve.constants';
import { STORAGE_NS_MARKET_RANK_CURVE, STORAGE_NS_MARKET_RANK_SECTOR_VIEW } from '../constants/storage-key.constants';
import {
  fetchFundFlowRank,
  fetchSectorFundFlowRank,
} from '../api/flow.api';
import {
  fetchSectorFlowCurves,
  pickDefaultCurveCodes,
} from '../api/sector-flow-curve.api';
import { ensureSectorFlowHistories } from '../api/sector-flow-history.api';
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
  SectorFundFlowItem,
} from '../types/flow.types';
import type { SectorFlowCurve, SectorFlowCurveView } from '../types/sector-flow-curve.types';
import type { IndustryBoardConstituent } from '../types/board.types';
import { delay } from '../utils/delay';

/**
 * 市场榜单（原「市场异动」页已并入为页签）：
 * 资金两榜（板块净流入 / 个股主力，板块净流入含 曲线 / 列表 双视图）
 * → 涨停 / 异动 / 龙虎榜 / 大宗交易（自管数据，重接口不轮询）
 * → 全 A 报价排序榜（涨跌幅 / 成交额 / 换手率）。
 *
 * 报价排序榜数据源 stock-sdk `getAllAShareQuotes`（上游东方财富 push2，代理通道）：
 * 一次拉取全市场报价（约 5k+ 只），前端按 sortKey 排序展示前 N 条，
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

  /**
   * 页签：资金两榜 → 涨停 / 异动 / 龙虎榜 / 大宗交易（原「市场异动」页并入）
   * → 全 A 报价排序榜（自管数据；板块净流入内含 曲线 / 列表 双视图；
   * 北向持股已下线——上游长期无数据，接口仍保留给 Agent MCP 工具）
   */
const SORT_TAB_OPTIONS = [
  { label: '板块净流入', value: 'sector' },
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

/** 是否为资金流榜单类页签 */
const isFlowTab = computed(() =>
  sortKey.value === 'sector' || sortKey.value === 'stock',
);

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

// ---------- 资金流两榜单（板块净流入 / 个股主力；自管数据，进页拉一次） ----------
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
 * 拉取资金流两榜单（串行错峰；成功写快照）。
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

// ---------- 板块历史净流入（本地渐进累积；详见 sector-flow-history.api） ----------
const router = useRouter();
const marketStatus = useMarketStatusStore();

/**
 * 已选行业的逐日净流入历史入库：盘中拉新合并、盘后与非交易日只读本地、首次补全量。
 * 后台静默执行（不阻塞页签渲染），触发点 = 进入板块净流入页签 / 交易日历就绪
 */
const ensureFlowHistory = (): void => {
  if (selectedCurveCodes.value.length === 0) {
    return;
  }
  void ensureSectorFlowHistories(selectedCurveCodes.value, {
    isTradingDay: marketStatus.isTradingDay === true,
    inPollingWindow: marketStatus.isASharePollingWindow,
  }).catch((error: unknown) => console.error('[market-rank] flow history', error));
};

// 进入板块净流入页签即触发（immediate 覆盖冷启动直接落在页签的场景；
// 重复触发由 api 层任务共享 + 节流防重入）
watch(sortKey, (tab) => {
  if (tab === 'sector') {
    ensureFlowHistory();
  }
}, { immediate: true });
// 已选行业变化（确认弹窗 / 曲线视图补默认勾选）后同步入库新勾选板块
watch(selectedCurveCodes, () => {
  if (sortKey.value === 'sector') {
    ensureFlowHistory();
  }
});
// 交易日历异步就绪后补一次判定（冷启动 isTradingDay 初始为 null，避免误判非交易日漏拉）
watch(
  () => marketStatus.isTradingDay,
  (value, previous) => {
    if (sortKey.value === 'sector' && value !== null && previous === null) {
      ensureFlowHistory();
    }
  },
);

/**
 * 打开板块历史净流入详情页（带上当前已选行业作为展示顺序；
 * 顺带带上 BK 编号 → 名称映射，历史页对拉取失败的板块渲染占位卡时需要名称）
 */
const goSectorFlowHistory = (): void => {
  const codes = selectedCurveCodes.value.join(',');
  if (!codes) {
    void router.push(ROUTE_PATH.SECTOR_FLOW_HISTORY);
    return;
  }
  const nameByCode = new Map(sectorRank.value.map((item) => [item.code, item.name]));
  const names = selectedCurveCodes.value
    .map((code) => {
      const name = nameByCode.get(code);
      return name ? `${code}:${name}` : '';
    })
    .filter(Boolean)
    .join('|');
  void router.push(
    `${ROUTE_PATH.SECTOR_FLOW_HISTORY}?codes=${codes}${names ? `&names=${names}` : ''}`,
  );
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
  return stockRank.value;
});

/** 当前资金流榜单列配置（行对象按联合类型宽松消费） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlowRow = any;

const currentFlowColumns = computed<TableColumn<FlowRow>[]>(() => {
  if (sortKey.value === 'sector') return sectorColumns;
  return stockColumns;
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

/** 板块净流入榜导出列（表格列 + 代码 / 领涨股） */
const sectorExportColumns: { label: string; key: string }[] = [
  { key: 'name', label: '板块' },
  { key: 'code', label: '代码' },
  { key: 'changePercent', label: '涨跌幅(%)' },
  { key: 'mainNetInflow', label: '主力净流入(元)' },
  { key: 'topStockName', label: '领涨股' },
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
 * 板块净流入页签在曲线视图下也取榜单列表（榜单本体即板块排名，曲线只是另一种展示）；
 * 涨停 / 异动 / 龙虎榜 / 大宗四页签的数据在子视图组件内，经 expose 方法获取
 * @returns 数据段列表；子视图未挂载 / 尚无数据时为空数组
 */
const collectRankDatasets = (): RankDataset[] => {
  switch (sortKey.value) {
    case 'sector':
      return [
        {
          title: currentRankLabel.value,
          columns: sectorExportColumns,
          rows: sectorRank.value as unknown as Record<string, unknown>[],
        },
      ];
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

    <!-- 榜单工具条：AI 分析 + 导出 Excel（板块净流入页签并入其模块工具条，不重复展示） -->
    <div v-if="sortKey !== 'sector'" class="flex shrink-0 items-center justify-end gap-2">
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

    <!-- 资金流榜单（板块净流入页签内可切换 曲线 / 列表 视图） -->
    <BaseCard v-else-if="isFlowTab" fill class="min-h-0 flex-1">
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
          <BaseButton variant="ghost" @click="goSectorFlowHistory">查看历史净流入</BaseButton>
          <template v-if="sectorViewMode === 'curve'">
            <BaseButton variant="ghost" @click="openCurvePicker">
              选择行业 {{ selectedCurveCodes.length }}/{{ SECTOR_CURVE_MAX_COUNT }}
            </BaseButton>
            <BaseButton variant="ghost" :disabled="isCurveLoading" @click="refreshCurves">
              刷新
            </BaseButton>
          </template>
          <BaseButton v-if="agentEntryVisible" variant="ghost" @click="onRankAiAnalysis">
            <MenuIcon name="agent" :size="14" />
            AI 分析
          </BaseButton>
          <BaseButton variant="ghost" @click="onRankExport">
            <MenuIcon name="export" :size="14" />
            导出 Excel
          </BaseButton>
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
      <div class="grid grid-cols-2 gap-1">
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
