<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseTable from '../ui/BaseTable.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import NoticeBar from '../ui/NoticeBar.vue';
import HuijinFlowBarChart from '../charts/HuijinFlowBarChart.vue';
import {
  HUIJIN_ESTIMATE_FLAT_TEXT,
  HUIJIN_ETF_FLOW_NOTICE,
  HUIJIN_ETF_FLOW_TIP,
  HUIJIN_FLOW_RANGE_DEFAULT,
  HUIJIN_FLOW_RANGE_OPTIONS,
} from '../../../common/constants/huijin-etf-flow.constants.ts';
import { WIDE_BASE_ETFS } from '../../../common/constants/wide-base-etf.constants.ts';
import { HUIJIN_BASELINE_SOURCE } from '../../../common/types/huijin-etf-flow.types.ts';
import type {
  HuijinBaselineSource,
  HuijinEtfBaseline,
  HuijinFlowEstimateRow,
  HuijinShareSnapshot,
} from '../../../common/types/huijin-etf-flow.types.ts';
import { ensureHuijinFlowSnapshots } from '../../../common/api/huijin-flow-history.api';
import { getHuijinBaselines } from '../../../common/api/huijin-baseline.api';
import {
  buildHuijinDailySeries,
  buildHuijinEstimateRows,
  buildHuijinFlowSummary,
} from '../../../common/utils/estimate-huijin-flow';
import type { TableColumn } from '../../../common/types/table.types.ts';

/**
 * 资金动向 · 每日汇金持仓变化（估算）（2026-11-06 王总指定新增，板块资金流入模块下方）
 *
 * 自管数据组件：进页触发一次（当日东财份额快照 + 首次 SSE 昨日基准 + cyrjg 占比基准），
 * 不轮询。估算口径与局限见 NoticeBar / 标题问号 tooltip（huijin-etf-flow.constants.ts 单源）。
 * 「刷新」按钮 force 重拉当日快照与基准（无视 5 分钟节流与基准缓存 TTL）。
 * 当日明细表默认收起（2026-11-06 王总指定），展开开关在周期切换按钮左边。
 */

/** 图表高度（px，与同页资金图表行一致） */
const CHART_HEIGHT_PX = 200;

/** 当日明细表是否展开（2026-11-06 王总指定：默认收起，开关在周期切换按钮左边） */
const isDetailExpanded = ref(false);

/** 占比基准来源展示文案 */
const BASELINE_SOURCE_LABELS: Record<HuijinBaselineSource, string> = {
  [HUIJIN_BASELINE_SOURCE.OVERRIDE]: '汇金披露',
  [HUIJIN_BASELINE_SOURCE.INSTITUTIONAL]: '机构比例',
};

/** 代码 -> 名称映射（估算纯函数入参） */
const NAME_BY_CODE = new Map(
  WIDE_BASE_ETFS.map((item) => [item.symbol.replace(/^(sh|sz)/i, ''), item.name]),
);

/** 宽基清单代码（基准批量拉取入参） */
const CODES = WIDE_BASE_ETFS.map((item) => item.symbol.replace(/^(sh|sz)/i, ''));

/** 份额历史快照（日期升序，本地累积） */
const snapshots = ref<HuijinShareSnapshot[]>([]);

/** 占比基准（code 索引） */
const baselines = ref<Record<string, HuijinEtfBaseline>>({});

/** 首载中 */
const isLoading = ref(true);

/** 刷新中（按钮态） */
const isRefreshing = ref(false);

/** 首载失败（快照拉取失败 = 无数据可渲染） */
const isLoadError = ref(false);

/** 图表周期（BaseTabs value，交易日数字字符串；'0' = 全部） */
const range = ref<string>(HUIJIN_FLOW_RANGE_DEFAULT);

/** 当前周期的数值形态（0 = 全部） */
const rangeDays = computed(() => Number(range.value));

/** 最新快照日期 */
const latestDate = computed(() => snapshots.value.at(-1)?.date ?? '');

