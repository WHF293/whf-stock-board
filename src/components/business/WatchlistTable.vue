<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseTable from '../ui/BaseTable.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { pluginKernel } from '../../plugin';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import type { Trend } from '../../constants/trend.constants';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { formatAmount } from '../../utils/format-amount';
import { formatPercent, formatPercentUnsigned } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import { findQuoteBySymbol } from '../../utils/find-quote-by-symbol';
import { useStockOpen } from '../../composables/use-stock-open';
import type { FullQuote } from '../../types/stock-quote.types';
import type { RegisteredStockRowAction, StockRowTarget } from '../../types/plugin.types';
import type { WatchlistStock } from '../../types/watchlist.types';
import type { TableColumn } from '../../types/table.types';

/**
 * 自选股表格（列配置驱动）：拖拽手柄 / 现价 / 涨跌幅胶囊 / 成交额 / 换手率 / 操作，
 * 行点击进个股详情；拖拽手柄可重排自选顺序
 *
 * 「操作」列 = 宿主自带的「编辑分组归属」与「从当前分组移除」 + **插件贡献的行操作**（`ctx.stockRow`）：
 * 宿主不知道任何具体插件，只按注册表渲染按钮（图标 / 文案 / 激活态由插件声明）。
 */
const props = defineProps<{
  /** 自选股条目（顺序即展示顺序） */
  stocks: WatchlistStock[];
  /** 报价映射（key 为 FullQuote.code 原始形态） */
  quotesMap: Record<string, FullQuote>;
  /**
   * 滚动容器类（透传给 BaseTable）
   *
   * 不传时用 BaseTable 默认的 `table-scroll`（固定 560px 截断）；
   * 整页布局（自选股页撑满可用高度）传 `table-scroll-fill`。
   */
  scrollClass?: string;
}>();

const emit = defineEmits<{
  /** 点击删除按钮（宿主据此弹二次确认；确认后只从**当前分组**移除，其余分组的归属不动） */
  remove: [symbol: string];
  /** 点击编辑按钮（由宿主打开分组归属弹窗） */
  edit: [stock: WatchlistStock];
  /** 拖拽重排（下标为 stocks 数组下标，按 row-key 反查、与排序状态无关） */
  reorder: [fromIndex: number, toIndex: number];
}>();

const { openSidebar, openPage, toContextList } = useStockOpen();

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
 * 双形态兼容查找报价：watchlist 存 sh600519 完整形态，上游 `FullQuote.code`
 * 实际是裸代码（600519）——统一走 `findQuoteBySymbol`（自选盯盘面板共用同一实现）
 * @param symbol 自选股符号
 * @returns 匹配到的报价
 */
const findQuote = (symbol: string): FullQuote | undefined =>
  findQuoteBySymbol(props.quotesMap, symbol);

/**
 * 行点击跳个股详情
 * @param stock 自选股条目
 */
const openDetail = (stock: WatchlistStock): void => {
  openSidebar(stock.symbol);
};

/**
 * 行涨跌方向（相对 0）
 * @param stock 自选股条目
 * @returns 趋势枚举
 */
const rowTrend = (stock: WatchlistStock): Trend =>
  getTrendByChangePercent(findQuote(stock.symbol)?.changePercent ?? 0);

// ---------- 插件贡献的行操作（ctx.stockRow） ----------

/** 注册表中的股票行操作（内核注册表是响应式的：插件启停即时增删按钮） */
const rowActions = computed<RegisteredStockRowAction[]>(() => {
  // 内核 revision 变化也一并纳入依赖：贡献点增删后表格立刻跟随
  void pluginKernel.revision.value;
  return [...pluginKernel.contributions.stockRows.actions];
});

/**
 * 行操作目标（只把「哪只票」交给插件，不暴露表格行对象）
 * @param stock 自选股条目
 * @returns 行操作目标
 */
const toRowTarget = (stock: WatchlistStock): StockRowTarget => ({
  symbol: stock.symbol,
  name: stock.name,
});

/**
 * 该行是否处于某行操作的激活态（如「已在盯盘候选」）
 * @param action 已注册的行操作
 * @param stock 自选股条目
 * @returns 是否激活
 */
const isRowActionActive = (action: RegisteredStockRowAction, stock: WatchlistStock): boolean =>
  action.isActive(toRowTarget(stock));

/**
 * 行操作的提示文案（激活态切换到插件声明的「取消…」文案）
 * @param action 已注册的行操作
 * @param stock 自选股条目
 * @returns 形如「盯盘 贵州茅台」的文案
 */
const rowActionTitle = (action: RegisteredStockRowAction, stock: WatchlistStock): string =>
  `${isRowActionActive(action, stock) ? action.activeTitle : action.title} ${stock.name}`;

/**
 * 触发行操作
 * @param action 已注册的行操作
 * @param stock 自选股条目
 */
const onRowAction = (action: RegisteredStockRowAction, stock: WatchlistStock): void => {
  action.run(toRowTarget(stock));
};

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
    :scroll-class="scrollClass"
    row-clickable
    @row-click="openDetail"
    :enable-dblclick-nav="true"
    @row-dblclick="(row) => openPage(row.symbol, toContextList(stocks, (item) => item.symbol))"
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
      <span class="inline-flex items-center gap-0.5">
        <!-- 插件贡献的行操作（如自选盯盘的「盯盘」开关）：宿主只按注册表渲染 -->
        <button
          v-for="action in rowActions"
          :key="action.key"
          type="button"
          class="pressable rounded p-1 active:scale-90"
          :class="
            isRowActionActive(action, row)
              ? 'bg-primary-weak text-primary'
              : 'text-text-tertiary hover:bg-flat-weak hover:text-text'
          "
          :title="rowActionTitle(action, row)"
          :aria-label="rowActionTitle(action, row)"
          @click.stop="onRowAction(action, row)"
        >
          <MenuIcon :name="action.icon" :size="14" />
        </button>
        <button
          type="button"
          data-track="WATCHLIST_EDIT_GROUPS"
          class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
          :title="`编辑 ${row.name} 的分组归属`"
          :aria-label="`编辑 ${row.name} 的分组归属`"
          @click.stop="emit('edit', row)"
        >
          <MenuIcon name="pencil" :size="14" />
        </button>
        <button
          type="button"
          data-track="WATCHLIST_REMOVE"
          class="pressable rounded p-1 text-text-tertiary hover:bg-up-weak hover:text-up active:scale-90"
          :title="`从当前分组移除 ${row.name}`"
          :aria-label="`删除 ${row.name}`"
          @click.stop="emit('remove', row.symbol)"
        >
          <MenuIcon name="trash" :size="14" />
        </button>
      </span>
    </template>
  </BaseTable>
</template>
