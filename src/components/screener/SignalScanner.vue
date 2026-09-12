<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseCard from '../../components/ui/BaseCard.vue';
import BaseEmpty from '../../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../../components/ui/BaseSkeleton.vue';
import BaseTable from '../../components/ui/BaseTable.vue';
import BaseTabs from '../../components/ui/BaseTabs.vue';
import BaseTag from '../../components/ui/BaseTag.vue';
import type { TableColumn } from '../../types/table.types';
import {
  fetchConceptBoards,
  fetchConceptConstituents,
  fetchIndustryBoards,
  fetchIndustryConstituents,
} from '../../api/board.api';
import { fetchAllMarketQuotes } from '../../api/quotes.api';
import { scanSignalPool } from '../../api/analysis.api';
import { sdk } from '../../api/sdk';
import {
  SCAN_BOARD_LIMIT_OPTIONS,
  SCAN_CONCURRENCY,
  SCAN_STOCK_CHANGE_OPTIONS,
  SCAN_TOP_N_OPTIONS,
  SCAN_ZT_POOL_OPTIONS,
  SIGNAL_TEMPLATES,
} from '../../constants/analysis.constants';
import { useDockPanelStore } from '../../stores/dock-panel';
import { useWatchlistStore } from '../../stores/watchlist';
import type {
  AnalysisProgress,
  ScanSignalResult,
  ScannerPoolItem,
  SignalKey,
} from '../../types/analysis.types';

/**
 * 信号扫描工具（参考 stock-dashboard scanner）：股票池来源（自选 / 板块 / 榜单 /
 * 涨停强势池 / 盘口异动池）+ 信号模板多选 + 并发扫描（支持取消、进度、边扫边出结果）
 */

/** 扫描并发（常量透出展示用） */
const CONCURRENCY_LABEL = SCAN_CONCURRENCY;

/**
 * 6 位代码归一化为完整符号（本地辅助）
 * @param code 6 位纯代码
 * @returns 完整符号（sh600519 形态）
 */
const toSymbol = (code: string): string => {
  if (!/^\d{6}$/.test(code)) {
    return code;
  }
  if (code.startsWith('6')) {
    return `sh${code}`;
  }
  if (code.startsWith('0') || code.startsWith('3')) {
    return `sz${code}`;
  }
  return `bj${code}`;
};

const dockPanel = useDockPanelStore();
const watchlistStore = useWatchlistStore();

/** 股票池来源 tab */
const POOL_SOURCE_TABS = [
  { label: '自选股', value: 'watchlist' },
  { label: '手选板块', value: 'board' },
  { label: '榜单 TopN', value: 'ranking' },
  { label: '涨停·强势池', value: 'zt_pool' },
  { label: '盘口异动池', value: 'stock_changes' },
] as const;

/** 榜单排序字段选项 */
const RANKING_FIELD_OPTIONS = [
  { label: '按成交额', value: 'amount' },
  { label: '按涨幅', value: 'changePercent' },
  { label: '按换手率', value: 'turnoverRate' },
] as const;

/** 板块类型选项 */
const BOARD_TYPE_OPTIONS = [
  { label: '行业板块', value: 'industry' },
  { label: '概念板块', value: 'concept' },
] as const;

/** 当前股票池来源 */
const poolSource = ref<string>('watchlist');

// ---------- 板块来源状态 ----------
const boardType = ref<string>('industry');
const boards = ref<{ code: string; name: string }[]>([]);
const selectedBoardCode = ref('');
const boardLimit = ref<number>(50);

/** 当前板块类型下的板块选项 */
const boardOptions = computed(() => boards.value);

// ---------- 榜单 / 股池状态 ----------
const rankingField = ref<string>('amount');
const topN = ref<number>(20);
const ztPoolType = ref<string>('strong');
const stockChangeType = ref<string>('rocket_launch');

// ---------- 信号多选 ----------
const selectedSignals = ref<SignalKey[]>(['ma_golden']);

/**
 * 切换信号模板选中态
 * @param key 信号 key
 */
const toggleSignal = (key: SignalKey): void => {
  const index = selectedSignals.value.indexOf(key);
  if (index >= 0) {
    selectedSignals.value.splice(index, 1);
  } else {
    selectedSignals.value = [...selectedSignals.value, key];
  }
};