/** 当日估算明细行 */
const rows = computed<HuijinFlowEstimateRow[]>(() => {
  const latest = snapshots.value.at(-1);
  if (!latest) {
    return [];
  }
  return buildHuijinEstimateRows(snapshots.value, latest.date, NAME_BY_CODE, baselines.value);
});

/** 当日汇总（合计只含参与估算行） */
const summary = computed(() => buildHuijinFlowSummary(rows.value));

/** 历史曲线序列（按周期档位截尾；参与估算 ETF 少于 2 天时为空） */
const seriesDays = computed(() => {
  const all = buildHuijinDailySeries(snapshots.value, NAME_BY_CODE, baselines.value);
  return rangeDays.value > 0 ? all.slice(-rangeDays.value) : all;
});

/** 参与估算行数是否足以展示图表（不足两天只有当日一点，无趋势可看） */
const hasChart = computed(() => seriesDays.value.length > 0);

/** 明细表列配置 */
const columns: TableColumn<HuijinFlowEstimateRow>[] = [
  { key: 'name', label: 'ETF 名称' },
  { key: 'sharesDeltaYi', label: '当日总份额变化（亿份）', align: 'right', sortable: true, sortValue: (row) => row.sharesDeltaYi },
  { key: 'estSharesDeltaYi', label: '估算汇金增减（亿份）', align: 'right', sortable: true, sortValue: (row) => row.estSharesDeltaYi },
  { key: 'estAmountYi', label: '估算资金变动（亿元）', align: 'right', sortable: true, sortValue: (row) => row.estAmountYi },
  { key: 'ratioPct', label: '占比基准', align: 'right', sortable: true, sortValue: (row) => row.ratioPct },
  { key: 'reportDate', label: '基准报告期', align: 'right' },
];

/**
 * 涨跌色 class（正流入红 / 负流出绿，跟随 data-trend）
 * @param value 数值
 * @returns class 名（0 或 null 为中性）
 */
const trendClass = (value: number | null): string => {
  if (value === null || value === 0) return 'text-flat';
  return value > 0 ? 'text-up' : 'text-down';
};

/**
 * 亿份数值格式化（带符号，两位小数）
 * @param value 数值或 null
 * @returns 展示文本
 */
const formatShares = (value: number | null): string => {
  if (value === null) return HUIJIN_ESTIMATE_FLAT_TEXT;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
};

/**
 * 亿元数值格式化（带符号，两位小数）
 * @param value 数值或 null
 * @returns 展示文本
 */
const formatAmount = (value: number | null): string => {
  if (value === null) return HUIJIN_ESTIMATE_FLAT_TEXT;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
};

/**
 * 加载快照 + 基准（快照失败置错误态；基准单只失败不阻塞整体）
 * @param force 是否强制回源（刷新按钮）
 */
const loadAll = async (force = false): Promise<void> => {
  try {
    const fetched = await ensureHuijinFlowSnapshots({ force });
    snapshots.value = fetched;
    baselines.value = await getHuijinBaselines(CODES, force);
    isLoadError.value = fetched.length === 0;
  } catch (error) {
    console.error('[huijin-flow] 快照取数失败', error);
    isLoadError.value = snapshots.value.length === 0;
  } finally {
    isLoading.value = false;
  }
};

/** 刷新按钮：force 重拉当日快照与基准 */
const refresh = (): void => {
  isRefreshing.value = true;
  void loadAll(true).finally(() => {
    isRefreshing.value = false;
  });
};

onMounted(() => {
  void loadAll();
});
</script>

