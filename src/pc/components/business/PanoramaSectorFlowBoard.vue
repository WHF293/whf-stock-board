<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BaseButton from '../ui/BaseButton.vue';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseTable from '../ui/BaseTable.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import SectorFlowCurveChart from '../charts/SectorFlowCurveChart.vue';
import { useDataCacheStore } from '../../../common/stores/data-cache';
import { useMarketStatusStore } from '../../../common/stores/market-status';
import { useSettingsStore } from '../../../common/stores/settings';
import { useNotificationsStore } from '../../../common/stores/notifications';
import { requestAgentAnalysis } from '../../agent/agent-bridge';
import { buildRankAnalysisPrompt } from '../../../common/utils/build-rank-analysis-prompt';
import { exportSheetsToExcel } from '../../../common/utils/export-excel';
import { DATA_CACHE_KEY } from '../../../common/constants/data-cache.constants.ts';
import { HOST_HEADER_ITEM } from '../../../common/constants/header.constants.ts';
import { NOTIFY_TONE } from '../../../common/constants/notify.constants.ts';
import { ROUTE_PATH } from '../../../common/constants/router-meta.constants.ts';
import { SECTOR_CURVE_MAX_COUNT } from '../../../common/constants/sector-flow-curve.constants.ts';
import {
  STORAGE_NS_MARKET_RANK_CURVE,
  STORAGE_NS_MARKET_RANK_SECTOR_VIEW,
} from '../../../common/constants/storage-key.constants.ts';
import { fetchSectorFundFlowRank } from '../../../common/api/flow.api.ts';
import {
  fetchSectorFlowCurves,
  pickDefaultCurveCodes,
} from '../../../common/api/sector-flow-curve.api.ts';
import { ensureSectorFlowHistories } from '../../../common/api/sector-flow-history.api.ts';
import { fetchIndustryConstituents } from '../../../common/api/board.api.ts';
import { getTrendByChangePercent } from '../../../common/constants/trend.constants.ts';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../../../common/constants/stock-colors.constants.ts';
import { formatAmount } from '../../../common/utils/format-amount';
import { formatPercent } from '../../../common/utils/format-percent';
import { formatPrice } from '../../../common/utils/format-price';
import { formatYuanWithSign } from '../../../common/utils/format-yuan';
import { appStorage } from '../../../common/utils/app-local-storage';
import type { SectorFundFlowItem } from '../../../common/types/flow.types.ts';
import type {
  SectorFlowCurve,
  SectorFlowCurveView,
} from '../../../common/types/sector-flow-curve.types.ts';
import type { IndustryBoardConstituent } from '../../../common/types/board.types.ts';
import type { TableColumn } from '../../../common/types/table.types.ts';
import { useStockOpen } from '../../../common/composables/use-stock-open';

/**
 * 行情全景 · 板块资金（原「市场榜单-板块净流入」模块迁入）：
 * 行业主力净流入榜单 + 多行业当日累计主力净流入分时叠加曲线（自管数据）。
 *
 * - 列表视图：板块净流入排名，行可展开成分股（点击行内个股开侧栏、双击进详情页）；
 * - 曲线视图：已选行业（≤26 个）的分时资金曲线叠加，进视图触发一次不轮询，
 *   曲线本体进 dataCache 内存快照，已选行业经 appStorage 跨会话持久化；
 * - 「查看历史净流入」跳独立子页（逐日历史渐进累积落本地，见 sector-flow-history.api）；
 * - 顶部工具条含 AI 分析 / 导出 Excel（榜单数据自包含）
 */

const { openSidebar, openPage, toContextList } = useStockOpen();
const router = useRouter();
const dataCache = useDataCacheStore();
const marketStatus = useMarketStatusStore();

/** 表格展示条数 */
const RANK_DISPLAY_COUNT = 15;

// ---------- 视图切换（曲线 / 列表，跨会话持久化；存储键沿用迁移前的值） ----------

