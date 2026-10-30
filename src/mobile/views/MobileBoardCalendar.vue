<script setup lang="ts">
/**
 * 板块日历（v2 二期二级页，稿：market-modules-v2 C0-C2；规范：DESIGN-MOBILE.md §5.3）
 *
 * 双模式（路由参数区分，同组件）：
 * - 列表模式 /board-calendar：板块×交易日矩阵，格值=涨停/跌停家数，背景=得分率 7 档色阶
 *   （口径同 PC：resolveBoardScoreBucket(scoreRate)，仅 FULL 数据参与色阶）；
 *   点格弹 bottom sheet 当日涨跌停明细（个股行可点进个股页）
 * - 详情模式 /board-calendar/:code：成分股×日涨跌幅矩阵（±2/±5 阈值色阶，同 PC 详情矩阵）
 * 数据：本地 SQLite（board-calendar-db.api，Android Tauri 与桌面同库）；H5 无 Tauri 时降级提示
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  BOARD_CALENDAR_RANGE,
  BOARD_CALENDAR_RANGE_DEFAULT,
  BOARD_CALENDAR_RANGE_OPTIONS,
  BOARD_DATA_LEVEL,
  CALENDAR_BOARDS,
} from '../../common/constants/board-calendar.constants';
import {
  BOARD_DETAIL_RANGE_DEFAULT,
  BOARD_DETAIL_RANGE_OPTIONS,
} from '../../common/constants/board-detail.constants';
import { TREND_COLOR_LEVEL } from '../../common/constants/stock-colors.constants';
import {
  isBoardDbAvailable,
  listBoardDailyByDates,
  listLimitStocks,
} from '../../common/api/board-calendar-db.api';
import { getTradingDates, syncBoardCalendar } from '../../common/composables/use-board-calendar-sync';
import { loadBoardDetailMatrix } from '../../common/api/board-detail.api';
import type { BoardDailyRow } from '../../common/types/board-calendar.types';
import type { BoardDetailRow } from '../../common/types/board-detail.types';
import { resolveBoardScoreBucket } from '../../common/utils/board-score-colors';
import { toFullSymbol } from '../../common/utils/to-full-symbol';
import { pctClass } from '../utils/format';

const route = useRoute();
const router = useRouter();

/** 详情模式的板块 code（路由参数驱动） */
const detailCode = computed(() => (typeof route.params.code === 'string' ? route.params.code : ''));
const isDetail = computed(() => detailCode.value !== '');
const detailName = computed(
  () => CALENDAR_BOARDS.find((b) => b.code === detailCode.value)?.name ?? detailCode.value,
);

/* === 共用：交易日轴 === */
const dbAvailable = isBoardDbAvailable();
const tradingDates = ref<string[]>([]);
const datesLoading = ref(false);

const loadTradingDates = async (): Promise<boolean> => {
  if (tradingDates.value.length) return true;
  datesLoading.value = true;
  try {
    // getTradingDates 与采集共用缓存（内存 → 库内 board_sync_state → 上游腾讯日K），
    // 命中即 0 请求。此前直接 fetchTradingDates：既不落库缓存，失败还会以
    // unhandled rejection 逃逸（watch 里 void 调用），页面静默空白——正是
    // 「板块日历一直不生效」的表现之一（2026-10-13 修复）
    tradingDates.value = [...(await getTradingDates())].reverse();
    return true;
  } catch {
    return false;
  } finally {
    datesLoading.value = false;
  }
};

/* === 列表模式：板块×日 矩阵 === */
const range = ref<string>(BOARD_CALENDAR_RANGE_DEFAULT);
const matrixRows = ref<BoardDailyRow[]>([]);
const matrixLoading = ref(false);
const matrixError = ref(false);

const selectedDates = computed<string[]>(() => {
  if (range.value === BOARD_CALENDAR_RANGE.ALL) return tradingDates.value;
  const n = Number(range.value);
  return tradingDates.value.slice(0, n);
});

/** 行序：热门板块在前（PC 口径是用户自定义顺序，移动端先用常量序） */
const boardRows = computed(() =>
  CALENDAR_BOARDS.map((b) => ({
    code: b.code,
    name: b.name,
    cells: selectedDates.value.map((d) => cellByKey.value.get(`${d}|${b.code}`) ?? null),
  })),
);

