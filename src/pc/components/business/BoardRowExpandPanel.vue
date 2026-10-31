<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseTable from '../ui/BaseTable.vue';
import { listConstituentsByBoard, listLimitStocks } from '../../../common/api/board-calendar-db.api.ts';
import { fetchBoardConstituentQuotes } from '../../../common/api/board-calendar.api.ts';
import { isBoardDbAvailable } from '../../../common/api/board-calendar-db.api.ts';
import {
  BOARD_EXPAND_MAX_HEIGHT,
  BOARD_EXPAND_SUMMARY_WIDTH,
  BOARD_SCORE_LEGEND,
} from '../../../common/constants/board-calendar.constants.ts';
import { NUMBER_PLACEHOLDER } from '../../../common/constants/format.constants.ts';
import { TREND_TEXT_CLASS } from '../../../common/constants/stock-colors.constants.ts';
import { getTrendByChangePercent } from '../../../common/constants/trend.constants.ts';
import type {
  BoardCalendarCell,
  BoardCalendarRow,
  BoardConstituentQuote,
  BoardLimitStock,
} from '../../../common/types/board-calendar.types.ts';
import type { TableColumn } from '../../../common/types/table.types.ts';
import { formatPercent, formatPercentUnsigned } from '../../../common/utils/format-percent';
import { formatYuan } from '../../../common/utils/format-yuan';
import { handleSdkError } from '../../../common/utils/handle-sdk-error';

/**
 * 板块日历 · 扩展行内容（2026-10-31 王总指定：点击单元格展开，替代明细弹窗）
 *
 * 左栏 = 当日汇总条（全部来自 board_daily 落库值，零取数；回补日涨跌家数 `--`）
 * +【查看赚钱效应】【查看板块详情】两个动作；右栏 = 成分股表（仅一张表，不再
 * 区分涨跌停分类页签），涨跌幅可排序、最大高度一屏内滚。
 *
 * 成分股口径：
 * - 清单 = 本地 board_constituent（实时成分，零上游）；
 * - 当日行情 = 腾讯批量报价多通道（board-constituent-quote.api）；
 * - 历史日 = 仅涨跌停成员有当日涨跌数据（board_limit_stock 合并），其余显示 `--`，
 *   表下方常驻口径说明，避免误导。
 */

const props = defineProps<{
  /** 被展开的板块行 */
  board: BoardCalendarRow;
  /** 被点击的单元格（展开必有值） */
  cell: BoardCalendarCell;
  /** 交易日 */
  tradeDate: string;
  /** 板块档案里的当前成分股数（快照缺成分股数时的兜底展示） */
  profileConsCount: number;
}>();

const emit = defineEmits<{
  /** 点击【查看赚钱效应】：打开右侧赚钱效应停靠面板并聚焦该交易日 */
  profitClick: [tradeDate: string];
  /** 点击【查看板块详情】：进入板块详情页 */
  boardClick: [boardCode: string];
  /** 点击成分股行：打开个股详情侧边栏 */
  stockClick: [symbol: string];
}>();

/** 该日是否为完整快照（回补日无涨跌家数与成交额） */
const isFullSnapshot = computed(() => props.cell.dataLevel === 1);

/** 是否为「当日」（当日走实时行情通道，历史日走涨跌停合并） */
const isToday = computed(() => props.tradeDate === new Date().toLocaleDateString('sv-SE'));

/** 该日是否为历史回补（仅涨跌停明细，不参与色阶） */
const isBackfill = computed(() => props.cell.dataLevel === 0);

/** 成分股数：优先用当日快照口径，回补日回落到板块档案 */
const consCount = computed(() => {
  const fromCell = props.cell.consCount;
  return fromCell > 0 ? fromCell : props.profileConsCount;
});

/** 汇总条：标签 + 文案（`--` 表示该口径当日不可得） */
const summaryItems = computed<Array<{ label: string; value: string }>>(() => {
  const cell = props.cell;
  const bucketLabel =
    BOARD_SCORE_LEGEND.find((item) => item.bucket === cell.bucket)?.label ?? '中性';
  return [
    { label: '涨停', value: String(cell.limitUp) },
    { label: '跌停', value: String(cell.limitDown) },
    { label: '上涨', value: isFullSnapshot.value ? String(cell.upCount) : NUMBER_PLACEHOLDER },
    { label: '下跌', value: isFullSnapshot.value ? String(cell.downCount) : NUMBER_PLACEHOLDER },
    { label: '成分股', value: consCount.value > 0 ? String(consCount.value) : NUMBER_PLACEHOLDER },
    { label: '成交额', value: isFullSnapshot.value ? formatYuan(cell.amount) : NUMBER_PLACEHOLDER },
    { label: '得分', value: isFullSnapshot.value ? String(Math.round(cell.score)) : NUMBER_PLACEHOLDER },
    {
      label: '得分率',
      value: isFullSnapshot.value ? `${cell.scoreRate.toFixed(2)}（${bucketLabel}）` : NUMBER_PLACEHOLDER,
    },
  ];
});