/** 模块内视图选项（segmented 按钮组） */
const SECTOR_VIEW_OPTIONS = [
  { label: '曲线', value: 'curve' },
  { label: '列表', value: 'list' },
] as const;

/** 视图模式 */
type SectorViewMode = (typeof SECTOR_VIEW_OPTIONS)[number]['value'];

/**
 * 读取持久化的视图模式（未设置 / 坏数据一律回退曲线——曲线是本模块主视图）
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

/** 当前视图（跨会话持久化） */
const sectorViewMode = ref<SectorViewMode>(readSectorViewMode());

// 视图模式变化时持久化（JSON 比对避免无效写入）
watch(sectorViewMode, (view) => {
  const serialized = JSON.stringify({ view });
  if (appStorage.getItem(STORAGE_NS_MARKET_RANK_SECTOR_VIEW) !== serialized) {
    appStorage.setItem(STORAGE_NS_MARKET_RANK_SECTOR_VIEW, serialized);
  }
});

// ---------- 板块净流入排名（自管数据，进模块拉一次） ----------

/** 各接口请求间隔（毫秒）：对同一上游串行错峰 */
const FLOW_REQUEST_GAP_MS = 500;

const sectorRank = ref<SectorFundFlowItem[]>(
  dataCache.get<SectorFundFlowItem[]>(DATA_CACHE_KEY.FUNDS_SECTOR_RANK) ?? [],
);
const isFlowLoading = ref(false);
const flowError = ref(false);

/**
 * 拉取板块净流入排名（成功写快照；进行中调用共享同一任务防重入）
 * @returns 拉取任务
 */
let flowRankTask: Promise<void> | null = null;
const loadSectorRank = (): Promise<void> => {
  if (!flowRankTask) {
    flowRankTask = (async () => {
      isFlowLoading.value = true;
      flowError.value = false;
      try {
        sectorRank.value = await fetchSectorFundFlowRank();
        dataCache.set(DATA_CACHE_KEY.FUNDS_SECTOR_RANK, sectorRank.value);
      } catch (error) {
        flowError.value = sectorRank.value.length === 0;
        console.error('[panorama-sector-flow] rank', error);
      } finally {
        isFlowLoading.value = false;
      }
    })().finally(() => {
      flowRankTask = null;
    });
  }
  return flowRankTask;
};

// 挂载即重拉排名（快照先行秒出、请求返回静默覆盖；错峰延迟与相邻模块请求错开。
// 原「快照已有则跳过」在 KeepAlive / 重挂载场景下会让榜单永不更新，改为无条件重拉，
// 重复触发由 flowRankTask 共享任务防重入兜住）
onMounted(() => {
  void (async () => {
    await new Promise((resolve) => setTimeout(resolve, FLOW_REQUEST_GAP_MS));
    void loadSectorRank();
  })();
});

// ---------- 扩展行：成分股 ----------

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
    console.error('[panorama-sector-flow] sector constituents', error);
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
 * 扩展行成分股的上下文列表（双击进详情页时整批带入）
 * @param code 板块 BK 编号
 * @returns 成分股上下文列表
 */
const constituentContext = (code: string) =>
  toContextList(sectorConstituentsMap.value[code] ?? [], (item) => item.code);

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

// ---------- 曲线视图 = 行业资金曲线（进视图触发一次，不轮询） ----------
/**
 * 行业资金曲线：多行业当日累计主力净流入分时叠加（数据源东财板块分时资金流）。
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

/** 曲线视图是否激活 */
const isCurveMode = computed(() => sectorViewMode.value === 'curve');

/** 板块排名索引（BK 编号 -> 排名行），合并曲线的名称 / 涨跌幅用 */
const sectorRankByCode = computed(
  () => new Map(sectorRank.value.map((item) => [item.code, item])),
);

