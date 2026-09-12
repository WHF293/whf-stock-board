<script setup lang="ts">
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseTable from '../ui/BaseTable.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import { TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { HEATMAP_VIEW_HEIGHT_PX } from '../../constants/heatmap.constants';
import { NUMBER_PLACEHOLDER, YUAN_PER_WAN } from '../../constants/format.constants';
import { formatAmount } from '../../utils/format-amount';
import { formatPercent, formatPercentUnsigned } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import type { IndustryBoard, IndustryBoardConstituent } from '../../types/board.types';
import type { HeatmapDrillView } from '../../types/heatmap.types';
import type { TableColumn } from '../../types/table.types';

/**
 * 板块热力列表视图：与 HeatmapChart 交互对称的表格形态
 *
 * 板块层展示 Top N 板块（完整行情字段，信息量比热力图 cell 更丰富），
 * 行点击下钻成分股；成分股层行点击 emit stock-click 跳个股 K 线详情；
 * 下钻状态由父级 useHeatmapDrill 统一管理（与热力图视图共享，切换展示形式不丢位置）
 */
defineProps<{
  /** 板块列表（Top N，完整行情字段） */
  boards: IndustryBoard[];
  /** 下钻视图状态（null 表示板块总览层），由父级 useHeatmapDrill 提供 */
  drillView: HeatmapDrillView | null;
  /** 成分股拉取中 */
  isDrillLoading: boolean;
  /** 成分股拉取失败的板块名 */
  drillError: string | null;
}>();

const emit = defineEmits<{
  /** 点击成分股行（code 为 6 位纯代码） */
  stockClick: [code: string];
  /** 点击板块行（请求父级下钻） */
  boardClick: [board: IndustryBoard];
  /** 点击返回板块 */
  back: [];
}>();

/** 板块层列配置（涨跌幅 / 总市值默认可排序） */
const boardColumns: TableColumn<IndustryBoard>[] = [
  { key: 'name', label: '板块' },
  { key: 'price', label: '最新价', align: 'right' },
  {
    key: 'changePercent',
    label: '涨跌幅',
    align: 'right',
    sortable: true,
    sortValue: (board) => board.changePercent,
  },
  {
    key: 'totalMarketCap',
    label: '总市值',
    align: 'right',
    sortable: true,
    sortValue: (board) => board.totalMarketCap,
  },
  { key: 'turnoverRate', label: '换手率', align: 'right' },
  { key: 'riseFall', label: '涨/跌家数', align: 'right' },
  { key: 'leadingStock', label: '领涨股' },
];

/** 成分股层列配置（涨跌幅 / 成交额默认可排序） */
const stockColumns: TableColumn<IndustryBoardConstituent>[] = [
  { key: 'name', label: '名称' },
  { key: 'price', label: '最新价', align: 'right' },
  {
    key: 'changePercent',
    label: '涨跌幅',
    align: 'right',
    sortable: true,
    sortValue: (stock) => stock.changePercent,
  },
  {
    key: 'amount',
    label: '成交额',
    align: 'right',
    sortable: true,
    sortValue: (stock) => stock.amount,
  },
  { key: 'turnoverRate', label: '换手率', align: 'right' },
];

/**
 * 涨跌语义文本色类名
 * @param changePercent 涨跌幅（百分数数值，空值按平盘处理）
 * @returns 对应 theme.css token 的类名
 */
const trendTextClass = (changePercent: number | null): string =>
  TREND_TEXT_CLASS[getTrendByChangePercent(changePercent ?? 0)];

/**
 * 板块行点击：请求父级下钻
 * @param board 板块行数据
 */
const onBoardRowClick = (board: IndustryBoard): void => {
  emit('boardClick', board);
};

/**
 * 成分股行点击：上报跳个股详情
 * @param stock 成分股行数据
 */
const onStockRowClick = (stock: IndustryBoardConstituent): void => {
  emit('stockClick', stock.code);
};
</script>

<template>
  <div>
    <!-- 下钻状态条：返回 + 当前板块名 -->
    <div
      v-if="drillView"
      class="mb-2 flex items-center gap-2 text-sm"
    >
      <button
        type="button"
        class="pressable flex items-center gap-1 rounded-lg px-2 py-1 text-text-secondary hover:bg-flat-weak hover:text-text active:scale-90"
        @click="emit('back')"
      >
        <MenuIcon name="arrowLeft" :size="14" />
        返回板块
      </button>
      <span class="font-medium text-text">{{ drillView.board.name }}</span>
      <span class="text-xs text-text-tertiary">
        成分股 Top{{ drillView.constituents.length }}（按成交额）
      </span>
    </div>
    <div v-if="isDrillLoading" class="flex items-center justify-center py-24">
      <BaseSkeleton />
    </div>
    <!-- 成分股层：行点击跳个股详情 -->
    <div
      v-else-if="drillView"
      class="overflow-y-auto"
      :style="{ maxHeight: `${HEATMAP_VIEW_HEIGHT_PX}px` }"
    >
      <BaseTable
        :columns="stockColumns"
        :rows="drillView.constituents"
        :row-key="(stock) => stock.code"
        row-clickable
        @row-click="onStockRowClick"
      >
        <template #changePercent="{ row }">
          <span :class="trendTextClass(row.changePercent)">
            {{ formatPercent(row.changePercent) }}
          </span>
        </template>
        <template #price="{ row }">
          {{ formatPrice(row.price) }}
        </template>
        <template #amount="{ row }">
          {{ formatAmount((row.amount ?? 0) / YUAN_PER_WAN) }}
        </template>
        <template #turnoverRate="{ row }">
          {{ formatPercentUnsigned(row.turnoverRate) }}
        </template>
      </BaseTable>
    </div>
    <!-- 板块层：行点击下钻成分股 -->
    <div
      v-else
      class="overflow-y-auto"
      :style="{ maxHeight: `${HEATMAP_VIEW_HEIGHT_PX}px` }"
    >
      <BaseTable
        :columns="boardColumns"
        :rows="boards"
        :row-key="(board) => board.code"
        row-clickable
        @row-click="onBoardRowClick"
      >
        <template #price="{ row }">
          {{ formatPrice(row.price) }}
        </template>
        <template #changePercent="{ row }">
          <span :class="trendTextClass(row.changePercent)">
            {{ formatPercent(row.changePercent) }}
          </span>
        </template>
        <template #totalMarketCap="{ row }">
          {{ formatAmount((row.totalMarketCap ?? 0) / YUAN_PER_WAN) }}
        </template>
        <template #turnoverRate="{ row }">
          {{ formatPercentUnsigned(row.turnoverRate) }}
        </template>
        <template #riseFall="{ row }">
          {{ row.riseCount ?? NUMBER_PLACEHOLDER }} / {{ row.fallCount ?? NUMBER_PLACEHOLDER }}
        </template>
        <template #leadingStock="{ row }">
          <template v-if="row.leadingStock">
            {{ row.leadingStock }}
            <span class="ml-1 text-xs" :class="trendTextClass(row.leadingStockChangePercent)">
              {{ formatPercent(row.leadingStockChangePercent) }}
            </span>
          </template>
          <template v-else>{{ NUMBER_PLACEHOLDER }}</template>
        </template>
      </BaseTable>
    </div>
    <p v-if="drillError" class="mt-2 text-xs text-down">
      {{ drillError }} 成分股加载失败，请稍后重试
    </p>
  </div>
</template>