/** 成分股行情 */
const constituents = ref<BoardConstituentQuote[]>([]);
/** 该日涨跌停成员明细（历史日合并当日涨跌用；当日也顺带合并封板时间列外数据） */
const limitStocks = ref<BoardLimitStock[]>([]);
/** 加载中 */
const isLoading = ref(false);
/** 清单缺失（本地库无该板块成分名单） */
const listMissing = ref(false);

/** symbol → 该日涨跌停明细（合并口径用） */
const limitByKey = computed<Map<string, BoardLimitStock>>(
  () => new Map(limitStocks.value.map((item) => [item.symbol, item])),
);

/** 涨跌幅列排序方向（默认降序；降 → 升循环） */
const sortDir = ref<'desc' | 'asc'>('desc');

/** 成分股展示行：行情 + 历史日涨跌停合并（该日涨跌停成员带封板连板信息） */
interface ExpandConsRow {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  turnoverRate: number | null;
  amount: number | null;
  /** 该日是否为涨停 / 跌停成员（历史日合并标记） */
  limitType: number | null;
}

/** 成分股表行（含排序与合并口径） */
const rows = computed<ExpandConsRow[]>(() => {
  const merged = constituents.value.map<ExpandConsRow>((quote) => {
    const hit = limitByKey.value.get(quote.symbol);
    return {
      symbol: quote.symbol,
      name: quote.name,
      price: quote.price,
      changePercent: quote.changePercent,
      turnoverRate: quote.turnoverRate,
      amount: quote.amount,
      limitType: hit ? hit.limitType : null,
    };
  });
  const factor = sortDir.value === 'desc' ? -1 : 1;
  return merged.sort((a, b) => {
    const pa = a.changePercent;
    const pb = b.changePercent;
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return factor * (pa - pb);
  });
});

/** 成分股表列（历史日追加「该日标记」列，涨跌停成员可见） */
const consColumns = computed<TableColumn<ExpandConsRow>[]>(() => {
  const base: TableColumn<ExpandConsRow>[] = [
    { key: 'name', label: '名称' },
    { key: 'symbol', label: '代码' },
    { key: 'changePercent', label: '涨跌幅', align: 'right', sortable: true },
    { key: 'price', label: '现价', align: 'right' },
    { key: 'turnoverRate', label: '换手率', align: 'right' },
    { key: 'amount', label: '成交额', align: 'right' },
  ];
  if (!isToday.value) {
    base.push({ key: 'limitType', label: '该日', align: 'right' });
  }
  return base;
});

/**
 * 行 key（同一天内股票代码唯一）
 * @param row 表格行
 * @returns 股票代码
 */
const rowKey = (row: ExpandConsRow): string => row.symbol;

/**
 * 点击涨跌幅列头：降 → 升循环（null 值恒排末尾）
 */
const onSortToggle = (): void => {
  sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc';
};

/**
 * 加载成分股：清单（本地库）→ 行情（多通道）+ 该日涨跌停成员（合并口径）
 */
const load = async (): Promise<void> => {
  isLoading.value = true;
  listMissing.value = false;
  constituents.value = [];
  limitStocks.value = [];
  try {
    // 该日涨跌停成员（历史日合并当日涨跌；当日顺带用于「该日」标记）
    limitStocks.value = isBoardDbAvailable() ? await listLimitStocks(props.tradeDate, props.board.code) : [];
    const list = await listConstituentsByBoard(props.board.code);
    if (list.length === 0) {
      // 本地无该板块成分名单（未同步过）：不再自动打上游清单，给出明确空态
      listMissing.value = true;
      return;
    }
    constituents.value = await fetchBoardConstituentQuotes(
      props.board.code,
      list.map((item) => ({ symbol: item.symbol, stockName: item.stockName })),
    );
  } catch (error) {
    console.error('[board-row-expand]', handleSdkError(error));
  } finally {
    isLoading.value = false;
  }
};