const cellByKey = computed(() => {
  const map = new Map<string, BoardDailyRow>();
  for (const row of matrixRows.value) {
    map.set(`${row.tradeDate}|${row.boardCode}`, row);
  }
  return map;
});

/** 首次采集进行中（本地库无任何数据时自动触发，完成后自动刷新矩阵） */
const collecting = ref(false);
/** 每次会话只自动触发一次采集（失败也等下次进页再试，避免死循环刷请求） */
let autoSyncAttempted = false;

const loadMatrix = async (): Promise<void> => {
  if (!dbAvailable) return;
  matrixError.value = false;
  if (!(await loadTradingDates())) {
    matrixError.value = true;
    return;
  }
  if (!selectedDates.value.length) return;
  matrixLoading.value = true;
  try {
    matrixRows.value = await listBoardDailyByDates(selectedDates.value);
    // 本地库还没有任何板块日数据（首次安装 / v4.7.1 前移动端从不采集）→ 自动补一次采集；
    // syncBoardCalendar 自带并发闸门，与 App 挂载钩子并发时复用同一次，不会重复请求
    if (!matrixRows.value.length && !autoSyncAttempted) {
      autoSyncAttempted = true;
      collecting.value = true;
      void syncBoardCalendar()
        .then(() => loadMatrix())
        .finally(() => {
          collecting.value = false;
        });
    }
  } catch {
    matrixError.value = true;
  } finally {
    matrixLoading.value = false;
  }
};

/** 格子视图：主值=涨停家数，副值=跌停家数；色阶档位 */
interface CellView {
  up: number | null;
  down: number | null;
  level: string;
  strong: boolean;
}
const toCellView = (row: BoardDailyRow | null): CellView => {
  if (!row || row.dataLevel !== BOARD_DATA_LEVEL.FULL) {
    return { up: null, down: null, level: 'm-cal-l0', strong: false };
  }
  const bucket = resolveBoardScoreBucket(row.scoreRate);
  const map: Record<string, string> = {
    upStrong: 'm-cal-l3',
    up: 'm-cal-l2',
    upLight: 'm-cal-l1',
    flat: 'm-cal-l0',
    downLight: 'm-cal-l4',
    down: 'm-cal-l5',
    downStrong: 'm-cal-l6',
    none: 'm-cal-l0',
  };
  return {
    up: row.limitUp,
    down: row.limitDown,
    level: map[bucket] ?? 'm-cal-l0',
    strong: bucket === 'upStrong' || bucket === 'downStrong',
  };
};

/* === 点格 → 涨跌停明细 bottom sheet === */
const sheetVisible = ref(false);
const sheetDate = ref('');
const sheetBoardName = ref('');
const sheetStocks = ref<BoardDailyRowLimitStock[]>([]);
const sheetLoading = ref(false);

// listLimitStocks 返回 BoardLimitStock（db 行视图）；本地别名避免直接依赖深层类型路径
interface BoardDailyRowLimitStock {
  symbol: string;
  name: string;
  limitType: number;
  changePercent: number | null;
  price: number | null;
  sealTime: string | null;
}

const onCellClick = async (boardCode: string, boardName: string, date: string): Promise<void> => {
  sheetDate.value = date;
  sheetBoardName.value = boardName;
  sheetVisible.value = true;
  sheetLoading.value = true;
  try {
    sheetStocks.value = (await listLimitStocks(date, boardCode)) as BoardDailyRowLimitStock[];
  } catch {
    sheetStocks.value = [];
  } finally {
    sheetLoading.value = false;
  }
};

const goStock = (symbol: string): void => {
  if (!symbol) return;
  sheetVisible.value = false;
  void router.push(`/stock/${toFullSymbol(symbol)}`);
};

/* === 详情模式：成分股×日 涨跌幅矩阵 === */
const detailRange = ref<string>(BOARD_DETAIL_RANGE_DEFAULT);
const detailRows = ref<BoardDetailRow[]>([]);
const detailDates = ref<string[]>([]);
const detailLoading = ref(false);
const detailError = ref(false);

const detailSelectedDates = computed<string[]>(() => {
  const n = Number(detailRange.value);
  return tradingDates.value.slice(0, n);
});

/** 详情格色阶（±2/±5，同 PC TREND_COLOR_LEVEL）：红涨绿跌
 * @param v 当日涨跌幅（%，null 视为无数据）
 * @returns 色阶 class 名 */
