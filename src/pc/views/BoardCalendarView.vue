<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import BoardCalendarGrid from '../components/business/BoardCalendarGrid.vue';
import BoardCellDetailModal from '../components/business/BoardCellDetailModal.vue';
import BoardDataSyncMenu from '../components/business/BoardDataSyncMenu.vue';
import BoardFilterModal from '../components/business/BoardFilterModal.vue';
import BoardMainlinePanel from '../components/business/BoardMainlinePanel.vue';
import BoardProfitBubblePanel from '../components/business/BoardProfitBubblePanel.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import NoticeBar from '../components/ui/NoticeBar.vue';
import {
  isBoardDbAvailable,
  listBoardDailyByDates,
  listBoardProfiles,
} from '../../common/api/board-calendar-db.api.ts';
import { usePolling } from '../../common/composables/use-polling';
import { usePageHeaderSlot, PAGE_HEADER_ACTIONS_TARGET } from '../../common/composables/use-page-header-slot';
import { getTradingDates, syncBoardCalendar } from '../../common/composables/use-board-calendar-sync';
import {
  BOARD_CALENDAR_HEAT_BASIS,
  BOARD_CALENDAR_HEAT_OPTIONS,
  BOARD_CALENDAR_RANGE,
  BOARD_CALENDAR_RANGE_OPTIONS,
  BOARD_CALENDAR_VIEW,
  BOARD_CALENDAR_VIEW_DEFAULT,
  BOARD_CALENDAR_VIEW_OPTIONS,
  BOARD_DATA_LEVEL,
  BOARD_MAINLINE_TOP_N,
  BOARD_SCORE_BUCKET,
  BOARD_SCORE_LEGEND,
  CALENDAR_BOARDS,
  HEAT_STREAK_WINDOW,
} from '../../common/constants/board-calendar.constants.ts';
import { DATA_CACHE_KEY } from '../../common/constants/data-cache.constants.ts';
import { POLLING_INTERVAL } from '../../common/constants/polling.constants.ts';
import { ROUTE_PATH } from '../../common/constants/router-meta.constants.ts';
import { useDataCacheStore } from '../../common/stores/data-cache';
import { useMarketStatusStore } from '../../common/stores/market-status';
import { useSettingsStore } from '../../common/stores/settings';
import type {
  BoardCalendarCell,
  BoardCalendarMatrix,
  BoardCalendarRow,
  BoardCalendarViewMode,
  BoardColumnSelection,
  BoardDailyRow,
  BoardMainlineCell,
  BoardProfile,
  BoardScoreBucket,
} from '../../common/types/board-calendar.types.ts';
import {
  isDefaultBoardOrder,
  normalizeBoardHidden,
  normalizeBoardOrder,
} from '../../common/utils/board-order';
import { buildBoardMainlineMatrix } from '../../common/utils/build-board-mainline-matrix';
import {
  getBoardBucketBackground,
  resolveBoardScoreBucket,
} from '../../common/utils/board-score-colors';
import { formatRelativeTime } from '../../common/utils/format-relative-time';
import { handleSdkError } from '../../common/utils/handle-sdk-error';

/**
 * 板块日历（板块热点 · 赚钱效应）
 *
 * 行为：板块池为行（31 个申万一级行业 + 追加的热门板块，按热门口径降序）×
 * 交易日为列（降序，最近在左）；
 * 单元格显示涨停 / 跌停家数，背景按「得分率」取 7 档涨跌语义色（与板块热力图同款）。
 * 注意：追加板块与一级行业会重叠（半导体 ⊂ 电子），同一只票同时计入两边，属设计口径。
 * 数据来自本地库 sqlite:stock-board.db（由启动钩子与页内轮询逐日累积）。
 *
 * 口径见 .ai/开发方案/2026-09-14-板块日历与赚钱效应开发方案.md §3。
 */

const settingsStore = useSettingsStore();
const dataCache = useDataCacheStore();
const marketStatusStore = useMarketStatusStore();
const router = useRouter();

/** 桌面端才有本地库（浏览器端降级为「仅当日、不累积」） */
const isDbAvailable = isBoardDbAvailable();