// ---------- 股票池解析 ----------
/** 是否正在解析股票池 / 扫描 */
const isScanning = ref(false);
const progress = ref<AnalysisProgress>({ stage: '待开始', completed: 0, total: 0 });
const results = ref<ScanSignalResult[]>([]);
const notice = ref<string | null>(null);
const abortController = ref<AbortController | null>(null);

/** 已加入自选的符号集合（结果表「加自选」按钮状态） */
const addedSymbols = ref<Set<string>>(new Set());

/**
 * 解析自选股池（符号来自 store，名称批量回填）
 * @returns 股票池条目列表
 */
const resolveWatchlistPool = async (): Promise<ScannerPoolItem[]> => {
  const symbols = watchlistStore.allSymbols;
  if (symbols.length === 0) {
    return [];
  }
  const pool: ScannerPoolItem[] = symbols.map((symbol) => ({
    code: symbol.replace(/^(sh|sz|bj)/, ''),
    symbol,
    name: symbol,
  }));
  try {
    const { fetchFullQuotes } = await import('../../api/quotes.api');
    const quotes = await fetchFullQuotes(symbols);
    for (const item of pool) {
      const hit = quotes.find((quote) => quote.code === item.symbol);
      if (hit) {
        item.name = hit.name;
      }
    }
  } catch (error) {
    console.error('[signal-scanner] 回填自选名称失败', error);
  }
  return pool;
};

/**
 * 拉取板块列表（切换板块类型时）
 */
const loadBoards = async (): Promise<void> => {
  boards.value = [];
  selectedBoardCode.value = '';
  const list =
    boardType.value === 'industry' ? await fetchIndustryBoards() : await fetchConceptBoards();
  boards.value = list.map((item) => ({ code: item.code, name: item.name }));
};

// 切换来源 / 板块类型时按需拉列表
const onPoolSourceChange = (): void => {
  notice.value = null;
  if (poolSource.value === 'board' && boards.value.length === 0) {
    void loadBoards().catch((error) => console.error('[signal-scanner]', error));
  }
};
const onBoardTypeChange = (): void => {
  void loadBoards().catch((error) => console.error('[signal-scanner]', error));
};

/**
 * 解析板块股池（成分股截取前 N）
 * @returns 股票池条目列表
 */
const resolveBoardPool = async (): Promise<ScannerPoolItem[]> => {
  if (!selectedBoardCode.value) {
    return [];
  }
  const constituents =
    boardType.value === 'industry'
      ? await fetchIndustryConstituents(selectedBoardCode.value)
      : await fetchConceptConstituents(selectedBoardCode.value);
  return constituents.slice(0, boardLimit.value).map((item) => ({
    code: item.code,
    symbol: toSymbol(item.code),
    name: item.name,
  }));
};

/**
 * 解析榜单 TopN 股池（全市场快照按字段排序）
 * @returns 股票池条目列表
 */
const resolveRankingPool = async (): Promise<ScannerPoolItem[]> => {
  const quotes = await fetchAllMarketQuotes();
  const field = rankingField.value as 'amount' | 'changePercent' | 'turnoverRate';
  return [...quotes]
    .sort((a, b) => (b[field] ?? 0) - (a[field] ?? 0))
    .slice(0, topN.value)
    .map((quote) => ({
      code: quote.code.replace(/^(sh|sz|bj)/, ''),
      symbol: quote.code,
      name: quote.name,
    }));
};

/**
 * 解析涨停 / 强势股池
 * @returns 股票池条目列表
 */
const resolveZtPool = async (): Promise<ScannerPoolItem[]> => {
  const items = await sdk.marketEvent.ztPool(ztPoolType.value as never);
  return items.slice(0, topN.value).map((item) => ({
    code: item.code,
    symbol: toSymbol(item.code),
    name: item.name,
  }));
};

/**
 * 解析盘口异动池（按类型去重）
 * @returns 股票池条目列表
 */
const resolveStockChangePool = async (): Promise<ScannerPoolItem[]> => {
  const items = await sdk.marketEvent.stockChanges(stockChangeType.value as never);
  const deduped = new Map<string, ScannerPoolItem>();
  for (const item of items) {
    const symbol = toSymbol(item.code);
    if (!deduped.has(symbol)) {
      deduped.set(symbol, {
        code: item.code,
        symbol,
        name: item.name,
      });
    }
  }
  return [...deduped.values()].slice(0, topN.value);
};