const detailCellClass = (v: number | null): string => {
  if (v === null || v === 0) return 'm-cal-l0';
  if (v > TREND_COLOR_LEVEL.STRONG) return 'm-cal-l3';
  if (v > TREND_COLOR_LEVEL.MEDIUM) return 'm-cal-l2';
  if (v > 0) return 'm-cal-l1';
  if (v < -TREND_COLOR_LEVEL.STRONG) return 'm-cal-l6';
  if (v < -TREND_COLOR_LEVEL.MEDIUM) return 'm-cal-l5';
  return 'm-cal-l4';
};

const loadDetail = async (): Promise<void> => {
  if (!dbAvailable || !detailCode.value) return;
  if (!(await loadTradingDates())) {
    detailError.value = true;
    return;
  }
  if (!detailSelectedDates.value.length) return;
  detailLoading.value = true;
  detailError.value = false;
  try {
    const result = await loadBoardDetailMatrix({
      boardCode: detailCode.value,
      dates: detailSelectedDates.value,
    });
    detailRows.value = result.rows;
    detailDates.value = detailSelectedDates.value;
  } catch {
    detailError.value = true;
  } finally {
    detailLoading.value = false;
  }
};

/* === 路由/范围联动 === */
watch(
  () => [isDetail.value, detailCode.value],
  () => {
    if (isDetail.value) void loadDetail();
    else void loadMatrix();
  },
  { immediate: true },
);
watch(range, () => void loadMatrix());
watch(detailRange, () => void loadDetail());

const onRangeClick = (v: string): void => {
  if (isDetail.value) detailRange.value = v;
  else range.value = v;
};

/** 当前模式的范围档位（列表 / 详情两套） */
const rangeOptions = computed(() =>
  isDetail.value ? BOARD_DETAIL_RANGE_OPTIONS : BOARD_CALENDAR_RANGE_OPTIONS,
);

/** 范围 Tabs 绑定下标（van-tabs 的 active 是 index，这里做 index ↔ range value 互转） */
const activeRangeIndex = computed({
  get: () =>
    Math.max(
      0,
      rangeOptions.value.findIndex(
        (opt) => opt.value === (isDetail.value ? detailRange.value : range.value),
      ),
    ),
  set: (index: number) => onRangeClick(rangeOptions.value[index]!.value),
});

const back = (): void => {
  router.back();
};