/** 列数据加载中 */
const isLoading = ref(false);
/** 正在手动强制刷新 */
const isForcing = ref(false);
/** 页面级错误提示（不影响已渲染数据） */
const errorText = ref<string | null>(null);
/** 交易日轴（升序，来自腾讯日 K） */
const tradingDates = ref<string[]>([]);
/** 本地库里的板块日聚合（当前范围） */
const dailyRows = ref<BoardDailyRow[]>([]);
/** 板块档案（回补日兜底展示成分股数） */
const profiles = ref<BoardProfile[]>([]);
/** 最近一次读取成功时间 */
const lastUpdatedAt = ref<number | null>(null);

/** 板块过滤器弹窗开关 */
const filterOpen = ref(false);

/** 表头图例气泡开关（问号图标点击） */
const legendOpen = ref(false);

/** 页头动作挂载守卫：只有本页激活时按钮才出现在页头（KeepAlive 缓存页切走不残留） */
const { active: headerSlotActive } = usePageHeaderSlot();
/** 主区视图：列表（涨跌停矩阵）/ 气泡图（赚钱效应） */
const calendarView = ref<BoardCalendarViewMode>(BOARD_CALENDAR_VIEW_DEFAULT);
/** 弹窗状态 */
const modalOpen = ref(false);
const activeRow = ref<BoardCalendarRow | null>(null);
const activeCell = ref<BoardCalendarCell | null>(null);
const activeDate = ref('');
const activeProfileConsCount = ref(0);

// 会话缓存播种：切页回来立即有内容，随后由轮询任务覆盖刷新
const cachedRows = dataCache.get<BoardDailyRow[]>(DATA_CACHE_KEY.BOARD_CALENDAR_MATRIX);
if (cachedRows && cachedRows.length > 0) {
  dailyRows.value = cachedRows;
}
const cachedDates = dataCache.get<string[]>(DATA_CACHE_KEY.BOARD_CALENDAR_DATES);
if (cachedDates && cachedDates.length > 0) {
  tradingDates.value = cachedDates;
}

/** 当前范围对应的列数（null = 全部） */
const rangeLimit = computed<number | null>(() => {
  const range = settingsStore.boardCalendarRange;
  return range === BOARD_CALENDAR_RANGE.ALL ? null : Number(range);
});

/** 需要展示的交易日（降序，最近在左） */
const selectedDates = computed<string[]>(() => {
  const descending = [...tradingDates.value].reverse();
  const limit = rangeLimit.value;
  return limit === null ? descending : descending.slice(0, limit);
});

/**
 * 交易日文案
 *
 * 取自全站统一的市场状态 store（MainLayout 定期刷新），
 * 而不是从交易日轴末位推断——轴是缓存值，盘前确认前会滞后一天。
 * @returns 状态文案
 */
const tradingDayLabel = computed<string>(() => {
  if (marketStatusStore.isTradingDay === null) {
    return '交易日状态确认中';
  }
  return marketStatusStore.isTradingDay ? '今日为交易日' : '今日非交易日';
});

/**
 * board_daily 行 → 单元格视图模型
 * @param daily 板块日聚合行
 * @returns 单元格（回补日档位记 none，不渲染背景色）
 */
const toCell = (daily: BoardDailyRow): BoardCalendarCell => ({
  tradeDate: daily.tradeDate,
  limitUp: daily.limitUp,
  limitDown: daily.limitDown,
  upCount: daily.upCount,
  downCount: daily.downCount,
  consCount: daily.consCount,
  amount: daily.amount,
  score: daily.score,
  scoreRate: daily.scoreRate,
  dataLevel: daily.dataLevel,
  isFinal: daily.isFinal,
  bucket:
    daily.dataLevel === BOARD_DATA_LEVEL.FULL
      ? resolveBoardScoreBucket(daily.scoreRate)
      : BOARD_SCORE_BUCKET.NONE,
});

/** 行序是否被用户自定义（未自定义 ⇒ 表格按热门口径自动排序） */
const hasCustomOrder = computed<boolean>(
  () => !isDefaultBoardOrder(settingsStore.boardCalendarOrder),
);

/** 需要在表格中渲染的板块（已剔除未勾选项，顺序 = 用户保存的顺序） */
const visibleBoards = computed<Array<{ code: string; name: string }>>(() => {
  const hidden = new Set(normalizeBoardHidden(settingsStore.boardCalendarHidden));
  const byCode = new Map(CALENDAR_BOARDS.map((board) => [board.code, board]));
  const boards: Array<{ code: string; name: string }> = [];
  for (const code of normalizeBoardOrder(settingsStore.boardCalendarOrder)) {
    const board = byCode.get(code);
    if (board && !hidden.has(code)) {
      boards.push(board);
    }
  }
  return boards;
});