/**
 * 按来源解析股票池
 * @returns 股票池条目列表
 */
const resolvePool = async (): Promise<ScannerPoolItem[]> => {
  if (poolSource.value === 'watchlist') {
    return resolveWatchlistPool();
  }
  if (poolSource.value === 'board') {
    return resolveBoardPool();
  }
  if (poolSource.value === 'zt_pool') {
    return resolveZtPool();
  }
  if (poolSource.value === 'stock_changes') {
    return resolveStockChangePool();
  }
  return resolveRankingPool();
};

/** 执行扫描（可取消） */
const onScan = async (): Promise<void> => {
  if (selectedSignals.value.length === 0) {
    notice.value = '请至少选择一个信号模板';
    return;
  }
  isScanning.value = true;
  results.value = [];
  notice.value = null;
  progress.value = { stage: '准备股票池', completed: 0, total: 0 };
  const controller = new AbortController();
  abortController.value = controller;
  try {
    const pool = await resolvePool();
    if (pool.length === 0) {
      notice.value = '股票池为空，请切换来源或补充选股范围';
      return;
    }
    const scanned = await scanSignalPool(pool, selectedSignals.value, {
      signal: controller.signal,
      onProgress: (value) => {
        progress.value = value;
      },
      onResult: (result) => {
        results.value = [...results.value, result];
      },
    });
    results.value = scanned;
    if (scanned.length === 0) {
      notice.value = '扫描完成，暂无标的命中所选信号';
    }
  } catch (error) {
    if ((error as Error)?.message !== '分析已取消') {
      console.error('[signal-scanner]', error);
      notice.value = '扫描失败，请稍后重试';
    }
  } finally {
    abortController.value = null;
    isScanning.value = false;
  }
};

/** 取消扫描 */
const onCancel = (): void => {
  abortController.value?.abort();
};

onBeforeUnmount(() => {
  // 离开页面即中止扫描（池可达上百个请求，不中止会在后台跑完）
  abortController.value?.abort();
});

/**
 * 结果行打开个股详情
 * @param row 结果行
 */
const openDetail = (row: ScanSignalResult): void => {
  dockPanel.openStock(row.symbol);
};

/**
 * 结果行加自选
 * @param row 结果行
 */
const addWatchlist = (row: ScanSignalResult): void => {
  watchlistStore.addStock({ symbol: toSymbol(row.code), name: row.name, addedAt: Date.now() });
  addedSymbols.value = new Set([...addedSymbols.value, row.symbol]);
};

/** 结果列配置 */
const resultColumns: TableColumn<ScanSignalResult>[] = [
  { key: 'name', label: '个股' },
  { key: 'matchedLabels', label: '命中信号' },
  { key: 'actions', label: '操作', align: 'right' },
];
</script>

