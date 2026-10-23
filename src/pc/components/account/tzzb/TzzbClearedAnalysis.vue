<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseTable from '../../ui/BaseTable.vue';
import BaseTabs from '../../ui/BaseTabs.vue';
import type { TableColumn } from '../../../../common/types/table.types.ts';
import type {
  TzzbClearedPosition,
  TzzbHoldingReturn,
} from '../../../../common/types/tzzb.types.ts';

/**
 * 投资账本 · 清仓分析
 *
 * 按建清仓周期逐笔分析个股 / 个基的盈亏与费用：
 * - 个股：queryClearedPosition 完整买卖回合（盈亏、收益率、费用、费用/|盈亏|、持有天数、回合数），
 *   顶部汇总条给出累计盈亏 / 累计费用 / 胜率 / 平均持有天数，并按持有天数分桶（短线/波段/中线/长线）；
 * - 个基：15 工具无基金清仓周期（queryClearedPosition 仅覆盖股票），
 *   当前以 queryFundHoldingReturns 累计持仓收益口径展示，费用字段缺失显示 —；
 *   正式版如有基金清仓工具再对齐周期口径
 */
const props = defineProps<{
  /** 清仓记录（个股周期） */
  cleared: TzzbClearedPosition[];
  /** 个基累计持仓收益 */
  fundReturns: TzzbHoldingReturn[];
}>();

const emit = defineEmits<{
  /** 点击行打开个股 / 基金详情 */
  open: [code: string];
}>();

const KIND_OPTIONS = [
  { label: '个股', value: 'stock' },
  { label: '个基', value: 'fund' },
];
const kind = ref<string>('stock');

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

/* ---------------- 个股周期汇总 ---------------- */

/** 已清仓周期（持有中不计入胜率 / 平均持有） */
const closedCycles = computed(() => props.cleared.filter((r) => r.closeDate));

/** 个股汇总指标 */
const stockSummary = computed(() => {
  const closed = closedCycles.value;
  if (props.cleared.length === 0) return null;
  const totalProfit = props.cleared.reduce((s, r) => s + r.profit, 0);
  const totalFee = props.cleared.reduce((s, r) => s + r.fee, 0);
  const wins = closed.filter((r) => r.profit > 0).length;
  const best = closed.reduce<TzzbClearedPosition | null>(
    (a, b) => (!a || b.profit > a.profit ? b : a),
    null,
  );
  const worst = closed.reduce<TzzbClearedPosition | null>(
    (a, b) => (!a || b.profit < a.profit ? b : a),
    null,
  );
  return {
    totalProfit,
    totalFee,
    /** 费用占 |累计盈亏| 比例（盈亏为 0 时无意义） */
    feeRatio: totalProfit !== 0 ? totalFee / Math.abs(totalProfit) : null,
    winRate: closed.length > 0 ? wins / closed.length : null,
    avgHold:
      closed.length > 0 ? closed.reduce((s, r) => s + r.holdDays, 0) / closed.length : null,
    best,
    worst,
  };
});

/** 持有天数分桶（仅已清仓周期） */
const HOLD_BUCKETS = [
  { label: '短线 ≤7 天', test: (d: number) => d <= 7 },
  { label: '波段 8~30 天', test: (d: number) => d > 7 && d <= 30 },
  { label: '中线 31~180 天', test: (d: number) => d > 30 && d <= 180 },
  { label: '长线 >180 天', test: (d: number) => d > 180 },
] as const;

/** 分桶统计：周期数 / 盈亏合计 / 胜率 / 费用合计 */
const buckets = computed(() =>
  HOLD_BUCKETS.map((b) => {
    const rows = closedCycles.value.filter((r) => b.test(r.holdDays));
    const profit = rows.reduce((s, r) => s + r.profit, 0);
    return {
      label: b.label,
      count: rows.length,
      profit,
      fee: rows.reduce((s, r) => s + r.fee, 0),
      winRate: rows.length > 0 ? rows.filter((r) => r.profit > 0).length / rows.length : null,
    };
  }),
);