// 榜单晚于曲线就绪（或首次合并时榜单请求失败）时回填名称 / 涨跌幅：
// mergeCurveView 只在曲线到位瞬间合并一次，错过即永远显示 BK 编号
watch(sectorRankByCode, (map) => {
  if (map.size === 0 || curveViews.value.length === 0) {
    return;
  }
  curveViews.value = curveViews.value.map((row) => {
    const item = map.get(row.code);
    return item
      ? { ...row, name: item.name, changePercent: item.changePercent }
      : row;
  });
});

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
    console.error('[panorama-sector-flow] sector curve', error);
  } finally {
    isCurveLoading.value = false;
  }
};

/** 进曲线视图：备齐排名 → 补默认勾选 → 按需拉曲线（快照已有则跳过）。
 *  组件挂载即处于曲线视图时同样触发（watch immediate 覆盖） */
watch(
  isCurveMode,
  (active) => {
    if (!active || isCurveLoading.value) {
      return;
    }
    void (async () => {
      // 曲线的行业名单 / 名称 / 涨跌幅都来自板块排名，未就绪先拉
      if (sectorRank.value.length === 0) {
        await loadSectorRank();
      }
      if (selectedCurveCodes.value.length === 0 && sectorRank.value.length > 0) {
        selectedCurveCodes.value = pickDefaultCurveCodes(sectorRank.value);
      }
      if (curveViews.value.length === 0 && selectedCurveCodes.value.length > 0) {
        await loadSectorCurves(selectedCurveCodes.value);
      }
    })();
  },
  { immediate: true },
);

// 已选行业变化时整包持久化（JSON 比对避免无效写入）
watch(selectedCurveCodes, (codes) => {
  const serialized = JSON.stringify({ codes } satisfies CurveSelectionStorage);
  if (appStorage.getItem(STORAGE_NS_MARKET_RANK_CURVE) !== serialized) {
    appStorage.setItem(STORAGE_NS_MARKET_RANK_CURVE, serialized);
  }
});