<template>
  <div class="space-y-4">
    <!-- 股票池来源 -->
    <BaseCard title="股票池来源">
      <BaseTabs v-model="poolSource" :options="POOL_SOURCE_TABS" @update:model-value="onPoolSourceChange" />

      <!-- 板块来源子配置 -->
      <div v-if="poolSource === 'board'" class="mt-3 flex flex-wrap items-center gap-2">
        <BaseTabs v-model="boardType" :options="BOARD_TYPE_OPTIONS" @update:model-value="onBoardTypeChange" />
        <select
          v-model="selectedBoardCode"
          class="max-w-52 rounded-lg border border-flat-weak bg-surface px-2 py-1.5 text-xs text-text"
          aria-label="选择板块"
        >
          <option value="" disabled>选择板块</option>
          <option v-for="board in boardOptions" :key="board.code" :value="board.code">
            {{ board.name }}
          </option>
        </select>
        <label class="flex items-center gap-1.5 text-xs text-text-tertiary">
          成分数上限
          <select
            v-model.number="boardLimit"
            class="rounded-lg bg-flat-weak px-2 py-1 text-xs text-text outline-none"
          >
            <option v-for="n in SCAN_BOARD_LIMIT_OPTIONS" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <BaseSkeleton v-if="boardOptions.length === 0" class="h-6 w-40" />
      </div>
      <p class="mt-2 text-xs text-text-tertiary">
        {{
          poolSource === 'watchlist'
            ? '使用当前全部分组自选的去重股票池'
            : poolSource === 'board'
              ? '所选板块成分股按配置数量截取'
              : poolSource === 'ranking'
                ? '全市场快照按所选字段降序取 TopN'
                : poolSource === 'zt_pool'
                  ? '涨停 / 强势股池按 TopN 截取'
                  : '盘口异动按类型去重后取 TopN'
        }}
      </p>

      <!-- 榜单 / 股池通用子配置 -->
      <div
        v-if="poolSource === 'ranking' || poolSource === 'zt_pool' || poolSource === 'stock_changes'"
        class="mt-3 flex flex-wrap items-center gap-2"
      >
        <BaseTabs
          v-if="poolSource === 'ranking'"
          v-model="rankingField"
          :options="RANKING_FIELD_OPTIONS"
        />
        <BaseTabs
          v-if="poolSource === 'zt_pool'"
          v-model="ztPoolType"
          :options="SCAN_ZT_POOL_OPTIONS"
        />
        <BaseTabs
          v-if="poolSource === 'stock_changes'"
          v-model="stockChangeType"
          :options="SCAN_STOCK_CHANGE_OPTIONS"
        />
        <label class="flex items-center gap-1.5 text-xs text-text-tertiary">
          TopN
          <select
            v-model.number="topN"
            class="rounded-lg bg-flat-weak px-2 py-1 text-xs text-text outline-none"
          >
            <option v-for="n in SCAN_TOP_N_OPTIONS" :key="n" :value="n">Top{{ n }}</option>
          </select>
        </label>
      </div>
    </BaseCard>

    <!-- 信号模板 -->
    <BaseCard title="信号模板（可多选）">
      <div class="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        <button
          v-for="template in SIGNAL_TEMPLATES"
          :key="template.key"
          type="button"
          class="pressable rounded-card border p-3 text-left active:scale-[0.98]"
          :class="
            selectedSignals.includes(template.key)
              ? 'border-primary bg-primary-weak'
              : 'border-flat-weak bg-flat-weak/40 hover:border-primary/40'
          "
          :aria-pressed="selectedSignals.includes(template.key)"
          @click="toggleSignal(template.key)"
        >
          <p
            class="text-sm font-medium"
            :class="selectedSignals.includes(template.key) ? 'text-primary' : 'text-text'"
          >
            {{ template.label }}
          </p>
          <p class="mt-0.5 text-xs text-text-tertiary">{{ template.desc }}</p>
        </button>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <BaseButton :disabled="isScanning" @click="onScan">
          {{ isScanning ? '扫描中...' : '开始扫描' }}
        </BaseButton>
        <BaseButton v-if="isScanning" variant="ghost" @click="onCancel">取消</BaseButton>
        <span v-if="isScanning" class="text-xs text-text-tertiary">
          {{ progress.stage }}（{{ progress.completed }}/{{ progress.total }}）· 并发 {{ CONCURRENCY_LABEL }}
        </span>
        <span v-else-if="results.length > 0" class="text-xs text-text-tertiary">
          命中 {{ results.length }} 只
        </span>
      </div>
      <p v-if="notice" class="mt-2 text-xs text-down">{{ notice }}</p>
    </BaseCard>

    <!-- 扫描结果 -->
    <BaseCard :title="`扫描结果`">
      <div v-if="isScanning && results.length === 0"><BaseSkeleton /></div>
      <BaseTable
        v-else-if="results.length > 0"
        :columns="resultColumns"
        :rows="results"
        :row-key="(row) => row.symbol"
        row-clickable
        scroll-class="table-scroll-sm"
        @row-click="openDetail"
      >
        <template #name="{ row }">
          <span class="font-medium text-text">{{ row.name }}</span>
          <span class="ml-1 text-xs text-text-tertiary">{{ row.code }}</span>
        </template>
        <template #matchedLabels="{ row }">
          <BaseTag v-for="label in row.matchedLabels" :key="label" tone="primary" class="mr-1">
            {{ label }}
          </BaseTag>
        </template>
        <template #actions="{ row }">
          <button
            type="button"
            class="pressable rounded bg-primary-weak px-2 py-0.5 text-xs text-primary active:scale-90"
            :disabled="addedSymbols.has(row.symbol)"
            @click.stop="addWatchlist(row)"
          >
            {{ addedSymbols.has(row.symbol) ? '已加自选' : '加自选' }}
          </button>
        </template>
      </BaseTable>
      <BaseEmpty v-else text="选择股票池和信号模板后开始扫描" />
    </BaseCard>
  </div>
</template>
