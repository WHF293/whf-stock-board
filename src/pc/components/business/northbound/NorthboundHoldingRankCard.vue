<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  NORTHBOUND_RANK_MARKET_OPTIONS,
  NORTHBOUND_RANK_PAGE_SIZE,
  NORTHBOUND_RANK_QUARTERLY_NOTICE,
} from '../../../../common/constants/northbound.constants.ts';
import { fetchNorthboundHoldingRank } from '../../../../common/api/northbound.api.ts';
import { formatNorthboundAmount } from '../../../../common/utils/format-northbound-amount.ts';
import { useLazyRows } from '../../../../common/composables/use-lazy-rows';
import { useDockPanelStore } from '../../../../common/stores/dock-panel';
import type { NorthboundRankMarket, NorthboundRankRow } from '../../../../common/types/northbound.types.ts';
import type { TableColumn } from '../../../../common/types/table.types.ts';
import BaseCard from '../../ui/BaseCard.vue';
import BaseTabs from '../../ui/BaseTabs.vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import BaseTable from '../../ui/BaseTable.vue';

/**
 * 北向持股排行卡（资金流向页行 5）
 *
 * 上游已改**季度披露**（RPT_MUTUAL_HOLDSTOCKNORTH_STA），进页拉一次最新一期
 * 快照（不轮询、不随筛选重拉）；市场筛选（全部/沪市/深市）为本地过滤；
 * 懒加载每批 NORTHBOUND_RANK_PAGE_SIZE 行。行点击 → 停靠面板个股详情，
 * 行尾「持仓」→ 个股北向持仓历史抽屉（两者并存互不抢占）
 */

const dockPanel = useDockPanelStore();

/** 市场筛选（本地过滤，不触发请求） */
const market = ref<NorthboundRankMarket>('all');

/** 最新一期全量排行 */
const allRows = ref<NorthboundRankRow[]>([]);

/** 是否加载中 */
const isLoading = ref(false);

/** 是否取数失败 */
const isError = ref(false);

/** 数据期（最新一期季度末日期） */
const dataDate = computed(() => allRows.value[0]?.date ?? null);

/** 筛选后的排行 */
const filteredRows = computed<NorthboundRankRow[]>(() => {
  if (market.value === 'all') return allRows.value;
  const shanghai = market.value === 'shanghai';
  return allRows.value.filter((row) =>
    shanghai ? row.code.startsWith('6') : row.code.startsWith('0') || row.code.startsWith('3'),
  );
});

/** 懒加载（每批 50 行，滚动接近底部增量放行） */
const { rows, total, hasMore, onScroll } = useLazyRows(
  () => filteredRows.value,
  NORTHBOUND_RANK_PAGE_SIZE,
);

/** 列配置 */
const columns = computed<TableColumn<NorthboundRankRow>[]>(() => [
  { key: 'code', label: '代码' },
  { key: 'name', label: '名称' },
  { key: 'close', label: '收盘价', align: 'right' },
  { key: 'changePercent', label: '涨跌幅', align: 'right' },
  { key: 'holdShares', label: '持股数(万)', align: 'right' },
  { key: 'holdMarketValue', label: '持股市值', align: 'right' },
  { key: 'holdRatioFloat', label: '占流通股比', align: 'right' },
  { key: 'holdRatioTotal', label: '占总股本比', align: 'right' },
  { key: 'actions', label: '操作', align: 'right' },
]);

/** 拉取最新一期排行 */
const loadRank = async (): Promise<void> => {
  isLoading.value = true;
  try {
    allRows.value = await fetchNorthboundHoldingRank({ market: 'all' });
    isError.value = allRows.value.length === 0;
  } catch (error) {
    console.error('[northbound] 北向持股排行取数失败', error);
    isError.value = allRows.value.length === 0;
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  void loadRank();
});

const emit = defineEmits<{
  /** 打开个股北向持仓历史抽屉（行尾「持仓」按钮） */
  openIndividual: [row: NorthboundRankRow];
}>();

/**
 * 行点击 → 停靠面板个股详情（6 位纯代码由 openStock 内部归一化）
 * @param row 排行行
 */
const openStock = (row: NorthboundRankRow): void => {
  dockPanel.openStock(row.code);
};

/**
 * 涨跌幅单元格色值类
 * @param value 涨跌幅
 * @returns tailwind 类
 */
const trendClass = (value: number | null): string =>
  (value ?? 0) > 0 ? 'text-up' : (value ?? 0) < 0 ? 'text-down' : 'text-flat';
</script>

<template>
  <BaseCard title="北向持股排行">
    <template #extra>
      <div class="flex items-center gap-2">
        <span v-if="dataDate" class="text-[11px] text-text-tertiary num">数据期 {{ dataDate }}</span>
        <BaseTabs v-model="market" :options="NORTHBOUND_RANK_MARKET_OPTIONS" />
      </div>
    </template>

    <p class="mb-2 text-[11px] leading-relaxed text-text-tertiary">
      {{ NORTHBOUND_RANK_QUARTERLY_NOTICE }}
    </p>

    <BaseSkeleton v-if="isLoading" class="h-[320px]" />
    <BaseEmpty v-else-if="isError" text="北向持股排行加载失败，请稍后重试" />
    <BaseEmpty v-else-if="rows.length === 0" text="暂无数据" />
    <div v-else class="table-scroll-sm h-[340px]" @scroll="onScroll">
      <BaseTable
        :columns="columns"
        :rows="rows"
        :row-key="(row) => row.code"
        row-clickable
        :footer-text="hasMore ? `已展示 ${rows.length} / ${total} 只，滚动加载更多` : `共 ${total} 只`"
        @row-click="openStock"
      >
        <template #close="{ row }">
          <span class="num text-text">{{ row.close ?? '--' }}</span>
        </template>
        <template #changePercent="{ row }">
          <span class="num font-medium" :class="trendClass(row.changePercent)">
            {{ row.changePercent === null ? '--' : `${row.changePercent > 0 ? '+' : ''}${row.changePercent.toFixed(2)}%` }}
          </span>
        </template>
        <template #holdShares="{ row }">
          <span class="num text-text">
            {{ row.holdShares === null ? '--' : (row.holdShares / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) }}
          </span>
        </template>
        <template #holdMarketValue="{ row }">
          <span class="num font-medium text-text">
            {{ formatNorthboundAmount({ value: row.holdMarketValue, source: 'yuan' }) }}
          </span>
        </template>
        <template #holdRatioFloat="{ row }">
          <span class="num text-text-secondary">{{ row.holdRatioFloat === null ? '--' : `${row.holdRatioFloat.toFixed(2)}%` }}</span>
        </template>
        <template #holdRatioTotal="{ row }">
          <span class="num text-text-secondary">{{ row.holdRatioTotal === null ? '--' : `${row.holdRatioTotal.toFixed(2)}%` }}</span>
        </template>
        <template #actions="{ row }">
          <button
            type="button"
            class="pressable rounded bg-primary-weak px-1.5 py-0.5 text-[11px] text-primary-dark hover:bg-primary-weak/80"
            @click.stop="emit('openIndividual', row)"
          >
            持仓
          </button>
        </template>
      </BaseTable>
    </div>
  </BaseCard>
</template>