/** 打开选择行业弹窗：以当前已选初始化暂存勾选（榜单缺席时顺带补拉，弹窗内展示加载 / 重试态） */
const openCurvePicker = (): void => {
  pendingCurveCodes.value = [...selectedCurveCodes.value];
  isCurvePickerOpen.value = true;
  if (sectorRank.value.length === 0 && !isFlowLoading.value) {
    void loadSectorRank();
  }
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

// KeepAlive 缓存页面：切走再切回不重新挂载（首次 onActivated 紧跟 onMounted 触发，跳过）——
// 列表视图重拉排名；曲线视图整场刷新（与新交易日 / 盘中进度对齐，同手动「刷新」按钮）
let sectorFlowActivatedOnce = false;
onActivated(() => {
  if (!sectorFlowActivatedOnce) {
    sectorFlowActivatedOnce = true;
    return;
  }
  if (isCurveLoading.value) return;
  if (!isCurveMode.value) {
    void loadSectorRank();
    return;
  }
  // 曲线视图：先就绪榜单（曲线名称依赖它），再整场刷新
  void (async () => {
    if (sectorRank.value.length === 0) {
      await loadSectorRank();
    }
    if (isCurveMode.value && !isCurveLoading.value) {
      refreshCurves();
    }
  })();
});

// ---------- 板块历史净流入（本地渐进累积；详见 sector-flow-history.api） ----------

/**
 * 已选行业的逐日净流入历史入库：盘中拉新合并、盘后与非交易日只读本地、首次补全量。
 * 后台静默执行（不阻塞模块渲染），触发点 = 模块挂载 / 已选行业变化 / 交易日历就绪
 */
const ensureFlowHistory = (): void => {
  if (selectedCurveCodes.value.length === 0) {
    return;
  }
  void ensureSectorFlowHistories(selectedCurveCodes.value, {
    isTradingDay: marketStatus.isTradingDay === true,
    inPollingWindow: marketStatus.isASharePollingWindow,
  }).catch((error: unknown) =>
    console.error('[panorama-sector-flow] flow history', error),
  );
};

// 挂载即触发（重复触发由 api 层任务共享 + 节流防重入）
onMounted(() => {
  ensureFlowHistory();
});
// 已选行业变化（确认弹窗 / 曲线视图补默认勾选）后同步入库新勾选板块
watch(selectedCurveCodes, () => {
  ensureFlowHistory();
});
// 交易日历异步就绪后补一次判定（冷启动 isTradingDay 初始为 null，避免误判非交易日漏拉）
watch(
  () => marketStatus.isTradingDay,
  (value, previous) => {
    if (value !== null && previous === null) {
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

// ---------- 工具条：AI 分析 + 导出 Excel（榜单数据自包含） ----------

const settingsStore = useSettingsStore();
const notifications = useNotificationsStore();

/** 「AI 分析」入口跟随顶栏「Agent 分析」条目的显隐开关（设置 → 布局编排 → 右上角工具编排） */
const agentEntryVisible = computed(
  () => !settingsStore.hiddenHeaderItems.includes(HOST_HEADER_ITEM.AGENT),
);

/** 榜单类型名（AI 分析提示词与导出文件名共用） */
const RANK_LABEL = '板块净流入';

/** 榜单导出列（表格列 + 代码 / 领涨股） */
const sectorExportColumns: { label: string; key: string }[] = [
  { key: 'name', label: '板块' },
  { key: 'code', label: '代码' },
  { key: 'changePercent', label: '涨跌幅(%)' },
  { key: 'mainNetInflow', label: '主力净流入(元)' },
  { key: 'topStockName', label: '领涨股' },
];

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

/** 「AI 分析」：把板块净流入榜单数据 + 榜单类型交给 Agent 分析 */
const onRankAiAnalysis = (): void => {
  const prompt = buildRankAnalysisPrompt(RANK_LABEL, [
    {
      title: RANK_LABEL,
      columns: sectorExportColumns,
      rows: sectorRank.value as unknown as Record<string, unknown>[],
    },
  ]);
  if (prompt === '') {
    notifications.push({
      title: '暂无可分析的榜单数据',
      body: '请等待板块净流入榜单加载完成后再发起 AI 分析',
      tone: NOTIFY_TONE.FLAT,
    });
    return;
  }
  void requestAgentAnalysis(prompt);
};

/** 「导出 Excel」：把板块净流入榜单导出为 .xlsx */
const onRankExport = async (): Promise<void> => {
  if (sectorRank.value.length === 0) {
    notifications.push({
      title: '暂无可导出的榜单数据',
      body: '请等待板块净流入榜单加载完成后再导出',
      tone: NOTIFY_TONE.FLAT,
    });
    return;
  }
  try {
    await exportSheetsToExcel(
      [
        {
          name: RANK_LABEL,
          rows: sectorRank.value as unknown as Record<string, unknown>[],
          columns: sectorExportColumns,
        },
      ],
      `行情全景-${RANK_LABEL}-${exportStamp()}`,
    );
  } catch (error) {
    console.error('[panorama-sector-flow] export', error);
    notifications.push({
      title: '导出失败',
      body: '榜单数据导出 Excel 失败，请稍后重试',
      tone: NOTIFY_TONE.FLAT,
    });
  }
};
</script>

<template>
  <BaseCard fill class="min-h-0 flex-1">
    <!-- 模块工具条：曲线 / 列表切换 + 曲线专属操作 + AI 分析 / 导出 -->
    <div class="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div class="text-xs text-text-tertiary">
        <template v-if="sectorViewMode === 'curve'">
          <template v-if="curveAsOfText">截至 {{ curveAsOfText }}</template>
          <template v-if="isCurveLoading">
            · 加载曲线 {{ curveProgress.done }}/{{ curveProgress.total }}
          </template>
        </template>
      </div>
      <div class="flex items-center gap-2">
        <BaseTabs v-model="sectorViewMode" :options="SECTOR_VIEW_OPTIONS" aria-label="板块资金视图" />
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

    <!-- 列表视图：板块净流入排名（行展开成分股） -->
    <template v-else>
      <div v-if="isFlowLoading && sectorRank.length === 0"><BaseSkeleton /></div>
      <div v-else-if="flowError && sectorRank.length === 0" class="py-10">
        <BaseEmpty text="板块净流入榜单加载失败，请稍后重试" />
      </div>
      <BaseTable
        v-else-if="sectorRank.length > 0"
        :columns="sectorColumns"
        :rows="sectorRank.slice(0, RANK_DISPLAY_COUNT)"
        :row-key="(row: SectorFundFlowItem) => row.code"
        min-width="720px"
        scroll-class="table-scroll-fill"
        expandable
        :expanded-keys="expandedSectorCodes"
        @toggle-expand="onSectorToggle"
      >
        <template #name="{ row }: { row: SectorFundFlowItem }">
          <span class="font-medium text-text">{{ row.name }}</span>
          <span v-if="row.topStockName" class="block text-[10px] text-text-tertiary">{{ row.topStockName }}</span>
          <span v-else class="ml-1 text-xs text-text-tertiary">{{ row.code }}</span>
        </template>
        <template #changePercent="{ row }: { row: SectorFundFlowItem }">
          <span
            class="rounded-full px-2 py-0.5 font-semibold"
            :class="TREND_PILL_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]"
          >
            {{ formatPercent(row.changePercent) }}
          </span>
        </template>
        <template #mainNetInflow="{ row }: { row: SectorFundFlowItem }">
          <span
            class="font-medium"
            :class="(row.mainNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'"
          >
            {{ formatYuanWithSign(row.mainNetInflow) }}
          </span>
        </template>

        <!-- 扩展行：成分股表格 -->
        <template #expanded="{ row }: { row: SectorFundFlowItem }">
          <div
            v-if="loadingSectorCode === row.code && !sectorConstituentsMap[row.code]"
            class="py-4"
          >
            <BaseSkeleton />
          </div>
          <BaseTable
            v-else-if="sectorConstituentsMap[row.code]?.length"
            :columns="sectorConstituentColumns"
            :rows="sectorConstituentsMap[row.code]"
            :row-key="(stock: IndustryBoardConstituent) => stock.code"
            min-width="560px"
            row-clickable
            :enable-dblclick-nav="true"
            @row-click="(stock: IndustryBoardConstituent) => openSidebar(stock.code)"
            @row-dblclick="(stock: IndustryBoardConstituent) => openPage(stock.code, constituentContext(row.code))"
          >
            <template #name="{ row: stock }: { row: IndustryBoardConstituent }">
              <span class="font-medium text-text">{{ stock.name }}</span>
              <span class="ml-2 text-xs text-text-tertiary">{{ stock.code }}</span>
            </template>
            <template #price="{ row: stock }: { row: IndustryBoardConstituent }">
              <span :class="TREND_TEXT_CLASS[getTrendByChangePercent(stock.changePercent ?? 0)]">
                {{ formatPrice(stock.price) }}
              </span>
            </template>
            <template #changePercent="{ row: stock }: { row: IndustryBoardConstituent }">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="TREND_PILL_CLASS[getTrendByChangePercent(stock.changePercent ?? 0)]"
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
      <!-- 榜单未就绪：加载中骨架 / 失败空态（附重试），避免弹窗静默空白 -->
      <div v-if="isFlowLoading && sectorRank.length === 0" class="py-6">
        <BaseSkeleton />
      </div>
      <div v-else-if="sectorRank.length === 0" class="py-10">
        <BaseEmpty text="行业榜单加载失败，请稍后重试" />
        <div class="flex justify-center">
          <BaseButton variant="ghost" :disabled="isFlowLoading" @click="void loadSectorRank()">
            重试
          </BaseButton>
        </div>
      </div>
      <div v-else class="grid grid-cols-2 gap-1">
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
  </BaseCard>
</template>