/** 每行的热门指标（近 N 日累计涨停 / 最新一日成交额；不随展示范围变化） */
const heatStatsByCode = computed<Map<string, { heatLimitUp: number; latestAmount: number }>>(
  () => {
    const byKey = new Map<string, BoardDailyRow>();
    for (const row of dailyRows.value) {
      byKey.set(`${row.tradeDate}|${row.boardCode}`, row);
    }
    const streakDates = [...tradingDates.value].reverse().slice(0, HEAT_STREAK_WINDOW);
    const latest = selectedDates.value[0] ?? '';
    const stats = new Map<string, { heatLimitUp: number; latestAmount: number }>();
    for (const board of CALENDAR_BOARDS) {
      let heatLimitUp = 0;
      for (const date of streakDates) {
        heatLimitUp += byKey.get(`${date}|${board.code}`)?.limitUp ?? 0;
      }
      stats.set(board.code, {
        heatLimitUp,
        latestAmount:
          latest === '' ? 0 : (byKey.get(`${latest}|${board.code}`)?.amount ?? 0),
      });
    }
    return stats;
  },
);

/** 当前热门口径下各板块的热门值（过滤器弹窗展示 + 「按热门重排」用） */
const heatValues = computed<Record<string, number>>(() => {
  const basis = settingsStore.boardCalendarHeatBasis;
  const result: Record<string, number> = {};
  for (const [code, stat] of heatStatsByCode.value) {
    result[code] =
      basis === BOARD_CALENDAR_HEAT_BASIS.AMOUNT ? stat.latestAmount : stat.heatLimitUp;
  }
  return result;
});

/** 当前热门口径的展示名（过滤器弹窗显示每个板块的热门值） */
const heatLabel = computed<string>(
  () =>
    BOARD_CALENDAR_HEAT_OPTIONS.find(
      (item) => item.value === settingsStore.boardCalendarHeatBasis,
    )?.label ?? '',
);

/** 库内有板块日聚合数据的交易日集合（列过滤基准） */
const dataDates = computed<Set<string>>(() => new Set(dailyRows.value.map((row) => row.tradeDate)));

/**
 * 实际渲染的日期列：范围列 ∩ 周一~周五 ∩ 库内有数据日
 *
 * 王总 2026-10-13：板块日历只显示交易日列，非交易日列不显示——
 * 交易日轴覆盖约 1.5 年（400 根日 K），「全部」档下绝大多数列没有快照数据，
 * 整列 `--` 观感等同非交易日；这里把「非周一~周五」与「无任何板块数据」的列都剔除，
 * 列数随数据覆盖自然收敛（数据未覆盖到的历史日不渲染空列）。
 */
const matrixDates = computed<string[]>(() =>
  selectedDates.value.filter((date) => {
    const weekday = new Date(`${date}T00:00:00`).getDay();
    return weekday !== 0 && weekday !== 6 && dataDates.value.has(date);
  }),
);

/** 矩阵：可见板块行 × 当前范围列（自定义顺序优先，否则按热门口径降序） */
const matrix = computed<BoardCalendarMatrix>(() => {
  const dates = matrixDates.value;
  const byKey = new Map<string, BoardDailyRow>();
  for (const row of dailyRows.value) {
    byKey.set(`${row.tradeDate}|${row.boardCode}`, row);
  }

  const rows: BoardCalendarRow[] = visibleBoards.value.map((board) => {
    const stat = heatStatsByCode.value.get(board.code);
    return {
      code: board.code,
      name: board.name,
      cells: dates.map((date) => {
        const daily = byKey.get(`${date}|${board.code}`);
        return daily ? toCell(daily) : null;
      }),
      heatLimitUp: stat?.heatLimitUp ?? 0,
      latestAmount: stat?.latestAmount ?? 0,
    };
  });

  // 自定义顺序优先：用户拖拽保存过顺序就不再自动排序；
  // 未自定义（或点了「恢复默认」）时按热门口径降序
  if (!hasCustomOrder.value) {
    const basis = settingsStore.boardCalendarHeatBasis;
    rows.sort((a, b) => {
      if (basis === BOARD_CALENDAR_HEAT_BASIS.AMOUNT) {
        return b.latestAmount - a.latestAmount;
      }
      return b.heatLimitUp - a.heatLimitUp || b.latestAmount - a.latestAmount;
    });
  }
  return { dates, rows };
});