watch(
  () => `${props.board.code}|${props.tradeDate}`,
  () => {
    sortDir.value = 'desc';
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <div class="bc-expand" :style="{ maxHeight: `${BOARD_EXPAND_MAX_HEIGHT}px` }">
    <!-- 左栏：汇总条 + 动作按钮 -->
    <div
      class="flex shrink-0 flex-col gap-3 overflow-y-auto border-r border-flat-weak pr-3"
      :style="{ width: `${BOARD_EXPAND_SUMMARY_WIDTH}px` }"
    >
      <p class="text-xs text-text-secondary">
        <b class="text-text">{{ board.name }}</b>
        <span class="ml-1 text-text-tertiary">{{ tradeDate }}</span>
        <span v-if="isBackfill" class="ml-2 text-text-tertiary">（历史回补，仅涨跌停数据）</span>
      </p>
      <dl class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div v-for="item in summaryItems" :key="item.label" class="flex items-baseline justify-between gap-2">
          <dt class="text-text-tertiary">{{ item.label }}</dt>
          <dd class="font-medium tabular-nums text-text">{{ item.value }}</dd>
        </div>
      </dl>
      <div class="mt-auto flex flex-wrap gap-2">
        <BaseButton variant="primary" @click="emit('profitClick', tradeDate)">
          查看赚钱效应
        </BaseButton>
        <BaseButton variant="ghost" @click="emit('boardClick', board.code)">
          查看板块详情
        </BaseButton>
      </div>
    </div>

    <!-- 右栏：成分股表（单表，无涨跌停分类页签） -->
    <div class="flex min-w-0 flex-1 flex-col">
      <BaseSkeleton v-if="isLoading && constituents.length === 0" class="flex-1" />
      <BaseEmpty
        v-else-if="listMissing"
        text="成分名单尚未同步到本地库，请点击右上角「刷新」采集"
      />
      <BaseEmpty v-else-if="rows.length === 0" text="本地库无该板块成分名单" />
      <BaseTable
        v-else
        :columns="consColumns"
        :rows="rows"
        :row-key="rowKey"
        row-clickable
        scroll-class="table-scroll-sm bc-expand__scroll"
        :footer-text="`共 ${rows.length} 只 · ${isToday ? '实时行情（腾讯通道）' : '历史日：仅涨跌停成员有当日涨跌数据（名单为当前实时成分）'}`"
        @row-click="emit('stockClick', $event.symbol)"
      >
        <template #header-changePercent>
          <button
            type="button"
            class="pressable inline-flex items-center gap-0.5 hover:text-primary"
            :class="sortDir === 'desc' ? 'text-primary' : ''"
            title="按涨跌幅排序（降 / 升循环）"
            @click.stop="onSortToggle"
          >
            涨跌幅 {{ sortDir === 'desc' ? '↓' : '↑' }}
          </button>
        </template>
        <template #changePercent="{ row }">
          <span :class="TREND_TEXT_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]">
            {{ row.changePercent === null ? NUMBER_PLACEHOLDER : formatPercent(row.changePercent) }}
          </span>
        </template>
        <template #price="{ row }">
          {{ row.price === null ? NUMBER_PLACEHOLDER : row.price.toFixed(2) }}
        </template>
        <template #turnoverRate="{ row }">
          {{ row.turnoverRate === null ? NUMBER_PLACEHOLDER : formatPercentUnsigned(row.turnoverRate) }}
        </template>
        <template #amount="{ row }">
          {{ row.amount === null ? NUMBER_PLACEHOLDER : formatYuan(row.amount) }}
        </template>
        <template v-if="!isToday" #limitType="{ row }">
          <span v-if="row.limitType === 1" class="text-up">涨停</span>
          <span v-else-if="row.limitType === -1" class="text-down">跌停</span>
          <span v-else class="text-text-tertiary">--</span>
        </template>
      </BaseTable>
    </div>
  </div>
</template>

<style scoped>
/* 扩展行整体：左汇总 + 右表格；最大高度由常量注入（一屏语义），超出内滚 */
.bc-expand {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  background: var(--color-flat-weak);
  border-bottom: 1px solid var(--color-border);
  overflow-y: auto;
}
.bc-expand__scroll {
  max-height: calc(100% - 24px);
}
</style>
