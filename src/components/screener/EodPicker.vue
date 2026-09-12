<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseCard from '../../components/ui/BaseCard.vue';
import BaseEmpty from '../../components/ui/BaseEmpty.vue';
import BaseInput from '../../components/ui/BaseInput.vue';
import BaseSkeleton from '../../components/ui/BaseSkeleton.vue';
import BaseSwitch from '../../components/ui/BaseSwitch.vue';
import BaseTable from '../../components/ui/BaseTable.vue';
import type { TableColumn } from '../../types/table.types';
import { analyzeEodStocks } from '../../api/analysis.api';
import {
  EOD_FILTERS_DEFAULT,
  EOD_TIMELINE_CONCURRENCY,
} from '../../constants/analysis.constants';
import { useDockPanelStore } from '../../stores/dock-panel';
import type { AnalysisProgress, EodFilters, EodStock } from '../../types/analysis.types';
import { formatPercent, formatPercentUnsigned } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';

/**
 * 尾盘选股工具（参考 stock-dashboard eod-picker / 尾盘选股法）：
 * 全市场快照按流通市值 / 量比 / 涨幅 / 换手率 / ST 基础过滤，
 * 再按分时强度（分时价位于均价上方的时间占比）精筛强势股
 *
 * 全市场快照与分时均为重接口，全部由用户点击触发，不做轮询
 */
const dockPanel = useDockPanelStore();

/** 过滤条件（默认值参考尾盘选股法常用参数） */
const filters = reactive<EodFilters>({ ...EOD_FILTERS_DEFAULT });

const isAnalyzing = ref(false);
const progress = ref<AnalysisProgress>({ stage: '待开始', completed: 0, total: 0 });
const results = ref<EodStock[]>([]);
const hasRun = ref(false);
const notice = ref<string | null>(null);
const abortController = ref<AbortController | null>(null);

/** 数字输入双向绑定（空串按 0 处理由用户自行权衡；null 上限以空串表示） */
const filterForm = reactive({
  marketCapMin: String(EOD_FILTERS_DEFAULT.marketCapMin),
  marketCapMax: String(EOD_FILTERS_DEFAULT.marketCapMax ?? ''),
  volumeRatioMin: String(EOD_FILTERS_DEFAULT.volumeRatioMin),
  changePercentMin: String(EOD_FILTERS_DEFAULT.changePercentMin),
  changePercentMax: String(EOD_FILTERS_DEFAULT.changePercentMax ?? ''),
  turnoverRateMin: String(EOD_FILTERS_DEFAULT.turnoverRateMin),
  turnoverRateMax: String(EOD_FILTERS_DEFAULT.turnoverRateMax ?? ''),
  timelineAboveAvgRatioMin: String(EOD_FILTERS_DEFAULT.timelineAboveAvgRatioMin),
});

/**
 * 表单收集为过滤条件（非法输入回退默认值）
 * @returns 过滤条件对象
 */
const collectFilters = (): EodFilters => {
  const num = (value: string, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const nullableNum = (value: string): number | null => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    marketCapMin: num(filterForm.marketCapMin, EOD_FILTERS_DEFAULT.marketCapMin),
    marketCapMax: nullableNum(filterForm.marketCapMax),
    volumeRatioMin: num(filterForm.volumeRatioMin, EOD_FILTERS_DEFAULT.volumeRatioMin),
    changePercentMin: num(filterForm.changePercentMin, EOD_FILTERS_DEFAULT.changePercentMin),
    changePercentMax: nullableNum(filterForm.changePercentMax),
    turnoverRateMin: num(filterForm.turnoverRateMin, EOD_FILTERS_DEFAULT.turnoverRateMin),
    turnoverRateMax: nullableNum(filterForm.turnoverRateMax),
    excludeST: filters.excludeST,
    timelineAboveAvgRatioMin: num(
      filterForm.timelineAboveAvgRatioMin,
      EOD_FILTERS_DEFAULT.timelineAboveAvgRatioMin,
    ),
  };
};

/** 执行尾盘分析（可取消） */
const onAnalyze = async (): Promise<void> => {
  isAnalyzing.value = true;
  results.value = [];
  notice.value = null;
  progress.value = { stage: '准备中', completed: 0, total: 0 };
  const controller = new AbortController();
  abortController.value = controller;
  try {
    const stocks = await analyzeEodStocks(collectFilters(), {
      signal: controller.signal,
      onProgress: (value) => {
        progress.value = value;
      },
    });
    results.value = stocks;
    hasRun.value = true;
    if (stocks.length === 0) {
      notice.value = '分析完成，暂无符合条件的标的，试着放宽条件';
    }
  } catch (error) {
    if ((error as Error)?.message !== '分析已取消') {
      console.error('[eod-picker]', error);
      notice.value = '分析失败，请稍后重试（全市场快照可能被上游限频）';
    }
  } finally {
    abortController.value = null;
    isAnalyzing.value = false;
  }
};

