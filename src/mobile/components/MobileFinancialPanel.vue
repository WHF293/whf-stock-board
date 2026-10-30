<script setup lang="ts">
/**
 * 移动端个股财务面板（详情页「财务」Tab 内容）
 *
 * 数据复用 PC 的 useStockFinancial（四张东财 datacenter 报表 + dataCache 会话快照，
 * TTL 内秒出、页签切入才拉数），UI 按移动端 m-* 体系重写：四表 chips 切换 +
 * 报告期 chips + 指标键值行；不搬 PC 的趋势图与四栏大表（移动宽度下键值行已够扫一眼）。
 * 组件随页签 v-if 挂载：与 PC 同口径的惰性拉数，进出页签不产生后台常驻请求。
 */
import { computed, ref, watch } from 'vue';
import {
  useStockFinancial,
  type FinancialTableKey,
} from '../../common/composables/use-stock-financial';
import type {
  BalanceSheetRow,
  CashFlowRow,
  FinancialSummaryRow,
} from '../../common/types/financial.types';
import { formatAmount, formatPct } from '../utils/format';

const props = defineProps<{
  /** 完整符号（sh600519 形态；composable 内部按它拉数与缓存） */
  symbol: string;
}>();

const { summary, balance, cashflow, forecast, reloadTable } = useStockFinancial(
  computed(() => props.symbol),
);

/** 四张报表的页签（顺序与 PC 底部页签一致） */
const TABLES: ReadonlyArray<{ key: FinancialTableKey; label: string }> = [
  { key: 'summary', label: '摘要' },
  { key: 'balance', label: '资产负债' },
  { key: 'cashflow', label: '现金流' },
  { key: 'forecast', label: '业绩预告' },
];
const activeTable = ref<FinancialTableKey>('summary');

/* === 三张期间报表（摘要 / 资产负债 / 现金流）的键值行装配 === */

/** 键值行（v 直接为展示文案；null 值字段统一 `--`） */
interface KvRow {
  k: string;
  v: string;
}

/**
 * 摘要表关键指标（口径与 PC 指标卡一致，裁剪到移动端一屏）
 * @param row 摘要表行
 * @returns 键值行列表
 */
const summaryKv = (row: FinancialSummaryRow): KvRow[] => [
  { k: '营业总收入', v: formatAmount(row.totalOperateIncome) },
  { k: '归母净利润', v: formatAmount(row.parentNetprofit) },
  { k: '营收同比', v: formatPct(row.revenueYoY) },
  { k: '净利同比', v: formatPct(row.profitYoY) },
  { k: '基本每股收益', v: row.basicEps === null ? '--' : `${row.basicEps.toFixed(2)}元` },
  { k: '加权平均ROE', v: formatPct(row.weightedAvgRoe) },
  { k: '销售毛利率', v: formatPct(row.grossMargin) },
  { k: '每股净资产', v: row.bps === null ? '--' : `${row.bps.toFixed(2)}元` },
  { k: '每股经营现金流', v: row.operatingCashFlowPerShare === null ? '--' : `${row.operatingCashFlowPerShare.toFixed(2)}元` },
  { k: '分配预案', v: row.dividendPlan ?? '--' },
];

/**
 * 资产负债表关键科目
 * @param row 资产负债表行
 * @returns 键值行列表
 */
const balanceKv = (row: BalanceSheetRow): KvRow[] => [
  { k: '总资产', v: formatAmount(row.totalAssets) },
  { k: '总负债', v: formatAmount(row.totalLiabilities) },
  { k: '股东权益合计', v: formatAmount(row.totalEquity) },
  { k: '资产负债率', v: formatPct(row.debtAssetRatio) },
  { k: '流动比率', v: row.currentRatio === null ? '--' : row.currentRatio.toFixed(2) },
  { k: '货币资金', v: formatAmount(row.monetaryFunds) },
  { k: '应收账款', v: formatAmount(row.accountsReceivable) },
  { k: '存货', v: formatAmount(row.inventory) },
  { k: '应付账款', v: formatAmount(row.accountsPayable) },
  { k: '固定资产', v: formatAmount(row.fixedAssets) },
];

/**
 * 现金流量表关键科目
 * @param row 现金流量表行
 * @returns 键值行列表
 */
