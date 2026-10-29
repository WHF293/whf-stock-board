<script setup lang="ts">
import { computed } from 'vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseTable from '../../ui/BaseTable.vue';
import type {
  TzzbFundTrade,
  TzzbStockTradePage,
} from '../../../../common/types/tzzb.types.ts';
import type { TableColumn } from '../../../../common/types/table.types.ts';

/**
 * 投资账本 · 交易记录（页签在卡片标题行右侧，由父级 TzzbDashboard 管理）
 *
 * - 股票流水：queryMoneyHistory 分页（无成交时间字段，仅到日）；
 * - 基金流水：queryFundSummaryHistory（六元组重复行已在解析层去重）；
 * - 历史导入页签已删（王总 2026-10-23 拍板）：旧交割单 / 对账单存量不再在页面展示，
 *   数据仍在本机两表（见开发方案 12.1）
 */
const props = defineProps<{
  /** 当前页签（stock / fund；父级页签条管理） */
  tab: string;
  /** 股票流水分页 */
  stockTrades: TzzbStockTradePage | null;
  /** 基金流水 */
  fundTrades: TzzbFundTrade[];
}>();

const emit = defineEmits<{
  /** 股票流水翻页（从 1 起） */
  page: [page: number];
}>();

/* ---- 股票流水 ---- */

const stockColumns: TableColumn<TzzbStockTradePage['list'][number]>[] = [
  { key: 'date', label: '成交日期', sortable: true, sortValue: (r) => r.date },
  { key: 'name', label: '证券' },
  { key: 'action', label: '操作' },
  { key: 'price', label: '成交价', align: 'right', sortable: true, sortValue: (r) => r.price },
  { key: 'quantity', label: '数量', align: 'right', sortable: true, sortValue: (r) => r.quantity },
  { key: 'amount', label: '成交金额', align: 'right', sortable: true, sortValue: (r) => r.amount },
  { key: 'commission', label: '佣金', align: 'right' },
  { key: 'transferFee', label: '过户费', align: 'right' },
  { key: 'feeTotal', label: '费用合计', align: 'right' },
];

/**
 * 数量文案（千分位；方向由操作列表达）
 * @param v 数量
 * @returns 千分位文案
 */
const qty = (v: number): string => v.toLocaleString('zh-CN');

/**
 * 千分位金额
 * @param v 数值
 * @returns 千分位两位小数文案
 */
const yuan = (v: number): string =>
  v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 页码列表（maxPage 截取，最多展示 8 页） */
const pages = computed(() => {
  const max = props.stockTrades?.maxPage ?? 1;
  return Array.from({ length: Math.min(max, 8) }, (_, i) => i + 1);
});

/** 当前页码 */
const currentPage = computed(() => props.stockTrades?.page ?? 1);

/** 基金流水列 */
const fundColumns: TableColumn<TzzbFundTrade>[] = [
  { key: 'date', label: '确认日期', sortable: true, sortValue: (r) => r.date },
  { key: 'accountName', label: '账户' },
  { key: 'name', label: '基金' },
  { key: 'action', label: '操作' },
  { key: 'amount', label: '交易金额', align: 'right', sortable: true, sortValue: (r) => r.amount },
  { key: 'shares', label: '交易份额', align: 'right', sortable: true, sortValue: (r) => r.shares },
];
</script>

<template>
  <div>
    <!-- 股票流水 -->
    <template v-if="tab === 'stock'">
      <BaseTable
        v-if="stockTrades && stockTrades.list.length > 0"
        :columns="stockColumns"
        :rows="stockTrades.list"
        :row-key="(r) => `${r.date}-${r.code}-${r.action}-${r.quantity}-${r.price}`"
        :min-width="'820px'"
        :footer-text="`第 ${currentPage} / ${stockTrades.maxPage} 页 · mock 采样仅第 1 页，正式接入后按页拉取`"
      >
        <template #name="{ row }">
          <span class="font-medium text-text">{{ row.name }}</span>
          <span class="ml-1 font-mono text-xs text-text-tertiary">{{ row.code }}</span>
        </template>
        <template #action="{ row }">
          <span
            class="rounded-full px-2 py-0.5 text-xs"
            :class="row.action === '买入' ? 'bg-up-weak text-up' : 'bg-down-weak text-down'"
          >
            {{ row.action }}
          </span>
        </template>
        <template #price="{ row }"><span class="font-mono tabular-nums">{{ row.price }}</span></template>
        <template #quantity="{ row }"><span class="font-mono tabular-nums">{{ qty(row.quantity) }}</span></template>
        <template #amount="{ row }"><span class="font-mono tabular-nums">{{ yuan(row.amount) }}</span></template>
        <template #commission="{ row }"><span class="font-mono tabular-nums">{{ row.commission }}</span></template>
        <template #transferFee="{ row }"><span class="font-mono tabular-nums">{{ row.transferFee }}</span></template>
        <template #feeTotal="{ row }"><span class="font-mono tabular-nums">{{ row.feeTotal }}</span></template>
      </BaseTable>
      <BaseEmpty v-else text="暂无股票流水：同步投资账本后自动填充" />

      <!-- 分页 -->
      <div v-if="(stockTrades?.maxPage ?? 1) > 1" class="mt-2 flex items-center gap-1.5">
        <button
          v-for="p in pages"
          :key="p"
          type="button"
          class="pressable h-7 min-w-7 rounded-md px-2 font-mono text-xs"
          :class="p === currentPage ? 'bg-primary text-on-primary' : 'bg-flat-weak text-text-secondary hover:text-text'"
          @click="p !== currentPage && emit('page', p)"
        >
          {{ p }}
        </button>
        <span class="text-xs text-text-tertiary">第 {{ currentPage }} / {{ stockTrades?.maxPage }} 页</span>
      </div>
    </template>

    <!-- 基金流水 -->
    <template v-else>
      <BaseTable
        v-if="fundTrades.length > 0"
        :columns="fundColumns"
        :rows="fundTrades"
        :row-key="(r) => `${r.date}-${r.code}-${r.action}-${r.amount}-${r.shares}`"
        :min-width="'640px'"
        :footer-text="'按月查询；同六元组重复行已在解析层去重'"
      >
        <template #name="{ row }">
          <span class="font-medium text-text">{{ row.name }}</span>
          <span class="ml-1 font-mono text-xs text-text-tertiary">{{ row.code }}</span>
        </template>
        <template #action="{ row }">
          <span class="rounded-full bg-flat-weak px-2 py-0.5 text-xs text-text-secondary">{{ row.action }}</span>
        </template>
        <template #amount="{ row }">
          <span class="font-mono tabular-nums">¥{{ yuan(row.amount) }}</span>
        </template>
        <template #shares="{ row }"><span class="font-mono tabular-nums">{{ row.shares }}</span></template>
      </BaseTable>
      <BaseEmpty v-else text="暂无基金流水：同步投资账本后自动填充" />
    </template>
  </div>
</template>
