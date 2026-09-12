<script setup lang="ts">
import { ref } from 'vue';
import BaseTable from '../ui/BaseTable.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import type { Trend } from '../../constants/trend.constants';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { formatAmount } from '../../utils/format-amount';
import { formatPercent, formatPercentUnsigned } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import { useDockPanelStore } from '../../stores/dock-panel';
import type { FullQuote } from '../../types/stock-quote.types';
import type { WatchlistStock } from '../../types/watchlist.types';
import type { TableColumn } from '../../types/table.types';

/**
 * 自选股表格（列配置驱动）：拖拽手柄 / 现价 / 涨跌幅胶囊 / 成交额 / 换手率 / 删除操作，
 * 行点击进个股详情；拖拽手柄可重排自选顺序
 */
const props = defineProps<{
  /** 自选股条目（顺序即展示顺序） */
  stocks: WatchlistStock[];
  /** 报价映射（key 为 FullQuote.code 原始形态） */
  quotesMap: Record<string, FullQuote>;
}>();

const emit = defineEmits<{
  /** 点击删除按钮 */
  remove: [symbol: string];
  /** 拖拽重排（下标为 stocks 数组下标，按 row-key 反查、与排序状态无关） */
  reorder: [fromIndex: number, toIndex: number];
}>();

const dockPanel = useDockPanelStore();

/** 拖拽中的行 key（symbol） */
const dragRowKey = ref<string | null>(null);

/**
 * 拖拽手柄按下：记录拖起行
 * @param event DragEvent
 */
const onDragStart = (event: DragEvent): void => {
  const key = (event.currentTarget as HTMLElement).closest('tr')?.getAttribute('data-row-key') ?? null;
  dragRowKey.value = key;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
};

/**
 * 放置：按 row-key 反查 stocks 下标后上报重排（与表格排序状态无关）
 * @param event DragEvent
 */
const onDrop = (event: DragEvent): void => {
  const fromKey = dragRowKey.value;
  dragRowKey.value = null;
  const toKey = (event.target as HTMLElement).closest('tr')?.getAttribute('data-row-key');
  if (!fromKey || !toKey || fromKey === toKey) {
    return;
  }
  const fromIndex = props.stocks.findIndex((stock) => stock.symbol === fromKey);
  const toIndex = props.stocks.findIndex((stock) => stock.symbol === toKey);
  if (fromIndex >= 0 && toIndex >= 0) {
    emit('reorder', fromIndex, toIndex);
  }
};

/**
 * 双形态兼容查找报价：watchlist 存 sh600519 完整形态，
 * FullQuote.code 实际形态待联调确认，两种形态都兜底
 * @param symbol 自选股符号
 * @returns 匹配到的报价
 */
const findQuote = (symbol: string): FullQuote | undefined =>
  props.quotesMap[symbol] ?? props.quotesMap[symbol.replace(/^(sh|sz|bj)/, '')];

/**
 * 行点击跳个股详情
 * @param stock 自选股条目
 */
const openDetail = (stock: WatchlistStock): void => {
  dockPanel.openStock(stock.symbol);
};

/**
 * 行涨跌方向（相对 0）
 * @param stock 自选股条目
 * @returns 趋势枚举
 */
const rowTrend = (stock: WatchlistStock): Trend =>
  getTrendByChangePercent(findQuote(stock.symbol)?.changePercent ?? 0);

/** 列配置（新增列 / 调整顺序只改此处；涨跌幅默认开启排序） */
const columns: TableColumn<WatchlistStock>[] = [
  { key: 'drag', label: '' },
  { key: 'name', label: '名称' },
  { key: 'price', label: '现价', align: 'right' },
  {
    key: 'changePercent',
    label: '涨跌幅',
    align: 'right',
    sortable: true,
    sortValue: (stock) => findQuote(stock.symbol)?.changePercent ?? null,
  },
  { key: 'amount', label: '成交额', align: 'right' },
  { key: 'turnoverRate', label: '换手率', align: 'right' },
  { key: 'actions', label: '操作', align: 'right' },
];
</script>

<template>
  <BaseTable
    :columns="columns"
    :rows="stocks"
    :row-key="(stock) => stock.symbol"
    min-width="640px"
    row-clickable
    @row-click="openDetail"
    @dragover.prevent
    @drop="onDrop"
  >
    <template #drag="{ row }">
      <span
        draggable="true"
        class="cursor-grab text-text-tertiary hover:text-text active:cursor-grabbing"
        :aria-label="`拖拽排序 ${row.name}`"
        @dragstart="onDragStart"
        @click.stop
      >
        <MenuIcon name="grip" :size="14" />
      </span>
    </template>
    <template #name="{ row }">
      <p class="font-medium text-text">{{ findQuote(row.symbol)?.name ?? row.name }}</p>
      <p class="text-xs text-text-tertiary">{{ row.symbol }}</p>
    </template>
    <template #price="{ row }">
      <span class="font-medium" :class="TREND_TEXT_CLASS[rowTrend(row)]">
        {{ formatPrice(findQuote(row.symbol)?.price) }}
      </span>
    </template>
    <template #changePercent="{ row }">
      <span
        class="rounded-full px-2 py-0.5 text-xs font-semibold"
        :class="TREND_PILL_CLASS[rowTrend(row)]"
      >
        {{ formatPercent(findQuote(row.symbol)?.changePercent) }}
      </span>
    </template>
    <template #amount="{ row }">
      <span class="text-text-secondary">{{ formatAmount(findQuote(row.symbol)?.amount) }}</span>
    </template>
    <template #turnoverRate="{ row }">
      <span class="text-text-secondary">
        {{ formatPercentUnsigned(findQuote(row.symbol)?.turnoverRate) }}
      </span>
    </template>
    <template #actions="{ row }">
      <button
        type="button"
        class="pressable rounded p-1 text-text-tertiary hover:bg-up-weak hover:text-up active:scale-90"
        :aria-label="`删除 ${row.name}`"
        @click.stop="emit('remove', row.symbol)"
      >
        <MenuIcon name="trash" :size="14" />
      </button>
    </template>
  </BaseTable>
</template>
