<script setup lang="ts">
import { computed } from 'vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseTable from '../../ui/BaseTable.vue';
import type { TableColumn } from '../../../../common/types/table.types.ts';
import type { TzzbClearedPosition } from '../../../../common/types/tzzb.types.ts';

/**
 * 投资账本 · 建清仓记录（queryClearedPosition，完整买卖回合按股票分组）
 *
 * 持有中行清仓日列高亮；总盈亏 / 收益率涨跌着色；表头可排序
 */
const props = defineProps<{
  /** 清仓记录 */
  rows: TzzbClearedPosition[];
  /** 填满父容器高度（fill 卡片内用 table-scroll-fill；默认 max-h 560 滚动） */
  fill?: boolean;
}>();

const emit = defineEmits<{
  /** 点击行打开个股详情 */
  open: [code: string];
}>();

/**
 * 千分位金额
 * @param v 数值
 * @returns 千分位两位小数文案
 */
const yuan = (v: number): string =>
  v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 带符号金额
 * @param v 数值
 * @returns 正值补 + 号的千分位文案
 */
const signYuan = (v: number): string => `${v > 0 ? '+' : ''}${yuan(v)}`;

/**
 * 盈亏文本色
 * @param v 数值
 * @returns 涨跌语义色类（红涨绿跌）
 */
const plClass = (v: number): string => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-flat');

const columns: TableColumn<TzzbClearedPosition>[] = [
  { key: 'name', label: '证券', sortable: true, sortValue: (r) => r.name },
  { key: 'openDate', label: '开仓日', sortable: true, sortValue: (r) => r.openDate },
  { key: 'closeDate', label: '清仓日', sortable: true, sortValue: (r) => r.closeDate ?? '~' },
  { key: 'holdDays', label: '天数', align: 'right', sortable: true, sortValue: (r) => r.holdDays },
  { key: 'rounds', label: '回合', align: 'right', sortable: true, sortValue: (r) => r.rounds },
  { key: 'avgBuy', label: '均买', align: 'right', sortable: true, sortValue: (r) => r.avgBuy },
  { key: 'avgSell', label: '均卖', align: 'right', sortable: true, sortValue: (r) => r.avgSell },
  { key: 'fee', label: '费用', align: 'right', sortable: true, sortValue: (r) => r.fee },
  { key: 'profit', label: '总盈亏', align: 'right', sortable: true, sortValue: (r) => r.profit },
  { key: 'rate', label: '收益率', align: 'right', sortable: true, sortValue: (r) => r.rate },
];

/** 已清仓笔数（副标题） */
const clearedCount = computed(() => props.rows.filter((r) => r.closeDate).length);
</script>

<template>
  <BaseTable
    v-if="rows.length > 0"
    :columns="columns"
    :rows="rows"
    :row-key="(r) => `${r.code}-${r.openDate}`"
    :min-width="'860px'"
    :scroll-class="fill ? 'table-scroll-fill' : 'table-scroll'"
    row-clickable
    :footer-text="`共 ${rows.length} 条（已清仓 ${clearedCount} · 持有中 ${rows.length - clearedCount}）· 点击行打开个股详情`"
    @row-click="(r) => emit('open', r.code)"
  >
    <template #name="{ row }">
      <span class="font-medium text-text">{{ row.name }}</span>
      <span class="ml-1 font-mono text-xs text-text-tertiary">{{ row.code }}</span>
    </template>
    <template #closeDate="{ row }">
      <span v-if="row.closeDate" class="font-mono">{{ row.closeDate }}</span>
      <b v-else class="text-primary">持有中</b>
    </template>
    <template #avgSell="{ row }">
      <span class="font-mono">{{ row.avgSell ?? '—' }}</span>
    </template>
    <template #profit="{ row }">
      <span class="font-mono font-medium tabular-nums" :class="plClass(row.profit)">
        {{ signYuan(row.profit) }}
      </span>
    </template>
    <template #rate="{ row }">
      <span class="font-mono tabular-nums" :class="plClass(row.rate)">
        {{ (row.rate * 100).toFixed(2) }}%
      </span>
    </template>
  </BaseTable>
  <BaseEmpty v-else text="暂无建清仓记录：同步投资账本后自动填充" />
</template>
