<script setup lang="ts">
import { ref } from "vue";
import BaseSkeleton from "../ui/BaseSkeleton.vue";
import BaseTable from "../ui/BaseTable.vue";
import { getTrendByChangePercent } from "../../constants/trend.constants";
import { TREND_TEXT_CLASS } from "../../constants/stock-colors.constants";
import {
  NUMBER_PLACEHOLDER,
  YUAN_PER_WAN,
} from "../../constants/format.constants";
import { formatAmount } from "../../utils/format-amount";
import {
  formatPercent,
  formatPercentUnsigned,
} from "../../utils/format-percent";
import { formatPrice } from "../../utils/format-price";
import type {
  IndustryBoard,
  IndustryBoardConstituent,
} from "../../types/board.types";
import type { HeatmapDrillView } from "../../types/heatmap.types";
import type { TableColumn } from "../../types/table.types";

/**
 * 板块热力列表视图：与 HeatmapChart 交互对称的表格形态
 *
 * 板块层展示 Top N 板块，开启行扩展（BaseTable expandable）：
 * 点击行首 chevron（或点击行）展开扩展行，扩展行内渲染该板块的成分股表格，
 * 成分股行点击 emit stock-click 跳个股详情；
 * 成分股数据由父级 useHeatmapDrill 拉取（board-click 事件触发），与热力图视图共享
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
  { key: "name", label: "板块" },
  { key: "price", label: "最新价", align: "right" },
  {
    key: "changePercent",
    label: "涨跌幅",
    align: "right",
    sortable: true,
    sortValue: (board) => board.changePercent,
  },
  {
    key: "totalMarketCap",
    label: "总市值",
    align: "right",
    sortable: true,
    sortValue: (board) => board.totalMarketCap,
  },
  { key: "turnoverRate", label: "换手率", align: "right" },
  { key: "riseFall", label: "涨/跌家数", align: "right" },
  { key: "leadingStock", label: "领涨股" },
];

/** 成分股层列配置（涨跌幅 / 成交额默认可排序） */
const stockColumns: TableColumn<IndustryBoardConstituent>[] = [
  { key: "name", label: "名称" },
  { key: "price", label: "最新价", align: "right" },
  {
    key: "changePercent",
    label: "涨跌幅",
    align: "right",
    sortable: true,
    sortValue: (stock) => stock.changePercent,
  },
  {
    key: "amount",
    label: "成交额",
    align: "right",
    sortable: true,
    sortValue: (stock) => stock.amount,
  },
  { key: "turnoverRate", label: "换手率", align: "right" },
];

/** 已展开的板块 code（扩展行受控列表） */
const expandedCodes = ref<string[]>([]);

/**
 * 涨跌语义文本色类名
 * @param changePercent 涨跌幅（百分数数值，空值按平盘处理）
 * @returns 对应 theme.css token 的类名
 */
const trendTextClass = (changePercent: number | null): string =>
  TREND_TEXT_CLASS[getTrendByChangePercent(changePercent ?? 0)];

/**
 * 板块行 / 展开图标点击：切换扩展行，并请求父级拉取该板块成分股
 * @param board 板块行数据
 */
const onBoardToggle = (board: IndustryBoard): void => {
  emit("boardClick", board);
  expandedCodes.value = expandedCodes.value.includes(board.code)
    ? expandedCodes.value.filter((code) => code !== board.code)
    : [...expandedCodes.value, board.code];
};

/**
 * 成分股行点击：上报跳个股详情
 * @param stock 成分股行数据
 */
const onStockRowClick = (stock: IndustryBoardConstituent): void => {
  emit("stockClick", stock.code);
};
</script>

<template>
  <div>
    <BaseTable
      :columns="boardColumns"
      :rows="boards"
      :row-key="(board) => board.code"
      row-clickable
      expandable
      :expanded-keys="expandedCodes"
      @row-click="onBoardToggle"
      @toggle-expand="onBoardToggle"
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
        {{ row.riseCount ?? NUMBER_PLACEHOLDER }} /
        {{ row.fallCount ?? NUMBER_PLACEHOLDER }}
      </template>
      <template #leadingStock="{ row }">
        <template v-if="row.leadingStock">
          {{ row.leadingStock }}
          <span
            class="ml-1 text-xs"
            :class="trendTextClass(row.leadingStockChangePercent)"
          >
            {{ formatPercent(row.leadingStockChangePercent) }}
          </span>
        </template>
        <template v-else>{{ NUMBER_PLACEHOLDER }}</template>
      </template>

      <!-- 扩展行：该板块成分股表格（数据由父级 useHeatmapDrill 拉取） -->
      <template #expanded="{ row }">
        <div v-if="isDrillLoading && drillView?.board.code !== row.code" class="py-6">
          <BaseSkeleton />
        </div>
        <div v-else-if="drillError === row.name && drillView?.board.code !== row.code" class="py-3 text-xs text-down">
          {{ row.name }} 成分股加载失败，请稍后重试
        </div>
        <template v-else-if="drillView && drillView.board.code === row.code">
          <p class="mb-2 text-xs text-text-tertiary">
            {{ drillView.board.name }} 成分股 Top{{ drillView.constituents.length }}（按成交额）· 点击行查看个股详情
          </p>
          <BaseTable
            :columns="stockColumns"
            :rows="drillView.constituents"
            :row-key="(stock) => stock.code"
            row-clickable
            @row-click="onStockRowClick"
          >
            <template #changePercent="{ row: stock }">
              <span :class="trendTextClass(stock.changePercent)">
                {{ formatPercent(stock.changePercent) }}
              </span>
            </template>
            <template #price="{ row: stock }">
              {{ formatPrice(stock.price) }}
            </template>
            <template #amount="{ row: stock }">
              {{ formatAmount((stock.amount ?? 0) / YUAN_PER_WAN) }}
            </template>
            <template #turnoverRate="{ row: stock }">
              {{ formatPercentUnsigned(stock.turnoverRate) }}
            </template>
          </BaseTable>
        </template>
        <p v-else class="py-2 text-xs text-text-tertiary">成分股加载中...</p>
      </template>
    </BaseTable>
    <p v-if="drillError" class="mt-2 text-xs text-down">
      {{ drillError }} 成分股加载失败，请稍后重试
    </p>
  </div>
</template>