const fmtPct = (v: number | null): string => (v === null ? '--' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar
      :title="isDetail ? detailName : '板块日历'"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="back"
    />

    <!-- 范围分组 Tabs（参考今天炒什么：van-tabs 选择器模式；列表 6 档 / 详情 6 档，
         :key 按模式强制重挂——tab 数组变化时 Vant 的 setLine 会跑在新 TabTitle
         ref 登记之前而静默跳过，重挂走 init 测量路径才准，同今天炒什么换源先例） -->
    <van-tabs
      :key="isDetail ? 'detail' : 'list'"
      v-model:active="activeRangeIndex"
      class="m-tabs m-tabs--selector"
      :ellipsis="false"
    >
      <van-tab v-for="opt in rangeOptions" :key="opt.value" :title="opt.label" />
    </van-tabs>

    <!-- H5 无 Tauri SQLite 降级 -->
    <div v-if="!dbAvailable" class="m-state">
      板块日历依赖本地数据库，当前环境不可用
    </div>

    <div v-else class="m-sub-scroll">
      <!-- 加载/错误 -->
      <div v-if="isDetail ? detailLoading : matrixLoading" class="m-card m-skel-fill">
        <div v-for="i in 10" :key="i" class="m-skel-row"></div>
      </div>
      <div v-else-if="isDetail ? detailError : matrixError" class="m-state">
        矩阵数据加载失败
        <span class="retry" @click="isDetail ? loadDetail() : loadMatrix()">重试</span>
      </div>

      <!-- === 列表矩阵 === -->
      <template v-else-if="!isDetail">
        <!-- 首次采集横幅（本地库无数据时自动触发，完成后自动刷新） -->
        <div v-if="collecting" class="m-sec">
          <span class="m-sec__s">本地暂无日历数据，正在首次采集（约需 1~2 分钟），完成后自动刷新…</span>
        </div>
        <div class="m-cal-legend">
          <span>色阶</span>
          <i class="m-cal-l3"></i>强多
          <i class="m-cal-l2"></i>偏多
          <i class="m-cal-l1"></i>弱多
          <i class="m-cal-l4"></i>弱空
          <i class="m-cal-l5"></i>偏空
          <i class="m-cal-l6"></i>强空
        </div>
        <template v-if="matrixRows.length">
          <div
            class="m-cal-scroll m-card"
            :style="{ '--days': selectedDates.length }"
          >
            <div class="m-cal-head">
              <div class="m-cal-cell">板块</div>
              <div v-for="d in selectedDates" :key="d" class="m-cal-cell">{{ d.slice(5) }}</div>
            </div>
            <div v-for="row in boardRows" :key="row.code" class="m-cal-row">
              <div class="m-cal-row__name">{{ row.name }}</div>
              <div
                v-for="(cell, idx) in row.cells"
                :key="idx"
                class="m-cal-day"
                :class="toCellView(cell).level"
                @click="cell && onCellClick(row.code, row.name, selectedDates[idx]!)"
              >
                <div class="m-cal-day__v" :class="toCellView(cell).strong ? '' : ''">
                  {{ cell ? (cell.limitUp || 0) : '·' }}
                </div>
                <div class="m-cal-day__s">{{ cell ? (cell.limitDown || 0) : '' }}</div>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="m-state">
          {{ collecting ? '采集完成后自动显示矩阵' : '暂无板块日历数据，可下拉重进本页重试' }}
        </div>
        <div class="m-sec">
          <span class="m-sec__s">格内数字：涨停家数 / 跌停家数 · 点格看明细</span>
        </div>
      </template>

      <!-- === 详情矩阵（成分股×日涨跌幅） === -->
      <template v-else>
        <div class="m-cal-legend">
          <span>色阶</span>
          <i class="m-cal-l3"></i>&gt;5%
          <i class="m-cal-l2"></i>2~5%
          <i class="m-cal-l1"></i>0~2%
          <i class="m-cal-l4"></i>-2~0%
          <i class="m-cal-l5"></i>-5~-2%
          <i class="m-cal-l6"></i>&lt;-5%
        </div>
        <div class="m-cal-scroll m-card" :style="{ '--days': detailDates.length }">
          <div class="m-cal-head">
            <div class="m-cal-cell">成分股</div>
            <div v-for="d in detailDates" :key="d" class="m-cal-cell">{{ d.slice(5) }}</div>
          </div>
          <div v-for="row in detailRows" :key="row.symbol" class="m-cal-row" @click="goStock(row.fullSymbol)">
            <div class="m-cal-row__name">{{ row.name }}</div>
            <div
              v-for="(v, idx) in row.cells"
              :key="idx"
              class="m-cal-day"
              :class="detailCellClass(v)"
            >
              <div class="m-cal-day__v" :class="pctClass(v)">{{ v === null ? '·' : v.toFixed(1) }}</div>
            </div>
          </div>
          <div v-if="!detailRows.length" class="m-state">暂无成分股数据</div>
        </div>
      </template>
      <div class="m-sub-tail"></div>
    </div>

    <!-- 点格：涨跌停明细 bottom sheet -->
    <van-popup v-model:show="sheetVisible" position="bottom" round>
      <div class="m-sec">
        <span class="m-sec__t">{{ sheetBoardName }} · {{ sheetDate }}</span>
        <span class="m-sec__s">涨跌停明细</span>
      </div>
      <div style="max-height: 50vh; overflow-y: auto">
        <div v-if="sheetLoading" class="m-skel-block">
          <div v-for="i in 8" :key="i" class="m-skel-row"></div>
        </div>
        <div v-else-if="!sheetStocks.length" class="m-state">当日无涨跌停记录</div>
        <div v-else class="m-card" style="border: none">
          <div
            v-for="(s, i) in sheetStocks"
            :key="`${s.symbol}-${i}`"
            class="m-row"
            @click="goStock(s.symbol)"
          >
            <div class="m-row__nm">
              {{ s.name }}
              <span class="sub">{{ s.symbol }}{{ s.sealTime ? ` · 封板 ${s.sealTime}` : '' }}</span>
            </div>
            <span
              class="m-row__pct pill"
              :class="s.limitType === 1 ? 'up' : 'down'"
            >
              {{ s.limitType === 1 ? '涨停' : '跌停' }}
              {{ fmtPct(s.changePercent) }}
            </span>
          </div>
        </div>
      </div>
    </van-popup>
  </div>
</template>
