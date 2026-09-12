<script setup lang="ts">
import { reactive, ref } from 'vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseCard from '../../components/ui/BaseCard.vue';
import BaseEmpty from '../../components/ui/BaseEmpty.vue';
import BaseInput from '../../components/ui/BaseInput.vue';
import BaseSkeleton from '../../components/ui/BaseSkeleton.vue';
import BaseTable from '../../components/ui/BaseTable.vue';
import BaseTag from '../../components/ui/BaseTag.vue';
import type { TableColumn } from '../../types/table.types';
import EquityCurveChart from '../../components/charts/EquityCurveChart.vue';
import { runMaCrossBacktest, runScreener } from '../../api/screener.api';
import type { BacktestResult } from '../../api/screener.api';
import {
  SCREENER_TOP_N,
  SCREENER_TOP_N_OPTIONS,
} from '../../constants/screener.constants';
import type { FullQuote } from '../../types/stock-quote.types';
import { formatAmount } from '../../utils/format-amount';
import { formatPercent, formatPercentUnsigned } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import { normalizeAShareCode } from '../../utils/normalize-a-share-code';
import { useDockPanelStore } from '../../stores/dock-panel';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';

/**
 * 基础筛选工具：条件筛选（涨幅/换手/量比/PE）+ 简单回测（MA 金叉死叉 vs 买入持有基准）
 *
 * 全市场快照与 K 线均为重接口，全部由用户点击触发，不做轮询
 */
const dockPanel = useDockPanelStore();

// ---------- 筛选条件 ----------
const filters = reactive({
  changeMin: '',
  changeMax: '',
  turnoverMin: '',
  turnoverMax: '',
  volumeRatioMin: '',
  peMax: '',
});

/** 结果条数（字符串绑定 select，数值化使用） */
const topN = ref<string>(String(SCREENER_TOP_N));

const results = ref<FullQuote[]>([]);
const isScreening = ref(false);
const screenError = ref(false);
const hasScreened = ref(false);

/**
 * 解析数字输入：空串返回 undefined（不过滤）
 * @param value 输入框原值
 * @returns 数值或 undefined
 */
const parseNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : undefined;
};

/** 执行选股 */
const onScreen = async (): Promise<void> => {
  isScreening.value = true;
  screenError.value = false;
  try {
    results.value = await runScreener(
      {
        changeMin: parseNumber(filters.changeMin),
        changeMax: parseNumber(filters.changeMax),
        turnoverMin: parseNumber(filters.turnoverMin),
        turnoverMax: parseNumber(filters.turnoverMax),
        volumeRatioMin: parseNumber(filters.volumeRatioMin),
        peMax: parseNumber(filters.peMax),
      },
      Number(topN.value),
    );
    hasScreened.value = true;
  } catch (error) {
    results.value = [];
    screenError.value = true;
    console.error('[screener]', error);
  } finally {
    isScreening.value = false;
  }
};

/**
 * 结果行跳详情
 * @param quote 筛选结果项
 */
const openDetail = (quote: FullQuote): void => {
  dockPanel.openStock(quote.code);
};

// ---------- 简单回测 ----------
const backtestSymbol = ref('');
const backtestResult = ref<BacktestResult | null>(null);
const isBacktesting = ref(false);
const backtestError = ref(false);

/** 执行 MA 金叉死叉回测 */
const onBacktest = async (): Promise<void> => {
  const input = backtestSymbol.value.trim();
  if (!input) {
    return;
  }
  isBacktesting.value = true;
  backtestError.value = false;
  try {
    backtestResult.value = await runMaCrossBacktest(input);
  } catch (error) {
    backtestResult.value = null;
    backtestError.value = true;
    console.error('[backtest]', error);
  } finally {
    isBacktesting.value = false;
  }
};

/**
 * 从筛选结果回填回测标的并执行
 * @param quote 筛选结果项
 */
const backtestFromResult = (quote: FullQuote): void => {
  backtestSymbol.value = normalizeAShareCode(quote.code);
  void onBacktest();
};

