<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BaseButton from '../ui/BaseButton.vue';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
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
import { STORAGE_NS_MARKET_RANK_CURVE } from '../../../common/constants/storage-key.constants.ts';
import { fetchCalendarBoardFundFlow } from '../../../common/api/board-calendar.api.ts';
import { CALENDAR_BOARDS } from '../../../common/constants/board-calendar.constants.ts';
import { fetchSectorFlowCurves } from '../../../common/api/sector-flow-curve.api.ts';
import { ensureSectorFlowHistories } from '../../../common/api/sector-flow-history.api.ts';
import { formatYuanWithSign } from '../../../common/utils/format-yuan';
import { appStorage } from '../../../common/utils/app-local-storage';
import type { SectorFundFlowItem } from '../../../common/types/flow.types.ts';
import type {
  SectorFlowCurve,
  SectorFlowCurveView,
} from '../../../common/types/sector-flow-curve.types.ts';
import { usePageHeaderSlot, PAGE_HEADER_ACTIONS_TARGET } from '../../../common/composables/use-page-header-slot';

/**
 * 行情全景 · 板块资金（原「市场榜单-板块净流入」模块迁入）：
 * 板块主力净流入榜单 + 多板块当日累计主力净流入分时叠加曲线（自管数据）。
 *
 * - 榜单口径（2026-10-29 王总指定）：36 板块统一池（板块日历 CALENDAR_BOARDS），
 *   与题材轮动 / 板块日历 / A股全景同源，不再用 496 全量行业；
 * - 恒为曲线视图（2026-10-29 王总指定删除「曲线 / 列表」切换）：已选板块的当日
 *   累计主力净流入分时曲线同屏叠加，进模块触发一次不轮询，
 *   曲线本体进 dataCache 内存快照，已选板块经 appStorage 跨会话持久化；
 *   「选择板块」弹窗的候选 = 写死的 36 板块清单（不依赖榜单请求）；
 * - 「查看历史净流入」跳独立子页（逐日历史渐进累积落本地，见 sector-flow-history.api）；
 * - 页级动作（AI 分析 / 导出 Excel，榜单数据自包含）上移所在页面的页头，经 Teleport 投射
 */

const router = useRouter();
const dataCache = useDataCacheStore();
const marketStatus = useMarketStatusStore();

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
        sectorRank.value = await fetchCalendarBoardFundFlow();
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

// ---------- 扩展行：成分股（随列表视图移除，2026-10-29 王总指定恒为曲线视图） ----------

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
 * 读取持久化的已选行业（坏数据一律回退空；2026-10-29 起默认一个不选、
 * 勾选数量不设上限——榜单已收敛为 36 板块池，全选也不过量；
 * 并按 36 池白名单过滤——旧存档里 496 时代勾过的细分行业代码一律剔除）
 * @returns 已选板块代码列表
 */
const readCurveSelection = (): string[] => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_MARKET_RANK_CURVE);
    const parsed = raw ? (JSON.parse(raw) as CurveSelectionStorage) : null;
    if (!Array.isArray(parsed?.codes)) {
      return [];
    }
    const poolCodes = new Set(CALENDAR_BOARDS.map((board) => board.code));
    return parsed.codes.filter(
      (code) => typeof code === 'string' && poolCodes.has(code),
    );
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
/** 选择板块弹窗显隐 */
const isCurvePickerOpen = ref(false);
/** 弹窗内暂存勾选（确认时才生效） */
const pendingCurveCodes = ref<string[]>([]);

/** 板块排名索引（BK 编号 -> 排名行），合并曲线的名称 / 涨跌幅与弹窗数值用 */
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
    // 名称三级回填：榜单 → 曲线接口自带 → BK 编号兜底（与 MobileFundFlow 同款，
    // 王总 2026-10-12 / 2026-10-17：曲线图例与 tooltip 须显示板块名而非代码）
    name: rankItem?.name ?? curve.name ?? curve.code,
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

// 挂载即备齐排名（曲线名称 / 弹窗数值依赖它）→ 有勾选则按需拉曲线（2026-10-29 起恒为曲线视图）
void (async () => {
  if (sectorRank.value.length === 0) {
    await loadSectorRank();
  }
  if (curveViews.value.length === 0 && selectedCurveCodes.value.length > 0) {
    await loadSectorCurves(selectedCurveCodes.value);
  }
})();

// 已选行业变化时整包持久化（JSON 比对避免无效写入）
watch(selectedCurveCodes, (codes) => {
  const serialized = JSON.stringify({ codes } satisfies CurveSelectionStorage);
  if (appStorage.getItem(STORAGE_NS_MARKET_RANK_CURVE) !== serialized) {
    appStorage.setItem(STORAGE_NS_MARKET_RANK_CURVE, serialized);
  }
});

/** 打开选择板块弹窗：以当前已选初始化暂存勾选（板块清单写死不依赖榜单；数值缺席时顺带补拉榜单） */
const openCurvePicker = (): void => {
  pendingCurveCodes.value = [...selectedCurveCodes.value];
  isCurvePickerOpen.value = true;
  if (sectorRank.value.length === 0 && !isFlowLoading.value) {
    void loadSectorRank();
  }
};