/** 个股周期明细列 */
const stockColumns: TableColumn<TzzbClearedPosition>[] = [
  { key: 'name', label: '证券', sortable: true, sortValue: (r) => r.name },
  {
    key: 'period',
    label: '周期（开 → 清）',
    sortable: true,
    sortValue: (r) => r.openDate,
  },
  { key: 'holdDays', label: '天数', align: 'right', sortable: true, sortValue: (r) => r.holdDays },
  { key: 'rounds', label: '回合', align: 'right', sortable: true, sortValue: (r) => r.rounds },
  { key: 'profit', label: '盈亏', align: 'right', sortable: true, sortValue: (r) => r.profit },
  { key: 'rate', label: '收益率', align: 'right', sortable: true, sortValue: (r) => r.rate },
  { key: 'fee', label: '费用', align: 'right', sortable: true, sortValue: (r) => r.fee },
  {
    key: 'feeRatio',
    label: '费用 / |盈亏|',
    align: 'right',
    sortable: true,
    sortValue: (r) => (r.profit !== 0 ? r.fee / Math.abs(r.profit) : 0),
  },
];

/* ---------------- 个基（累计口径） ---------------- */

/** 个基汇总指标 */
const fundSummary = computed(() => {
  const rows = props.fundReturns;
  if (rows.length === 0) return null;
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
  const wins = rows.filter((r) => r.profit > 0).length;
  const best = rows.reduce<TzzbHoldingReturn | null>((a, b) => (!a || b.profit > a.profit ? b : a), null);
  const worst = rows.reduce<TzzbHoldingReturn | null>((a, b) => (!a || b.profit < a.profit ? b : a), null);
  return { totalProfit, count: rows.length, winRate: wins / rows.length, best, worst };
});

/** 个基明细列（费用缺失显示 —） */
const fundColumns: TableColumn<TzzbHoldingReturn>[] = [
  { key: 'name', label: '基金', sortable: true, sortValue: (r) => r.name },
  { key: 'profit', label: '累计盈亏', align: 'right', sortable: true, sortValue: (r) => r.profit },
  { key: 'rate', label: '累计收益率', align: 'right', sortable: true, sortValue: (r) => r.rate },
  { key: 'fee', label: '费用', align: 'right' },
];
</script>