/** 筛选结果列配置（涨跌幅默认开启排序） */
const resultColumns: TableColumn<FullQuote>[] = [
  { key: 'name', label: '个股' },
  { key: 'price', label: '现价', align: 'right' },
  {
    key: 'changePercent',
    label: '涨跌幅',
    align: 'right',
    sortable: true,
    sortValue: (quote) => quote.changePercent,
  },
  { key: 'turnoverRate', label: '换手率', align: 'right' },
  { key: 'volumeRatio', label: '量比', align: 'right' },
  { key: 'amount', label: '成交额', align: 'right' },
  { key: 'actions', label: '回测', align: 'right' },
];
</script>

<template>
  <div class="space-y-4">
    <!-- 筛选条件 -->
    <BaseCard title="筛选条件（留空表示不过滤）">
      <div class="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-6">
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">涨幅 ≥ (%)</span>
          <BaseInput v-model="filters.changeMin" placeholder="-100" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">涨幅 ≤ (%)</span>
          <BaseInput v-model="filters.changeMax" placeholder="100" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">换手率 ≥ (%)</span>
          <BaseInput v-model="filters.turnoverMin" placeholder="0" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">换手率 ≤ (%)</span>
          <BaseInput v-model="filters.turnoverMax" placeholder="100" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">量比 ≥</span>
          <BaseInput v-model="filters.volumeRatioMin" placeholder="0" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">PE(TTM) ≤</span>
          <BaseInput v-model="filters.peMax" placeholder="不限" />
        </label>
      </div>
      <div class="mt-4 flex items-center gap-3">
        <BaseButton :disabled="isScreening" @click="onScreen">
          {{ isScreening ? '筛选中...' : '开始筛选（全市场）' }}
        </BaseButton>
        <label class="flex items-center gap-1.5 text-xs text-text-tertiary">
          结果条数
          <select
            v-model="topN"
            class="rounded-lg bg-flat-weak px-2 py-1 text-xs text-text outline-none"
          >
            <option v-for="n in SCREENER_TOP_N_OPTIONS" :key="n" :value="String(n)">Top{{ n }}</option>
          </select>
        </label>
        <span v-if="hasScreened && !isScreening" class="text-xs text-text-tertiary">
          命中 {{ results.length }} 只
        </span>
      </div>
    </BaseCard>

    <!-- 筛选结果 -->
    <BaseCard title="筛选结果">
      <div v-if="screenError" class="py-10">
        <BaseEmpty text="筛选失败，请稍后重试（全市场快照可能被上游限频）" />
      </div>
      <div v-else-if="isScreening"><BaseSkeleton /></div>
      <BaseTable
        v-else-if="results.length > 0"
        :columns="resultColumns"
        :rows="results"
        :row-key="(quote) => quote.code"
        row-clickable
        @row-click="openDetail"
      >
        <template #name="{ row }">
          <span class="font-medium text-text">{{ row.name }}</span>
          <span class="ml-1 text-xs text-text-tertiary">{{ row.code }}</span>
        </template>
        <template #price="{ row }">
          <span :class="TREND_TEXT_CLASS[getTrendByChangePercent(row.changePercent)]">
            {{ formatPrice(row.price) }}
          </span>
        </template>
        <template #changePercent="{ row }">
          <span
            class="rounded-full px-2 py-0.5 text-xs font-semibold"
            :class="TREND_PILL_CLASS[getTrendByChangePercent(row.changePercent)]"
          >
            {{ formatPercent(row.changePercent) }}
          </span>
        </template>
        <template #turnoverRate="{ row }">
          <span class="text-text-secondary">{{ formatPercentUnsigned(row.turnoverRate) }}</span>
        </template>
        <template #volumeRatio="{ row }">
          <span class="text-text-secondary">{{ formatPrice(row.volumeRatio) }}</span>
        </template>
        <template #amount="{ row }">
          <span class="text-text-secondary">{{ formatAmount(row.amount) }}</span>
        </template>
        <template #actions="{ row }">
          <button
            type="button"
            class="pressable rounded bg-primary-weak px-2 py-0.5 text-xs text-primary active:scale-90"
            @click.stop="backtestFromResult(row)"
          >
            回测
          </button>
        </template>
      </BaseTable>
      <BaseEmpty v-else-if="hasScreened" text="无符合条件的标的，试着放宽条件" />
      <BaseEmpty v-else text="设置条件后点击「开始筛选」" />
    </BaseCard>

    <!-- 简单回测 -->
    <BaseCard title="简单回测（MA5/20 金叉死叉策略 · 近一年日K · 含费）">
      <div class="flex flex-wrap items-end gap-3">
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">标的（600519 / sh600519 均可）</span>
          <BaseInput v-model="backtestSymbol" placeholder="sh600519" class="w-48" />
        </label>
        <BaseButton variant="ghost" :disabled="isBacktesting || !backtestSymbol.trim()" @click="onBacktest">
          {{ isBacktesting ? '回测中...' : '开始回测' }}
        </BaseButton>
        <span class="text-xs text-text-tertiary">可从筛选结果点「回测」快速填入</span>
      </div>

      <div v-if="backtestError" class="mt-4 py-8">
        <BaseEmpty text="回测失败，请检查标的后重试" />
      </div>
      <template v-else-if="backtestResult">
        <div class="mt-4 grid grid-cols-2 gap-3 @3xl:grid-cols-5">
          <div class="rounded-card bg-flat-weak p-3">
            <p class="text-xs text-text-tertiary">策略总收益</p>
            <p
              class="mt-1 text-lg font-semibold tabular-nums"
              :class="backtestResult.report.totalReturn >= 0 ? 'text-up' : 'text-down'"
            >
              {{ formatPercent(backtestResult.report.totalReturn) }}
            </p>
          </div>
          <div class="rounded-card bg-flat-weak p-3">
            <p class="text-xs text-text-tertiary">买入持有基准</p>
            <p
              class="mt-1 text-lg font-semibold tabular-nums"
              :class="backtestResult.report.buyHoldReturn >= 0 ? 'text-up' : 'text-down'"
            >
              {{ formatPercent(backtestResult.report.buyHoldReturn) }}
            </p>
          </div>
          <div class="rounded-card bg-flat-weak p-3">
            <p class="text-xs text-text-tertiary">胜率</p>
            <p class="mt-1 text-lg font-semibold tabular-nums text-text">
              {{ formatPercentUnsigned(backtestResult.report.winRate) }}
            </p>
          </div>
          <div class="rounded-card bg-flat-weak p-3">
            <p class="text-xs text-text-tertiary">最大回撤</p>
            <p class="mt-1 text-lg font-semibold tabular-nums text-down">
              {{ formatPercentUnsigned(backtestResult.report.maxDrawdown) }}
            </p>
          </div>
          <div class="rounded-card bg-flat-weak p-3">
            <p class="text-xs text-text-tertiary">交易次数</p>
            <p class="mt-1 text-lg font-semibold tabular-nums text-text">
              {{ backtestResult.report.tradeCount }}
            </p>
          </div>
        </div>
        <div class="mt-4">
          <EquityCurveChart
            :dates="backtestResult.dates"
            :equity-curve="backtestResult.equityCurve"
            :buy-hold-curve="backtestResult.buyHoldCurve"
          />
        </div>
        <p class="mt-2 flex items-center gap-2 text-xs text-text-tertiary">
          <BaseTag tone="flat">提示</BaseTag>
          回测为简化模型（全仓进出、固定费率），不构成投资建议
        </p>
      </template>
      <div v-else-if="isBacktesting" class="mt-4"><BaseSkeleton /></div>
      <BaseEmpty v-else text="输入标的或从筛选结果点「回测」查看策略对比" />
    </BaseCard>
  </div>
</template>