/**
 * 弹窗内切换某个板块的勾选（不设上限：36 板块池全选也不过量）
 * @param code 板块代码
 */
const togglePendingCurve = (code: string): void => {
  if (pendingCurveCodes.value.includes(code)) {
    pendingCurveCodes.value = pendingCurveCodes.value.filter((item) => item !== code);
    return;
  }
  pendingCurveCodes.value = [...pendingCurveCodes.value, code];
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
// 重拉排名（名称 / 弹窗数值），再整场刷新曲线（与新交易日 / 盘中进度对齐，同手动「刷新」按钮）
let sectorFlowActivatedOnce = false;
onActivated(() => {
  if (!sectorFlowActivatedOnce) {
    sectorFlowActivatedOnce = true;
    return;
  }
  if (isCurveLoading.value) return;
  void (async () => {
    if (sectorRank.value.length === 0) {
      await loadSectorRank();
    }
    if (!isCurveLoading.value) {
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

// ---------- 工具条：AI 分析 + 导出 Excel（榜单数据自包含；按钮上移页面页头） ----------

const settingsStore = useSettingsStore();
const notifications = useNotificationsStore();

/** 「AI 分析」入口跟随顶栏「Agent 分析」条目的显隐开关（设置 → 布局编排 → 右上角工具编排） */
const agentEntryVisible = computed(
  () => !settingsStore.hiddenHeaderItems.includes(HOST_HEADER_ITEM.AGENT),
);

/** 页头动作挂载守卫：宿主页激活时按钮才出现在页头（KeepAlive 的 activated 下发到子组件） */
const { active: headerSlotActive } = usePageHeaderSlot();

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
    <!-- 页级动作上移页面页头：AI 分析 / 导出 Excel（Teleport 投射，宿主页激活时才挂载） -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <div class="flex items-center gap-2">
        <BaseButton v-if="agentEntryVisible" variant="ghost" @click="onRankAiAnalysis">
          <MenuIcon name="agent" :size="14" />
          AI 分析
        </BaseButton>
        <BaseButton variant="ghost" @click="onRankExport">
          <MenuIcon name="export" :size="14" />
          导出 Excel
        </BaseButton>
      </div>
    </Teleport>

    <!-- 模块工具条：曲线操作（截至时间 / 进度说明在左侧）；2026-10-29 起恒为曲线视图，切换已删 -->
    <div class="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div class="text-xs text-text-tertiary">
        <template v-if="curveAsOfText">截至 {{ curveAsOfText }}</template>
        <template v-if="isCurveLoading">
          · 加载曲线 {{ curveProgress.done }}/{{ curveProgress.total }}
        </template>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton variant="ghost" @click="goSectorFlowHistory">查看历史净流入</BaseButton>
        <BaseButton variant="ghost" @click="openCurvePicker">
          选择板块 {{ selectedCurveCodes.length }}
        </BaseButton>
        <BaseButton variant="ghost" :disabled="isCurveLoading" @click="refreshCurves">
          刷新
        </BaseButton>
      </div>
    </div>

    <!-- 板块资金曲线：多板块当日累计主力净流入叠加（进模块拉一次，不轮询） -->
    <div v-if="isCurveLoading && curveViews.length === 0" class="min-h-0 flex-1">
      <BaseSkeleton />
    </div>
    <div v-else-if="curveError && curveViews.length === 0" class="min-h-0 flex-1 py-10">
      <BaseEmpty text="板块资金曲线加载失败，请稍后重试" />
    </div>
    <div v-else-if="curveViews.length > 0" class="min-h-0 flex-1">
      <SectorFlowCurveChart :curves="curveViews" />
    </div>
    <BaseEmpty v-else text="暂无曲线数据，请点击「选择板块」勾选要对比的板块" />

    <!-- 选择板块弹窗（36 板块直接写死清单来源，与板块日历 / 题材轮动同池；
         主力净流入数值为辅助参考，榜单未就绪显示 --，不阻塞勾选；不设勾选上限） -->
    <BaseModal
      v-model:open="isCurvePickerOpen"
      title="选择板块"
      max-width-class="max-w-5xl"
      height-class="h-[70dvh]"
    >
      <template #filters>
        <div class="flex items-center justify-between gap-2 text-xs text-text-tertiary">
          <span>36 板块固定清单，勾几个画几条（全选也可；右侧数值为当日主力净流入）</span>
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
      <div class="max-h-[52dvh] overflow-y-auto">
        <div class="grid grid-cols-4 gap-1">
          <label
            v-for="board in CALENDAR_BOARDS"
            :key="board.code"
            class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-flat-weak"
          >
            <input
              type="checkbox"
              class="accent-primary"
              :checked="pendingCurveCodes.includes(board.code)"
              @change="togglePendingCurve(board.code)"
            />
            <span class="min-w-0 flex-1 truncate text-sm text-text">{{ board.name }}</span>
            <span
              class="shrink-0 text-xs tabular-nums"
              :class="((sectorRankByCode.get(board.code)?.mainNetInflow ?? 0)) >= 0 ? 'text-up' : 'text-down'"
            >
              {{ formatYuanWithSign(sectorRankByCode.get(board.code)?.mainNetInflow ?? null) }}
            </span>
          </label>
        </div>
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