<template>
  <BaseEmpty
    v-if="cleared.length === 0 && fundReturns.length === 0"
    text="暂无建清仓数据：同步投资账本后自动生成周期分析"
  />
  <div v-else class="flex flex-col gap-3">
    <!-- 维度切换 -->
    <div class="flex items-center justify-between gap-2">
      <BaseTabs v-model="kind" :options="KIND_OPTIONS" />
      <span v-if="kind === 'fund'" class="text-xs text-text-tertiary">
        个基暂无清仓周期工具，当前为累计持仓收益口径（费用缺失显示 —）
      </span>
    </div>

    <!-- 个股：汇总条 + 分桶 + 周期明细 -->
    <template v-if="kind === 'stock'">
      <div v-if="stockSummary" class="grid grid-cols-2 gap-2 md:grid-cols-5">
        <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
          <p class="text-xs text-text-tertiary">累计盈亏（含持有中）</p>
          <p class="mt-0.5 font-mono text-base font-semibold tabular-nums" :class="plClass(stockSummary.totalProfit)">
            {{ signYuan(stockSummary.totalProfit) }}
          </p>
        </div>
        <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
          <p class="text-xs text-text-tertiary">累计费用</p>
          <p class="mt-0.5 font-mono text-base font-semibold tabular-nums text-text">
            {{ yuan(stockSummary.totalFee) }}
            <span v-if="stockSummary.feeRatio !== null" class="text-xs font-normal text-text-tertiary">
              （{{ (stockSummary.feeRatio * 100).toFixed(0) }}% of |盈亏|）
            </span>
          </p>
        </div>
        <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
          <p class="text-xs text-text-tertiary">胜率（已清 {{ closedCycles.length }} 笔）</p>
          <p class="mt-0.5 font-mono text-base font-semibold tabular-nums text-text">
            {{ stockSummary.winRate === null ? '—' : `${(stockSummary.winRate * 100).toFixed(0)}%` }}
          </p>
        </div>
        <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
          <p class="text-xs text-text-tertiary">平均持有天数</p>
          <p class="mt-0.5 font-mono text-base font-semibold tabular-nums text-text">
            {{ stockSummary.avgHold === null ? '—' : stockSummary.avgHold.toFixed(1) }}
          </p>
        </div>
        <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
          <p class="text-xs text-text-tertiary">最佳 / 最差周期</p>
          <p class="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums">
            <span :class="plClass(stockSummary.best?.profit ?? 0)">
              {{ stockSummary.best ? `${stockSummary.best.name} ${signYuan(stockSummary.best.profit)}` : '—' }}
            </span>
            <span class="mx-1 text-text-tertiary">/</span>
            <span :class="plClass(stockSummary.worst?.profit ?? 0)">
              {{ stockSummary.worst ? signYuan(stockSummary.worst.profit) : '—' }}
            </span>
          </p>
        </div>
      </div>

      <!-- 持有天数分桶 -->
      <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div
          v-for="b in buckets"
          :key="b.label"
          class="rounded-lg border border-flat-weak px-3 py-2"
        >
          <p class="text-xs text-text-secondary">{{ b.label }}</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            {{ b.count }} 笔 · 费用 {{ yuan(b.fee) }}
            <template v-if="b.winRate !== null">· 胜率 {{ (b.winRate * 100).toFixed(0) }}%</template>
          </p>
          <p
            v-if="b.count > 0"
            class="font-mono text-sm font-semibold tabular-nums"
            :class="plClass(b.profit)"
          >
            {{ signYuan(b.profit) }}
          </p>
          <p v-else class="font-mono text-sm text-text-tertiary">—</p>
        </div>
      </div>

      <!-- 周期明细 -->
      <BaseTable
        :columns="stockColumns"
        :rows="cleared"
        :row-key="(r) => `${r.code}-${r.openDate}`"
        :min-width="'780px'"
        scroll-class="table-scroll-sm"
        row-clickable
        footer-text="点击行打开个股详情"
        @row-click="(r) => emit('open', r.code)"
      >
        <template #name="{ row }">
          <span class="font-medium text-text">{{ row.name }}</span>
          <span class="ml-1 font-mono text-xs text-text-tertiary">{{ row.code }}</span>
        </template>
        <template #period="{ row }">
          <span class="font-mono text-xs">
            {{ row.openDate }} → <b v-if="row.closeDate" class="font-normal">{{ row.closeDate }}</b>
            <b v-else class="text-primary">持有中</b>
          </span>
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
        <template #feeRatio="{ row }">
          <span class="font-mono tabular-nums">
            {{ row.profit !== 0 ? `${((row.fee / Math.abs(row.profit)) * 100).toFixed(0)}%` : '—' }}
          </span>
        </template>
      </BaseTable>
    </template>

    <!-- 个基：汇总条 + 累计收益明细 -->
    <template v-else>
      <div v-if="fundSummary" class="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
          <p class="text-xs text-text-tertiary">累计盈亏（{{ fundSummary.count }} 只）</p>
          <p class="mt-0.5 font-mono text-base font-semibold tabular-nums" :class="plClass(fundSummary.totalProfit)">
            {{ signYuan(fundSummary.totalProfit) }}
          </p>
        </div>
        <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
          <p class="text-xs text-text-tertiary">盈利占比</p>
          <p class="mt-0.5 font-mono text-base font-semibold tabular-nums text-text">
            {{ (fundSummary.winRate * 100).toFixed(0) }}%
          </p>
        </div>
        <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
          <p class="text-xs text-text-tertiary">最佳</p>
          <p class="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums" :class="plClass(fundSummary.best?.profit ?? 0)">
            {{ fundSummary.best ? `${fundSummary.best.name} ${signYuan(fundSummary.best.profit)}` : '—' }}
          </p>
        </div>
        <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
          <p class="text-xs text-text-tertiary">最差</p>
          <p class="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums" :class="plClass(fundSummary.worst?.profit ?? 0)">
            {{ fundSummary.worst ? `${fundSummary.worst.name} ${signYuan(fundSummary.worst.profit)}` : '—' }}
          </p>
        </div>
      </div>

      <BaseTable
        :columns="fundColumns"
        :rows="fundReturns"
        :row-key="(r) => r.code"
        :min-width="'560px'"
        scroll-class="table-scroll-sm"
        row-clickable
        footer-text="点击行打开基金详情 · 费用字段内测接口未提供"
        @row-click="(r) => emit('open', r.code)"
      >
        <template #name="{ row }">
          <span class="font-medium text-text">{{ row.name }}</span>
          <span class="ml-1 font-mono text-xs text-text-tertiary">{{ row.code }}</span>
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
        <template #fee> <span class="text-text-tertiary">—</span> </template>
      </BaseTable>
    </template>
  </div>
</template>