<template>
  <BaseCard title="每日汇金持仓变化（估算）" :tip="HUIJIN_ETF_FLOW_TIP">
    <template #extra>
      <button
        type="button"
        class="pressable flex items-center rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:bg-flat-weak hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="isRefreshing"
        @click="refresh"
      >
        <MenuIcon name="refresh" :size="13" class="mr-1" :class="isRefreshing ? 'animate-spin' : ''" />
        {{ isRefreshing ? '刷新中…' : '刷新' }}
      </button>
    </template>

    <div class="flex flex-col gap-3">
      <NoticeBar :text="HUIJIN_ETF_FLOW_NOTICE" tone="warn" class="shrink-0" />

      <BaseSkeleton v-if="isLoading" class="h-[280px]" />
      <BaseEmpty
        v-else-if="isLoadError"
        text="份额快照加载失败，请稍后点击「刷新」重试"
      />
      <template v-else>
        <!-- 汇总行：最新快照日期 + 当日估算合计（涨跌色） -->
        <div class="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span class="text-sm text-text-secondary">{{ latestDate }}</span>
          <span class="text-sm text-text-tertiary">
            估算汇金当日净变动：
            <span class="text-base font-semibold" :class="trendClass(summary.estAmountYi)">
              {{ formatAmount(summary.estAmountYi) }} 亿元
            </span>
          </span>
          <span class="text-xs text-text-tertiary">
            参与 {{ summary.estimatedCount }}/{{ summary.totalCount }} 只
          </span>
        </div>

        <!-- 历史柱状图 + 周期切换 -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-end gap-2">
            <!-- 当日明细展开/收起（默认收起，2026-11-06 王总指定） -->
            <button
              type="button"
              class="pressable flex items-center rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:bg-flat-weak hover:text-text"
              :aria-expanded="isDetailExpanded"
              aria-label="当日明细"
              @click="isDetailExpanded = !isDetailExpanded"
            >
              <MenuIcon
                name="chevronDown"
                :size="13"
                class="mr-0.5 transition-transform"
                :class="isDetailExpanded ? 'rotate-180' : ''"
              />
              当日明细
            </button>
            <BaseTabs v-model="range" :options="HUIJIN_FLOW_RANGE_OPTIONS" size="sm" />
          </div>
          <BaseEmpty v-if="!hasChart" text="历史曲线自首次使用起累积，暂无足够数据" />
          <HuijinFlowBarChart v-else :days="seriesDays" :height="CHART_HEIGHT_PX" />
        </div>

        <!-- 当日明细：默认收起，展开开关在周期切换按钮左边（2026-11-06 王总指定） -->
        <BaseTable
          v-if="isDetailExpanded"
          :columns="columns"
          :rows="rows"
          :row-key="(row) => row.code"
          scroll-class="table-scroll-sm"
          min-width="760px"
        >
          <template #name="{ row }">
            <span class="whitespace-nowrap">{{ row.name }}</span>
          </template>
          <template #sharesDeltaYi="{ row }">
            <span class="whitespace-nowrap" :class="trendClass(row.sharesDeltaYi)">
              {{ formatShares(row.sharesDeltaYi) }}
            </span>
          </template>
          <template #estSharesDeltaYi="{ row }">
            <span class="whitespace-nowrap" :class="trendClass(row.estSharesDeltaYi)">
              {{ formatShares(row.estSharesDeltaYi) }}
            </span>
          </template>
          <template #estAmountYi="{ row }">
            <span class="whitespace-nowrap font-medium" :class="trendClass(row.estAmountYi)">
              {{ formatAmount(row.estAmountYi) }}
            </span>
          </template>
          <template #ratioPct="{ row }">
            <span v-if="row.ratioPct !== null" class="whitespace-nowrap text-text-secondary">
              {{ row.ratioPct.toFixed(2) }}%
              <span class="ml-1 text-[10px] text-text-tertiary">
                {{ row.ratioSource ? BASELINE_SOURCE_LABELS[row.ratioSource] : '' }}
              </span>
            </span>
            <span v-else class="text-text-tertiary">—</span>
          </template>
          <template #reportDate="{ row }">
            <span class="whitespace-nowrap text-text-tertiary">
              {{ row.reportDate || '—' }}
            </span>
          </template>
        </BaseTable>
      </template>
    </div>
  </BaseCard>
</template>