const cashflowKv = (row: CashFlowRow): KvRow[] => [
  { k: '经营活动净现金流', v: formatAmount(row.operatingNetCash) },
  { k: '销售收现', v: formatAmount(row.cashFromSales) },
  { k: '投资活动净现金流', v: formatAmount(row.investingNetCash) },
  { k: '资本开支', v: formatAmount(row.capitalExpenditure) },
  { k: '筹资活动净现金流', v: formatAmount(row.financingNetCash) },
  { k: '现金净增加额', v: formatAmount(row.netCashIncrease) },
];

/** 当前选中表的三态区块（业绩预告单独渲染，不含在键值行里） */
const periodBlock = computed(() => {
  if (activeTable.value === 'summary') return summary.value;
  if (activeTable.value === 'balance') return balance.value;
  return cashflow.value;
});

/** 选中报告期（切表 / 换股自动回最新一期） */
const periodIdx = ref(0);
watch([activeTable, () => props.symbol], () => {
  periodIdx.value = 0;
});

/** 当前报告期的键值行（按表分发装配器） */
const kvRows = computed<KvRow[]>(() => {
  const row = periodBlock.value.data[periodIdx.value];
  if (!row) return [];
  if (activeTable.value === 'summary') return summaryKv(row as FinancialSummaryRow);
  if (activeTable.value === 'balance') return balanceKv(row as BalanceSheetRow);
  return cashflowKv(row as CashFlowRow);
});
</script>

<template>
  <div>
    <!-- 四表切换 chips（样式复用 m-chips；页面级 chips 的 padding 由内联覆盖） -->
    <div class="m-chips" style="padding: 10px 12px 0">
      <button
        v-for="t in TABLES"
        :key="t.key"
        class="m-chip m-chip--sub"
        :class="{ 'm-chip--active': activeTable === t.key }"
        @click="activeTable = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 业绩预告：行列表（预告类型 · 指标 + 同比增幅区间 + 原文摘要） -->
    <template v-if="activeTable === 'forecast'">
      <div v-if="forecast.loading" class="m-skel-block">
        <div v-for="i in 8" :key="i" class="m-skel-row"></div>
      </div>
      <div v-else-if="forecast.error" class="m-state">
        {{ forecast.error }}
        <button class="retry" @click="void reloadTable('forecast')">重试</button>
      </div>
      <div v-else-if="!forecast.data.length" class="m-state">暂无业绩预告</div>
      <template v-else>
        <div v-for="row in forecast.data" :key="row.reportDate + row.metricName" class="m-row">
          <div class="m-row__nm">
            {{ row.predictType ?? '预告' }} · {{ row.metricName }}
            <span class="sub">{{ row.reportDate }} {{ row.content ?? '' }}</span>
          </div>
          <span
            class="m-row__val sm"
            :class="
              row.growthLower === null
                ? ''
                : row.growthLower >= 0
                  ? 'm-up'
                  : 'm-down'
            "
          >
            {{ row.growthLower === null ? '--' : `${formatPct(row.growthLower)} ~ ${formatPct(row.growthUpper)}` }}
          </span>
        </div>
      </template>
    </template>

    <!-- 三张期间报表：报告期 chips + 键值行 -->
    <template v-else>
      <div v-if="periodBlock.loading" class="m-skel-block">
        <div v-for="i in 8" :key="i" class="m-skel-row"></div>
      </div>
      <div v-else-if="periodBlock.error" class="m-state">
        {{ periodBlock.error }}
        <button class="retry" @click="void reloadTable(activeTable)">重试</button>
      </div>
      <div v-else-if="!periodBlock.data.length" class="m-state">暂无数据</div>
      <template v-else>
        <div class="m-chips" style="padding: 10px 12px 0">
          <button
            v-for="(row, idx) in periodBlock.data"
            :key="row.reportDate"
            class="m-chip m-chip--sub"
            :class="{ 'm-chip--active': periodIdx === idx }"
            @click="periodIdx = idx"
          >
            {{ row.reportDate }}
          </button>
        </div>
        <div v-for="kv in kvRows" :key="kv.k" class="m-kv">
          <span class="m-kv__k">{{ kv.k }}</span>
          <span class="m-kv__v">{{ kv.v }}</span>
        </div>
      </template>
    </template>
  </div>
</template>