/** 取消分析 */
const onCancel = (): void => {
  abortController.value?.abort();
};

onBeforeUnmount(() => {
  abortController.value?.abort();
});

/**
 * 结果行打开个股详情
 * @param stock 结果行
 */
const openDetail = (stock: EodStock): void => {
  dockPanel.openStock(stock.symbol);
};

/** 结果列配置（涨跌幅默认开启排序） */
const resultColumns: TableColumn<EodStock>[] = [
  { key: 'name', label: '个股' },
  { key: 'price', label: '现价', align: 'right' },
  {
    key: 'changePercent',
    label: '涨跌幅',
    align: 'right',
    sortable: true,
    sortValue: (stock) => stock.changePercent,
  },
  { key: 'turnoverRate', label: '换手率', align: 'right' },
  { key: 'volumeRatio', label: '量比', align: 'right' },
  { key: 'circulatingMarketCap', label: '流通市值', align: 'right' },
  {
    key: 'timelineAboveAvgRatio',
    label: '分时强度',
    align: 'right',
    sortable: true,
    sortValue: (stock) => stock.timelineAboveAvgRatio,
  },
];
</script>

<template>
  <div class="space-y-4">
    <!-- 筛选条件 -->
    <BaseCard title="筛选条件">
      <div class="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">流通市值 ≥ (亿)</span>
          <BaseInput v-model="filterForm.marketCapMin" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">流通市值 ≤ (亿，空为不限)</span>
          <BaseInput v-model="filterForm.marketCapMax" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">量比 ≥</span>
          <BaseInput v-model="filterForm.volumeRatioMin" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">当日涨幅 ≥ (%)</span>
          <BaseInput v-model="filterForm.changePercentMin" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">当日涨幅 ≤ (%，空为不限)</span>
          <BaseInput v-model="filterForm.changePercentMax" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">换手率 ≥ (%)</span>
          <BaseInput v-model="filterForm.turnoverRateMin" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">换手率 ≤ (%，空为不限)</span>
          <BaseInput v-model="filterForm.turnoverRateMax" />
        </label>
        <label class="space-y-1">
          <span class="text-xs text-text-tertiary">分时强度 ≥ (%)</span>
          <BaseInput v-model="filterForm.timelineAboveAvgRatioMin" />
        </label>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          过滤 ST 股票
          <BaseSwitch v-model="filters.excludeST" />
        </label>
        <BaseButton :disabled="isAnalyzing" @click="onAnalyze">
          {{ isAnalyzing ? '分析中...' : '开始分析（全市场）' }}
        </BaseButton>
        <BaseButton v-if="isAnalyzing" variant="ghost" @click="onCancel">取消</BaseButton>
        <span v-if="isAnalyzing" class="text-xs text-text-tertiary">
          {{ progress.stage }}（{{ progress.completed }}/{{ progress.total }}）· 分时并发 {{ EOD_TIMELINE_CONCURRENCY }}
        </span>
        <span v-else-if="results.length > 0" class="text-xs text-text-tertiary">
          命中 {{ results.length }} 只
        </span>
      </div>
      <p class="mt-2 text-xs text-text-tertiary">
        分时强度 = 分时价格位于分时均价上方的时间占比，越大代表全天走势越强（尾盘选股法核心指标）
      </p>
    </BaseCard>

    <!-- 分析结果 -->
    <BaseCard title="分析结果（按分时强度降序）">
      <div v-if="isAnalyzing && results.length === 0"><BaseSkeleton /></div>
      <BaseTable
        v-else-if="results.length > 0"
        :columns="resultColumns"
        :rows="results"
        :row-key="(stock) => stock.symbol"
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
        <template #circulatingMarketCap="{ row }">
          <span class="text-text-secondary">
            {{ row.circulatingMarketCap === null ? '--' : `${formatPrice(row.circulatingMarketCap)}亿` }}
          </span>
        </template>
        <template #timelineAboveAvgRatio="{ row }">
          <span
            class="font-medium"
            :class="row.timelineAboveAvgRatio >= 80 ? 'text-up' : 'text-text-secondary'"
          >
            {{ formatPercentUnsigned(row.timelineAboveAvgRatio) }}
          </span>
        </template>
      </BaseTable>
      <BaseEmpty v-else-if="hasRun" text="无符合条件的标的，试着放宽条件" />
      <BaseEmpty v-else text="设置条件后点击「开始分析」" />
      <p v-if="notice" class="mt-2 text-xs text-down">{{ notice }}</p>
    </BaseCard>
  </div>
</template>
