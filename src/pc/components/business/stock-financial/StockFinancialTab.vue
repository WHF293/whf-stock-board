<script setup lang="ts">
import { computed, toRef } from 'vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseButton from '../../ui/BaseButton.vue';
import MenuIcon from '../../ui/MenuIcon.vue';
import { useStockFinancial } from '../../../../common/composables/use-stock-financial';
import FinancialMetricCards from './FinancialMetricCards.vue';
import FinancialTrendChart from './FinancialTrendChart.vue';
import FinancialSummaryTable from './FinancialSummaryTable.vue';
import FinancialStatementsTables from './FinancialStatementsTables.vue';
import FinancialForecastList from './FinancialForecastList.vue';

/**
 * 财务页签内容编排（详情页底部「财务」Tab）：
 *
 * 指标卡行 -> 营收/净利趋势图 -> 财务摘要表 -> 资产负债/现金流两栏 -> 业绩预告
 * 数据经 useStockFinancial 装配（四表独立三态，区块级失败重试）；
 * 懒加载：本组件随页签切换才挂载（父级 v-if），挂载即触发首次拉取
 */
const props = defineProps<{
  /** 个股符号（sh600519 完整形态） */
  symbol: string;
}>();

const { summary, balance, cashflow, forecast, load, reloadTable } = useStockFinancial(
  toRef(props, 'symbol'),
);

/** 趋势图渲染条件：摘要已有数据（加载 / 失败态交给指标卡区承担） */
const hasSummaryData = computed(() => summary.value.data.length > 0);

/** 摘要区错误（指标卡 / 趋势图 / 摘要表共用一份数据源，错误只在此统一展示一次） */
const summaryFailed = computed(() => summary.value.error !== null && !hasSummaryData.value);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2">
    <!-- 摘要区（指标卡 + 趋势图）失败时统一在此重试 -->
    <template v-if="summaryFailed">
      <div class="flex flex-col items-center gap-2 py-8">
        <BaseEmpty :text="`财务数据加载失败：${summary.error}`" />
        <BaseButton variant="ghost" @click="load()">
          <MenuIcon name="refresh" :size="14" />
          重试
        </BaseButton>
      </div>
    </template>
    <template v-else>
      <FinancialMetricCards :rows="summary.data" :loading="summary.loading" />
      <div v-if="hasSummaryData" class="px-2">
        <FinancialTrendChart :rows="summary.data" />
      </div>
      <FinancialSummaryTable
        :rows="summary.data"
        :loading="summary.loading"
        :error="summary.error"
        @retry="reloadTable('summary')"
      />
    </template>

    <FinancialStatementsTables
      :summary-rows="summary.data"
      :balance-rows="balance.data"
      :cashflow-rows="cashflow.data"
      :balance-loading="balance.loading"
      :cashflow-loading="cashflow.loading"
      :balance-error="balance.error"
      :cashflow-error="cashflow.error"
      @retry="reloadTable($event)"
    />

    <FinancialForecastList
      :rows="forecast.data"
      :loading="forecast.loading"
      :error="forecast.error"
      @retry="reloadTable('forecast')"
    />
  </div>
</template>