/** 空态文案（区分「全部隐藏」与「尚无数据」） */
const emptyText = computed<string>(() =>
  visibleBoards.value.length === 0
    ? '已隐藏全部板块，请点击「板块过滤器」勾选需要显示的板块'
    : '暂无板块日历数据，请点击右上角「刷新」采集',
);

/** 数据覆盖的交易日数（交易日轴上有数据的列数） */
const coveredDateCount = computed<number>(() => {
  const withData = new Set(dailyRows.value.map((row) => row.tradeDate));
  return tradingDates.value.filter((date) => withData.has(date)).length;
});

/** 加载文案 */
const rangeLabel = computed<string>(
  () => BOARD_CALENDAR_RANGE_OPTIONS.find((item) => item.value === settingsStore.boardCalendarRange)?.label ?? '',
);

/**
 * 赚钱效应气泡图的数据源：最新一个「完整快照」交易日
 *
 * 优先取有涨跌家数的完整快照日（回补日得分只由涨跌停推导，口径不可比），
 * 一个都没有时才退回最新一天并标记为非完整，由弹窗给出提示。
 * 这里**不受页面「板块过滤器」影响**：气泡图看的是全市场当日赚钱效应。
 */
const profitSnapshot = computed<{
  tradeDate: string;
  rows: BoardDailyRow[];
  isFullSnapshot: boolean;
}>(() => {
  const byDate = new Map<string, BoardDailyRow[]>();
  for (const row of dailyRows.value) {
    const list = byDate.get(row.tradeDate);
    if (list) {
      list.push(row);
    } else {
      byDate.set(row.tradeDate, [row]);
    }
  }
  const dates = [...byDate.keys()].sort();
  let picked = '';
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    const dayRows = byDate.get(dates[index]) ?? [];
    if (dayRows.some((row) => row.dataLevel === BOARD_DATA_LEVEL.FULL)) {
      picked = dates[index];
      break;
    }
  }
  if (picked === '') {
    picked = dates[dates.length - 1] ?? '';
  }
  const rows = picked === '' ? [] : (byDate.get(picked) ?? []);
  return {
    tradeDate: picked,
    rows,
    isFullSnapshot: rows.length > 0 && rows.every((row) => row.dataLevel === BOARD_DATA_LEVEL.FULL),
  };
});

/**
 * 板块分析矩阵：每个交易日按得分绝对值取前 N 名转置成「行 = 名次、列 = 日期」
 *
 * 与日历矩阵共用同一份 dailyRows 与展示范围（板块过滤器不影响——
 * 分析看的是全市场在做什么，隐藏个别板块不改变市场结构）。
 */
const mainlineMatrix = computed(() =>
  buildBoardMainlineMatrix(dailyRows.value, matrixDates.value, BOARD_MAINLINE_TOP_N),
);

/**
 * 从本地库读取矩阵数据（交易日轴 + 板块日聚合 + 板块档案）
 *
 * 两步分别归因：交易日轴失败是上游问题，读库失败是本地库问题，
 * 不能共用一个「检查网络」文案（否则真实原因会被掩盖）。
 *
 * 交易日轴走采集层的共享缓存（入库后只做增量），页面轮询默认不产生任何上游请求。
 * @param forceAxis 是否强制重拉交易日轴（仅用户点「刷新」时为 true）
 */
const refresh = async (forceAxis: boolean): Promise<void> => {
  isLoading.value = true;
  try {
    let dates: string[];
    try {
      dates = await getTradingDates(forceAxis);
      dataCache.set(DATA_CACHE_KEY.BOARD_CALENDAR_DATES, dates);
    } catch (error) {
      console.error('[board-calendar] 交易日轴取数失败', handleSdkError(error));
      errorText.value = '交易日轴获取失败，请检查网络后重试';
      return;
    }

    tradingDates.value = dates;
    const descending = [...dates].reverse();
    const limit = rangeLimit.value;
    const selected = limit === null ? descending : descending.slice(0, limit);

    try {
      const [rowList, profileList] = await Promise.all([
        listBoardDailyByDates(selected),
        listBoardProfiles(),
      ]);
      dailyRows.value = rowList;
      profiles.value = profileList;
      dataCache.set(DATA_CACHE_KEY.BOARD_CALENDAR_MATRIX, rowList);
      lastUpdatedAt.value = Date.now();
      errorText.value = null;
    } catch (error) {
      console.error('[board-calendar] 本地库读取失败', handleSdkError(error));
      errorText.value = '本地板块数据库读取失败，请查看开发者控制台日志';
    }
  } finally {
    isLoading.value = false;
  }
};

