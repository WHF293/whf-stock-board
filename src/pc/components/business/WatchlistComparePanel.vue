<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import MenuIcon from '../ui/MenuIcon.vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import CompareTrendChart from '../charts/CompareTrendChart.vue';
import { fetchKlineCached } from '../../../common/api/kline-cache.api.ts';
import { appStorage } from '../../../common/utils/app-local-storage';
import { normalizeSeriesToBase } from '../../../common/utils/normalize-series-to-base';
import { calcCompareStatsList } from '../../../common/utils/calc-compare-stats';
import {
  COMPARE_MAX_STOCKS,
  COMPARE_RANGE_DEFAULT,
  COMPARE_RANGE_OPTIONS,
} from '../../../common/constants/compare.constants.ts';
import { STORAGE_NS_WATCHLIST_COMPARE } from '../../../common/constants/storage-key.constants.ts';
import { trackAction } from '../../weblog/weblogActions';
import type {
  CompareNormalized,
  CompareSeriesInput,
  CompareStatsItem,
} from '../../../common/types/compare.types.ts';
import type { WatchlistStock } from '../../../common/types/watchlist.types.ts';
import type { KLineData } from 'klinecharts';

/**
 * 自选股 · 多票归一化叠加对比面板
 *
 * - 勾选当前分组的票（2~6 只）→ 自动拉日 K（走 fetchKlineCached，缓存命中零上游请求）
 *   并渲染归一化叠加曲线（基准 100）+ 三项统计表（区间涨跌幅 / 最大回撤 / 年化波动率）；
 * - 勾选集与区间持久化（appStorage 命名空间），重新进入恢复上次对比组合；
 * - 取数串行小并发（逐票就绪逐条入图由 normalization 天然聚合，这里整批等待后一次渲染）；
 * - 统计口径与曲线一致：均为「相对自身区间起点」（次新股按自身首日起算）。
 */
const props = defineProps<{
  /** 当前分组的自选股列表（勾选源） */
  stocks: WatchlistStock[];
}>();

/** 勾选的符号（key = symbol） */
const selectedSymbols = ref<string[]>([]);

/** 对比区间（交易日） */
const rangeDays = ref<number>(COMPARE_RANGE_DEFAULT);

/** 取数中 */
const loading = ref(false);

/** 取数失败的票（提示但不阻断其余票渲染） */
const failedSymbols = ref<string[]>([]);

/** 归一化结果 */
const normalized = ref<CompareNormalized | null>(null);

/** 统计表数据 */
const stats = ref<CompareStatsItem[]>([]);

/** 名称映射（图例 / 统计表展示用） */
const nameBySymbol = computed<Record<string, string>>(() =>
  Object.fromEntries(props.stocks.map((stock) => [stock.symbol, stock.name])),
);

// ---------- 勾选集与区间的持久化 ----------

/** 持久化快照形态 */
interface ComparePersist {
  symbols: string[];
  rangeDays: number;
}

try {
  const raw = JSON.parse(
    appStorage.getItem(STORAGE_NS_WATCHLIST_COMPARE) ?? 'null',
  ) as ComparePersist | null;
  if (raw) {
    selectedSymbols.value = raw.symbols ?? [];
    rangeDays.value = raw.rangeDays ?? COMPARE_RANGE_DEFAULT;
  }
} catch {
  // 损坏数据按默认组合处理
}

/**
 * 持久化当前对比组合
 */
const persist = (): void => {
  const snapshot: ComparePersist = {
    symbols: selectedSymbols.value,
    rangeDays: rangeDays.value,
  };
  appStorage.setItem(STORAGE_NS_WATCHLIST_COMPARE, JSON.stringify(snapshot));
};

/**
 * 切换一只票的勾选态（超上限拒绝并提示）
 * @param symbol 完整符号
 */
const toggleStock = (symbol: string): void => {
  const index = selectedSymbols.value.indexOf(symbol);
  if (index >= 0) {
    selectedSymbols.value = selectedSymbols.value.filter((item) => item !== symbol);
  } else if (selectedSymbols.value.length >= COMPARE_MAX_STOCKS) {
    return;
  } else {
    selectedSymbols.value = [...selectedSymbols.value, symbol];
  }
  persist();
  trackAction('WATCHLIST_COMPARE_TOGGLE', { detail: `${symbol} (${selectedSymbols.value.length})` });
};

// ---------- 对比执行 ----------

/**
 * 执行一次对比：串行拉各票日 K → 归一化 + 统计
 */
