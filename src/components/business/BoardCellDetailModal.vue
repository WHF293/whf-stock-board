<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseTable from '../ui/BaseTable.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import { fetchBoardConstituentQuotes, getLocalDateString } from '../../api/board-calendar.api';
import { listLimitStocks } from '../../api/board-calendar-db.api';
import { BOARD_SCORE_LEGEND } from '../../constants/board-calendar.constants';
import { NUMBER_PLACEHOLDER } from '../../constants/format.constants';
import { TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import type {
  BoardCalendarCell,
  BoardCalendarRow,
  BoardConstituentQuote,
  BoardLimitStock,
} from '../../types/board-calendar.types';
import type { TableColumn } from '../../types/table.types';
import { formatBoardTime } from '../../utils/format-board-time';
import { formatPercent, formatPercentUnsigned } from '../../utils/format-percent';
import { formatYuan } from '../../utils/format-yuan';
import { handleSdkError } from '../../utils/handle-sdk-error';

/**
 * 板块日历 · 单元格详情弹窗
 *
 * 两个页签：
 * ① 涨跌停明细 —— 来自本地库 board_limit_stock，历史任意交易日都可看（默认页签）
 * ② 全部成分股 —— 实时拉上游，**仅「当日」可用**（历史日没有成分股快照，避免误导）
 *
 * ⚠️ 需求明确要求「弹窗内点击股票不支持打开右侧个股详情」：
 * 两张表都**不传 row-clickable、不监听 row-click**，与全站表格惯例刻意相反，勿"修复"。
 */

/** 页签标识 */
const DETAIL_TAB = {
  LIMIT: 'limit',
  CONSTITUENT: 'constituent',
} as const;

/** 页签选项 */
const DETAIL_TAB_OPTIONS = [
  { label: '涨跌停明细', value: DETAIL_TAB.LIMIT },
  { label: '全部成分股', value: DETAIL_TAB.CONSTITUENT },
] as const;

/** 具备股票代码的行（两张表的 rowKey 共用结构） */
interface SymbolKeyedRow {
  /** 6 位股票代码 */
  symbol: string;
}

const props = defineProps<{
  /** 被点击的板块行 */
  board: BoardCalendarRow | null;
  /** 被点击的单元格（null 表示该日无快照） */
  cell: BoardCalendarCell | null;
  /** 交易日 */
  tradeDate: string;
  /** 板块档案里的当前成分股数（回补日快照无成分股数时的兜底展示） */
  profileConsCount: number;
}>();

const open = defineModel<boolean>('open', { required: true });

/** 当前页签 */
const activeTab = ref<string>(DETAIL_TAB.LIMIT);
/** 涨跌停明细 */
const limitStocks = ref<BoardLimitStock[]>([]);
/** 明细加载中 */
const isLoadingLimit = ref(false);
/** 成分股实时行情 */
const constituents = ref<BoardConstituentQuote[]>([]);
/** 成分股加载中 */
const isLoadingConstituent = ref(false);

/** 弹窗标题 */
const modalTitle = computed(() =>
  props.board ? `${props.board.name} ${props.board.code} · ${props.tradeDate}` : '板块详情',
);

/** 是否为「当日」（成分股页签仅在当日可用） */
const isToday = computed(() => props.tradeDate === getLocalDateString());

/** 该日是否为完整快照（回补日无涨跌家数与成交额） */
const isFullSnapshot = computed(() => props.cell?.dataLevel === 1);

/** 成分股数：优先用当日快照口径，回补日回落到板块档案 */
const consCount = computed(() => {
  const fromCell = props.cell?.consCount ?? 0;
  return fromCell > 0 ? fromCell : props.profileConsCount;
});

/** 摘要条：标签 + 文案（`--` 表示该口径当日不可得） */
const summaryItems = computed<Array<{ label: string; value: string }>>(() => {
  const cell = props.cell;
  if (!cell) return [];
  const bucketLabel =
    BOARD_SCORE_LEGEND.find((item) => item.bucket === cell.bucket)?.label ?? '中性';
  return [
    { label: '涨停', value: String(cell.limitUp) },
    { label: '跌停', value: String(cell.limitDown) },
    { label: '上涨', value: isFullSnapshot.value ? String(cell.upCount) : NUMBER_PLACEHOLDER },
    { label: '下跌', value: isFullSnapshot.value ? String(cell.downCount) : NUMBER_PLACEHOLDER },
    { label: '成分股', value: consCount.value > 0 ? String(consCount.value) : NUMBER_PLACEHOLDER },
    {
      label: '成交额',
      value: isFullSnapshot.value ? formatYuan(cell.amount) : NUMBER_PLACEHOLDER,
    },
    { label: '得分', value: isFullSnapshot.value ? String(Math.round(cell.score)) : NUMBER_PLACEHOLDER },
    {
      label: '得分率',
      value: isFullSnapshot.value
        ? `${cell.scoreRate.toFixed(2)}（${bucketLabel}）`
        : NUMBER_PLACEHOLDER,
    },
  ];
});

/** 涨跌停明细列 */
const limitColumns: TableColumn<BoardLimitStock>[] = [
  { key: 'limitType', label: '类型' },
  { key: 'name', label: '名称' },
  { key: 'symbol', label: '代码' },
  { key: 'changePercent', label: '涨跌幅', align: 'right' },
  { key: 'price', label: '现价', align: 'right' },
  { key: 'sealTime', label: '封板时间' },
  { key: 'limitStreak', label: '连板', align: 'right' },
  { key: 'openTimes', label: '炸板', align: 'right' },
  { key: 'amount', label: '成交额', align: 'right' },
];

/** 成分股列 */
const constituentColumns: TableColumn<BoardConstituentQuote>[] = [
  { key: 'name', label: '名称' },
  { key: 'symbol', label: '代码' },
  { key: 'changePercent', label: '涨跌幅', align: 'right' },
  { key: 'price', label: '现价', align: 'right' },
  { key: 'turnoverRate', label: '换手率', align: 'right' },
  { key: 'amount', label: '成交额', align: 'right' },
];

/**
 * 行 key（同一天内股票代码唯一）
 * @param stock 表格行
 * @returns 股票代码
 */
const stockRowKey = (stock: SymbolKeyedRow): string => stock.symbol;

/**
 * 加载本地库里的涨跌停明细
 */
const loadLimitStocks = async (): Promise<void> => {
  const board = props.board;
  if (!board) return;
  isLoadingLimit.value = true;
  try {
    limitStocks.value = await listLimitStocks(props.tradeDate, board.code);
  } catch (error) {
    console.error('[board-calendar]', handleSdkError(error));
    limitStocks.value = [];
  } finally {
    isLoadingLimit.value = false;
  }
};

/**
 * 加载成分股实时行情（仅当日有意义）
 */
const loadConstituents = async (): Promise<void> => {
  const board = props.board;
  if (!board || constituents.value.length > 0) return;
  isLoadingConstituent.value = true;
  try {
    constituents.value = await fetchBoardConstituentQuotes(board.code);
  } catch (error) {
    console.error('[board-calendar]', handleSdkError(error));
    constituents.value = [];
  } finally {
    isLoadingConstituent.value = false;
  }
};

// 打开时重置页签与数据，并按需拉取
watch(open, (isOpen) => {
  if (!isOpen) return;
  activeTab.value = DETAIL_TAB.LIMIT;
  constituents.value = [];
  void loadLimitStocks();
});

// 切到成分股页签时按需拉取（同一板块只拉一次）
watch(activeTab, (tab) => {
  if (tab === DETAIL_TAB.CONSTITUENT && isToday.value) {
    void loadConstituents();
  }
});
</script>

<template>
  <BaseModal v-model:open="open" :title="modalTitle" max-width-class="max-w-3xl">
    <!-- 摘要条 -->
    <div
      v-if="summaryItems.length > 0"
      class="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg bg-flat-weak px-3 py-2 text-xs"
    >
      <span v-for="item in summaryItems" :key="item.label" class="flex items-baseline gap-1">
        <span class="text-text-tertiary">{{ item.label }}</span>
        <span class="font-medium tabular-nums text-text">{{ item.value }}</span>
      </span>
    </div>

    <!-- 回补日提示 -->
    <p v-if="cell && !isFullSnapshot" class="mb-3 text-xs text-text-tertiary" role="note">
      该日数据为历史回补，只有涨跌停明细（板块级涨跌家数接口无历史值），不参与色阶。
    </p>

    <BaseTabs v-model="activeTab" :options="DETAIL_TAB_OPTIONS" />

    <!-- ① 涨跌停明细 -->
    <div v-if="activeTab === DETAIL_TAB.LIMIT" class="mt-3">
      <BaseSkeleton v-if="isLoadingLimit" />
      <template v-else>
        <BaseEmpty v-if="limitStocks.length === 0" text="该板块当日无涨停 / 跌停个股" />
        <BaseTable
          v-else
          :columns="limitColumns"
          :rows="limitStocks"
          :row-key="stockRowKey"
          scroll-class="table-scroll-sm"
        >
          <template #limitType="{ row }">
            <span :class="row.limitType === 1 ? 'text-up' : 'text-down'">
              {{ row.limitType === 1 ? '涨停' : '跌停' }}
            </span>
          </template>
          <template #changePercent="{ row }">
            <span :class="TREND_TEXT_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]">
              {{ formatPercent(row.changePercent) }}
            </span>
          </template>
          <template #price="{ row }">
            {{ row.price === null ? NUMBER_PLACEHOLDER : row.price.toFixed(2) }}
          </template>
          <template #sealTime="{ row }">{{ formatBoardTime(row.sealTime) }}</template>
          <template #amount="{ row }">{{ formatYuan(row.amount) }}</template>
        </BaseTable>
      </template>
    </div>

    <!-- ② 全部成分股（仅当日） -->
    <div v-else class="mt-3">
      <p v-if="!isToday" class="text-xs text-text-tertiary" role="note">
        成分股为实时成分，历史交易日不提供快照（避免与当日成分混淆）；请切换到最近一个交易日查看。
      </p>
      <template v-else>
        <BaseSkeleton v-if="isLoadingConstituent" />
        <template v-else>
          <BaseEmpty v-if="constituents.length === 0" text="成分股加载失败或为空" />
          <BaseTable
            v-else
            :columns="constituentColumns"
            :rows="constituents"
            :row-key="stockRowKey"
            scroll-class="table-scroll-sm"
            :footer-text="`共 ${constituents.length} 只成分股`"
          >
            <template #changePercent="{ row }">
              <span :class="TREND_TEXT_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]">
                {{ formatPercent(row.changePercent) }}
              </span>
            </template>
            <template #price="{ row }">
              {{ row.price === null ? NUMBER_PLACEHOLDER : row.price.toFixed(2) }}
            </template>
            <template #turnoverRate="{ row }">{{ formatPercentUnsigned(row.turnoverRate) }}</template>
            <template #amount="{ row }">{{ formatYuan(row.amount) }}</template>
          </BaseTable>
        </template>
      </template>
    </div>
  </BaseModal>
</template>