/**
 * 轮询任务：先用手头数据渲染 → 采集 → 再重读
 *
 * 顺序很重要：采集（首次含成分股重建，可达数十秒）不能挡在首次读库前面，
 * 否则首屏会一直空白。采集失败只提示、不清空已渲染的数据。
 *
 * ⚠️ 这里刻意传 `false`：交易日轴由采集层按「当天是否已确认」自动决定要不要重拉，
 * 若传 `true` 会让每 30s 的轮询都强制打一次腾讯日 K（入库后只做增量的原则就失效了）。
 */
const pollTask = async (): Promise<void> => {
  // 首屏：不等采集，立即用库内已有数据 + 缓存交易日轴渲染（命中缓存即 0 请求）
  await refresh(false);
  if (!isDbAvailable) return;

  const result = await syncBoardCalendar();
  // 采集后重读；交易日轴复用上一步刚取的，不再重复请求
  await refresh(false);
  // 采集错误只在读库没报错时展示（读库错误更具体，优先保留）
  if (result.error && !errorText.value) {
    errorText.value = result.error;
  }
};

// 交易窗口内每 30s 采集 + 重读；窗口外仅在挂载时执行一次
usePolling({
  task: pollTask,
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

/**
 * 手动强制重采当日（刷新按钮）
 */
const onForceRefresh = async (): Promise<void> => {
  if (isForcing.value) return;
  isForcing.value = true;
  try {
    const result = await syncBoardCalendar({ force: true });
    await refresh(true);
    // 放在 refresh 之后：refresh 成功会把 errorText 清空，先赋值会被吞掉
    if (result.error && !errorText.value) {
      errorText.value = result.error;
    }
  } finally {
    isForcing.value = false;
  }
};

/**
 * 表头「获取 / 刷新板块数据」弹窗点「应用」后：数据已落库，重读本地库刷新表格
 *
 * 刻意传 `false`：交易日轴未变化（采集层只加了日数据），强制重拉只会白打一次腾讯日 K。
 */
const onSyncApplied = (): void => {
  void refresh(false);
};

/**
 * 打开单元格详情弹窗
 * @param row 行
 * @param cell 单元格
 * @param tradeDate 交易日
 */
const onCellClick = (
  row: BoardCalendarRow,
  cell: BoardCalendarCell | null,
  tradeDate: string,
): void => {
  if (!cell) return;
  activeRow.value = row;
  activeCell.value = cell;
  activeDate.value = tradeDate;
  activeProfileConsCount.value = profiles.value.find((item) => item.code === row.code)?.consCount ?? 0;
  modalOpen.value = true;
};

/**
 * 点击板块名称：进入板块详情页（成分股 × 交易日 涨跌幅矩阵）
 * @param row 被点击的板块行
 */
const onBoardClick = (row: BoardCalendarRow): void => {
  void router.push(`${ROUTE_PATH.BOARD_DETAIL}/${row.code}`);
};

/**
 * 点击主线分析单元格：进入板块详情页（与板块名点击同一路由）
 * @param cell 被点击的单元格（携带板块代码）
 */
const onMainlineCellClick = (cell: BoardMainlineCell): void => {
  void router.push(`${ROUTE_PATH.BOARD_DETAIL}/${cell.boardCode}`);
};

/**
 * 确认板块过滤器：持久化勾选与行序（立即生效，下次进入自动恢复）
 * @param selection 勾选与顺序（已在弹窗内归一化）
 */
const onConfirmFilter = (selection: BoardColumnSelection): void => {
  settingsStore.setBoardCalendarColumns(selection.order, selection.hidden);
};

/** 规则提示文案 */
const NOTICE_TEXT =
  '单元格得分 = 涨停×10 + 跌停×-10 + 净上涨×5 + 净下跌×-5（净额口径：涨停 / 跌停不重复计入上涨 / 下跌）。' +
  '背景色按「得分率 = 得分 ÷ 成分股数」取 7 档涨跌语义色：越亮赚钱效应越强，越暗越弱；颜色随涨跌配色主题变化。' +
  '盘中为快照，15:00 后定稿。右上角带三角标记的格子是历史回补：板块级涨跌家数没有历史接口，' +
  '只有涨跌停数据（该日没开软件时由涨跌停池回补），故不带背景色、涨跌停数字照常可点开明细；' +
  '从本版本起每个交易日都以完整快照入库，可视范围内的历史色阶会随时间自然补齐。' +
  '点击左侧板块名称可进入板块详情（该板块成分股 × 交易日的涨跌幅矩阵）。';

/**
 * 图例中「历史回补」三角标记的示意样式（与 BoardCalendarGrid 的 .bc-backfill-mark 同款）
 */
const BACKFILL_MARK_STYLE: Record<string, string> = {
  borderTop: '10px solid var(--color-text-tertiary)',
  borderLeft: '10px solid transparent',
  borderTopRightRadius: '2px',
  opacity: '0.65',
};

/**
 * 图例色块样式（背景取档位色，随主题级联自动变化）
 * @param bucket 色阶档位
 * @returns 行内样式
 */
const legendSwatchStyle = (bucket: BoardScoreBucket): Record<string, string> => ({
  background: getBoardBucketBackground(bucket),
});
</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] min-h-0 flex-col gap-4">
    <!-- 板块过滤器上移 MainLayout 页头（Teleport 投射，本页激活时才挂载；弹窗仍留在页内） -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <BaseButton variant="ghost" @click="filterOpen = true">
        <MenuIcon name="filter" :size="14" />
        板块过滤器
        <span class="tabular-nums text-text-tertiary">
          {{ matrix.rows.length }}/{{ CALENDAR_BOARDS.length }}
        </span>
      </BaseButton>
    </Teleport>
    <!-- 视图页签行（参考行情全景：underline 页签独立成行，右侧状态与刷新） -->
    <div class="flex shrink-0 items-center justify-between gap-2">
      <BaseTabs v-model="calendarView" :options="BOARD_CALENDAR_VIEW_OPTIONS" variant="underline" />
      <div class="flex items-center gap-2">
        <span class="text-xs text-text-tertiary">
          <template v-if="lastUpdatedAt">更新于 {{ formatRelativeTime(lastUpdatedAt) }} · </template>
          {{ tradingDayLabel }} · {{ rangeLabel }}
        </span>
        <BaseButton variant="ghost" :disabled="isForcing || !isDbAvailable" @click="onForceRefresh">
          <MenuIcon name="refresh" :size="14" />
          {{ isForcing ? '采集中…' : '刷新' }}
        </BaseButton>
      </div>
    </div>

    <!-- 控制条：热门口径 / 范围 / 恢复排序（内容高固定，剩余高度全部留给矩阵） -->
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <BaseTabs
        :model-value="settingsStore.boardCalendarHeatBasis"
        :options="BOARD_CALENDAR_HEAT_OPTIONS"
        @update:model-value="settingsStore.setBoardCalendarHeatBasis($event as never)"
      />
      <BaseTabs
        :model-value="settingsStore.boardCalendarRange"
        :options="BOARD_CALENDAR_RANGE_OPTIONS"
        @update:model-value="settingsStore.setBoardCalendarRange($event as never)"
      />
      <button
        v-if="hasCustomOrder"
        type="button"
        class="pressable rounded-lg px-1.5 py-1 text-xs text-primary hover:underline"
        title="清除自定义行序，回到按热门口径自动排序"
        @click="settingsStore.resetBoardCalendarColumns()"
      >
        恢复热门排序
      </button>
    </div>

    <NoticeBar :text="NOTICE_TEXT" />

    <!-- 浏览器端降级提示 -->
    <p v-if="!isDbAvailable" class="text-xs text-text-tertiary" role="note">
      当前为浏览器环境，无法本地累积历史（数据仅当日可见）。需要逐日累积请在桌面客户端使用。
    </p>

    <p v-if="errorText" class="text-xs text-down" role="alert">{{ errorText }}</p>

    <!-- 矩阵卡片：矩阵本身是卡片的直接 flex 子项，用 board-calendar-fill 吃满剩余高度 -->
    <BaseCard
      v-if="calendarView === BOARD_CALENDAR_VIEW.LIST"
      fill
      class="min-h-0 flex-1"
      :title="`板块日历 · 板块 ${matrix.rows.length}/${CALENDAR_BOARDS.length} 个 · 覆盖 ${coveredDateCount} 个交易日`"
    >
      <!-- 图例入口（问号气泡）+ 表头数据维护入口（获取 / 刷新板块数据） -->
      <template #extra>
        <div class="flex items-center gap-3">
          <div class="relative">
            <button
              type="button"
              class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
              aria-label="涨跌档位图例"
              title="涨跌档位图例"
              @click="legendOpen = !legendOpen"
            >
              <MenuIcon name="help" :size="14" />
            </button>

            <!-- 透明遮罩：点外部收起气泡 -->
            <div v-if="legendOpen" class="fixed inset-0 z-30" @click="legendOpen = false" />

            <!-- 图例气泡：7 档得分率色阶 + 历史回补 + 无数据 -->
            <div
              v-if="legendOpen"
              class="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-flat-weak bg-surface p-3 shadow-xl"
              role="tooltip"
            >
              <p class="mb-2 text-xs font-medium text-text">涨跌档位（得分率 = 得分 ÷ 成分股数）</p>
              <ul class="space-y-1.5 text-[11px] text-text-tertiary">
                <li
                  v-for="item in BOARD_SCORE_LEGEND"
                  :key="item.bucket"
                  class="flex items-center gap-2"
                >
                  <i
                    class="inline-block h-3 w-3 shrink-0 rounded-sm"
                    :style="legendSwatchStyle(item.bucket)"
                  />
                  {{ item.label }} {{ item.hint }}
                </li>
                <li class="flex items-center gap-2">
                  <i class="inline-block h-3 w-3 shrink-0" :style="BACKFILL_MARK_STYLE" />
                  历史回补（缺涨跌家数）
                </li>
                <li class="flex items-center gap-2">
                  <i class="inline-block h-3 w-3 shrink-0 rounded-sm border border-dashed border-flat-weak" />
                  无数据
                </li>
              </ul>
            </div>
          </div>
          <!-- 应用 = 采集数据已写入本地库，重读即可（交易日轴未变，无需强制重拉） -->
          <BoardDataSyncMenu @applied="onSyncApplied" />
        </div>
      </template>

      <BaseSkeleton v-if="isLoading && matrix.rows.length === 0" />
      <BaseEmpty
        v-else-if="matrix.rows.length === 0 || matrix.dates.length === 0"
        :text="emptyText"
      />
      <BoardCalendarGrid
        v-else
        :matrix="matrix"
        scroll-class="board-calendar-fill"
        @cell-click="onCellClick"
        @board-click="onBoardClick"
      />
    </BaseCard>

    <!-- 板块分析卡片：每日得分绝对值 Top10 的「名次 × 日期」转置表 -->
    <BaseCard
      v-else-if="calendarView === BOARD_CALENDAR_VIEW.MAINLINE"
      fill
      class="min-h-0 flex-1"
      title="板块分析"
    >
      <BaseSkeleton v-if="isLoading && dailyRows.length === 0" />
      <BaseEmpty
        v-else-if="dailyRows.length === 0"
        text="暂无板块日历数据，请点击右上角「刷新」采集"
      />
      <div v-else class="min-h-0 flex-1">
        <BoardMainlinePanel :matrix="mainlineMatrix" @cell-click="onMainlineCellClick" />
      </div>
    </BaseCard>

    <!-- 赚钱效应气泡图卡片（原「查看赚钱效应」弹窗内容内嵌为主区视图） -->
    <BaseCard
      v-else
      fill
      class="min-h-0 flex-1"
      title="赚钱效应气泡图"
    >
      <div class="min-h-0 flex-1">
        <BoardProfitBubblePanel
          :rows="profitSnapshot.rows"
          :trade-date="profitSnapshot.tradeDate"
          :is-full-snapshot="profitSnapshot.isFullSnapshot"
        />
      </div>
    </BaseCard>

    <BoardFilterModal
      v-model:open="filterOpen"
      :order="settingsStore.boardCalendarOrder"
      :hidden="settingsStore.boardCalendarHidden"
      :heat-values="heatValues"
      :heat-label="heatLabel"
      @confirm="onConfirmFilter"
    />

    <BoardCellDetailModal
      v-model:open="modalOpen"
      :board="activeRow"
      :cell="activeCell"
      :trade-date="activeDate"
      :profile-cons-count="activeProfileConsCount"
    />
  </div>
</template>