const runCompare = async (): Promise<void> => {
  const selected = props.stocks.filter((stock) => selectedSymbols.value.includes(stock.symbol));
  if (selected.length < 2) {
    normalized.value = null;
    stats.value = [];
    return;
  }
  loading.value = true;
  failedSymbols.value = [];
  const inputs: CompareSeriesInput[] = [];
  const failed: string[] = [];
  for (const stock of selected) {
    try {
      const bars: KLineData[] = await fetchKlineCached(stock.symbol, 'daily', { write: true });
      const closes = bars
        .filter((bar) => typeof bar.close === 'number' && typeof bar.timestamp === 'number')
        .map((bar) => ({ timestamp: bar.timestamp, close: bar.close as number }));
      if (closes.length > 0) {
        inputs.push({ symbol: stock.symbol, name: stock.name, closes });
      } else {
        failed.push(stock.symbol);
      }
    } catch {
      failed.push(stock.symbol);
    }
  }
  failedSymbols.value = failed;
  normalized.value = normalizeSeriesToBase(inputs, rangeDays.value);
  stats.value = calcCompareStatsList(inputs);
  loading.value = false;
};

/** 防抖触发（勾选连续点选时避免整批重复拉取） */
const debouncedRun = useDebounceFn(() => void runCompare(), 400);

watch([selectedSymbols, rangeDays], () => {
  void debouncedRun();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <!-- 工具行：区间 + 勾选计数 -->
    <div class="flex shrink-0 items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <select
          v-model.number="rangeDays"
          class="h-8 rounded-lg border border-flat-weak bg-surface px-2 text-xs text-text"
          aria-label="对比区间"
        >
          <option v-for="option in COMPARE_RANGE_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <span class="text-xs text-text-tertiary">
          已选 {{ selectedSymbols.length }}/{{ COMPARE_MAX_STOCKS }}（至少选 2 只）
        </span>
      </div>
      <BaseButton
        v-if="selectedSymbols.length > 0"
        variant="ghost"
        @click="
          () => {
            selectedSymbols = [];
            persist();
          }
        "
      >
        <MenuIcon name="close" :size="14" />
        清空
      </BaseButton>
    </div>

    <!-- 勾选 chips（点击切换选中；超上限时其余 chip 置灰） -->
    <div class="flex shrink-0 flex-wrap gap-1.5">
      <button
        v-for="stock in stocks"
        :key="stock.symbol"
        type="button"
        class="rounded-full border px-2.5 py-1 text-xs transition-colors"
        :class="
          selectedSymbols.includes(stock.symbol)
            ? 'border-primary bg-primary-weak text-primary'
            : 'border-flat-weak text-text-secondary hover:border-primary hover:text-primary'
        "
        :disabled="
          !selectedSymbols.includes(stock.symbol) && selectedSymbols.length >= COMPARE_MAX_STOCKS
        "
        @click="toggleStock(stock.symbol)"
      >
        {{ stock.name }}
      </button>
    </div>

    <!-- 主体：曲线 + 统计表 -->
    <div class="flex min-h-0 flex-1 flex-col gap-3">
      <div
        v-if="loading"
        class="flex flex-1 items-center justify-center text-xs text-text-tertiary"
      >
        正在拉取日 K...
      </div>
      <BaseEmpty
        v-else-if="selectedSymbols.length < 2"
        text="勾选 2~6 只票开始对比"
      />
      <template v-else>
        <p
          v-if="failedSymbols.length > 0"
          class="shrink-0 text-xs text-down"
        >
          {{ failedSymbols.length }} 只票取数失败已跳过：{{ failedSymbols.join('、') }}
        </p>
        <p
          v-if="normalized && normalized.dates.length === 0"
          class="shrink-0 text-xs text-down"
        >
          所选票交易日完全错开，无法对齐，请调整组合
        </p>
        <div v-else class="min-h-0 flex-1">
          <CompareTrendChart
            :dates="normalized?.dates ?? []"
            :values="normalized?.values ?? {}"
            :names="nameBySymbol"
          />
        </div>
        <!-- 统计表 -->
        <table v-if="stats.length >= 2" class="w-full shrink-0 text-xs">
          <thead>
            <tr class="border-b border-flat-weak text-text-tertiary">
              <th class="py-1.5 text-left font-normal">名称</th>
              <th class="py-1.5 text-right font-normal">区间涨跌幅</th>
              <th class="py-1.5 text-right font-normal">最大回撤</th>
              <th class="py-1.5 text-right font-normal">年化波动率</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in stats"
              :key="item.symbol"
              class="border-b border-flat-weak/50 last:border-0"
            >
              <td class="py-1.5 text-text">{{ item.name }}</td>
              <td
                class="py-1.5 text-right"
                :class="item.changePct >= 0 ? 'text-up' : 'text-down'"
              >
                {{ item.changePct >= 0 ? '+' : '' }}{{ item.changePct.toFixed(2) }}%
              </td>
              <td class="py-1.5 text-right text-down">{{ item.maxDrawdownPct.toFixed(2) }}%</td>
              <td class="py-1.5 text-right text-text-secondary">
                {{ item.annualVolPct === null ? '—' : `${item.annualVolPct.toFixed(2)}%` }}
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
  </div>
</template>
