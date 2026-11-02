<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import BaseChart from '../../charts/BaseChart.vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseTable from '../../ui/BaseTable.vue';
import BaseTabs from '../../ui/BaseTabs.vue';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_GAP_COLOR,
  CHART_LABEL_ON_TREND_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../../common/constants/chart.constants.ts';
import { DOWN_COLOR, UP_COLOR } from '../../../../common/constants/stock-colors.constants.ts';
import { formatPercent } from '../../../../common/utils/format-percent';
import { getTrendColorCss } from '../../../../common/utils/trend-colors';
import { useSettingsStore } from '../../../../common/stores/settings';
import { useTzzbAnalysisStore } from '../../../../common/stores/tzzb-analysis';
import type { TableColumn } from '../../../../common/types/table.types.ts';
import type {
  TzzbClearedPosition,
  TzzbHoldingReturn,
} from '../../../../common/types/tzzb.types.ts';
import type { ContributionStockRow } from '../../../../common/utils/compute-trade-contribution';

/**
 * 投资账本 · 品种总盈亏（双视角：总盈亏排行/热力 + 操作贡献散点/明细）
 *
 * - 总盈亏视角（存量原样）：个股 = 清仓记录按代码聚合（totalProfit 求和，率取绝对值
 *   最大一条）；个基 = queryFundHoldingReturns（allProfit / allRate 累计口径）；
 *   全部 = 两者合并；Top 展示档位：Top5 / Top10 = 盈利前 N + 亏损前 N，全部 = 全量降序；
 *   视图：排行（进度条列表）/ 热力（treemap，面积 = |累计盈亏|，色阶 = 收益率）；
 * - 操作贡献视角（操作复盘阶段 3 新增，方案 §4.3，纯消费 tzzb-analysis store）：
 *   实际盈亏 vs 买入持有反事实的逐票拆解——摘要条 + 死拿散点（y=x 上方 = 操作增值）
 *   + 逐票贡献表；数据由「生成分析」触发（父级组装入参调 store）；
 * - 点击行 / 格子打开个股或基金详情
 */
const props = defineProps<{
  /** 清仓记录（聚合个股用） */
  cleared: TzzbClearedPosition[];
  /** 个基累计收益 */
  fundReturns: TzzbHoldingReturn[];
}>();

const emit = defineEmits<{
  /** 单击行 / 格子打开个股侧栏（2026-11-02 起统一口径；基金行父级跳基金详情） */
  open: [code: string];
  /** 双击个股行：跳个股详情整页 */
  openPage: [code: string];
  /** 点击「生成分析」（操作贡献视角；父级组装入参调 store.generate） */
  generate: [];
}>();

const settingsStore = useSettingsStore();
const analysisStore = useTzzbAnalysisStore();

const KIND_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '个股', value: 'stock' },
  { label: '个基', value: 'fund' },
];

/** Top 档位（'0' = 全部；BaseTabs value 为字符串口径） */
const TOP_OPTIONS = [
  { label: 'Top5', value: '5' },
  { label: 'Top10', value: '10' },
  { label: '全部', value: '0' },
];

/** 视图模式 */
const VIEW_OPTIONS = [
  { label: '排行', value: 'rank' },
  { label: '热力', value: 'heat' },
];

/** 当前筛选 */
const kind = ref<string>('all');
/** 当前 Top 档位 */
const topN = ref<string>('5');
/** 当前视图 */
const viewMode = ref<string>('rank');

/** 排行行模型 */
interface RankRow {
  code: string;
  name: string;
  type: 'stock' | 'fund';
  profit: number;
  rate: number;
}

/** 个股聚合（按代码求和；率取绝对值最大一条近似口径） */
const stockRows = computed<RankRow[]>(() => {
  const byCode = new Map<string, RankRow>();
  for (const row of props.cleared) {
    const hit = byCode.get(row.code);
    if (hit) {
      hit.profit += row.profit;
      if (Math.abs(row.rate) > Math.abs(hit.rate)) hit.rate = row.rate;
    } else {
      byCode.set(row.code, {
        code: row.code,
        name: row.name,
        type: 'stock',
        profit: row.profit,
        rate: row.rate,
      });
    }
  }
  return [...byCode.values()];
});

/** 个基行 */
const fundRows = computed<RankRow[]>(() =>
  props.fundReturns.map((r) => ({ ...r, type: 'fund' as const })),
);

/** 全量排行（按累计盈亏降序） */
const allRows = computed<RankRow[]>(() => {
  const base =
    kind.value === 'stock'
      ? stockRows.value
      : kind.value === 'fund'
        ? fundRows.value
        : [...stockRows.value, ...fundRows.value];
  return base.sort((a, b) => b.profit - a.profit);
});

/**
 * 展示行：Top 档位 = 盈利前 N（降序）+ 亏损前 N（最差在前）；全部 = 全量降序
 */
const displayRows = computed<RankRow[]>(() => {
  const n = Number(topN.value);
  if (n === 0) return allRows.value;
  const gainers = allRows.value.filter((r) => r.profit > 0).slice(0, n);
  const losers = allRows.value
    .filter((r) => r.profit < 0)
    .slice(-n)
    .reverse();
  return [...gainers, ...losers];
});

/** 最大绝对盈亏（进度条基准） */
const maxAbs = computed(() => Math.max(1, ...displayRows.value.map((r) => Math.abs(r.profit))));

/**
 * 千分位带符号金额
 * @param v 数值
 * @returns 正值补 + 号的千分位文案
 */
const signYuan = (v: number): string =>
  `${v > 0 ? '+' : ''}${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * 盈亏文本色
 * @param v 数值
 * @returns 涨跌语义色类
 */
const plClass = (v: number): string => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-flat');

/**
 * 进度条色
 * @param v 数值
 * @returns 正 = 涨色 / 负 = 跌色
 */
const fillClass = (v: number): string => (v >= 0 ? 'bg-up' : 'bg-down');

/**
 * 单击行（emit 给父级统一落点，与建清仓记录行为一致）
 * @param row 排行行
 */
const openDetail = (row: RankRow): void => {
  emit('open', row.code);
};

/**
 * 双击行：个股跳详情整页；基金无个股详情页，回落为与单击一致
 * @param row 排行行
 */
const openDetailPage = (row: RankRow): void => {
  if (row.type === 'fund') {
    openDetail(row);
    return;
  }
  emit('openPage', row.code);
};

/* ---------------- 操作贡献视角（阶段 3 新增，方案 §4.3） ---------------- */

/** 顶级视角（总盈亏 = 存量原样；操作贡献 = 阶段 3 新增） */
const PERSPECTIVE_OPTIONS = [
  { label: '总盈亏', value: 'pnl' },
  { label: '操作贡献', value: 'contribution' },
];
const perspective = ref<string>('pnl');

/** 贡献散点配置（x = 反事实 / y = 实际；灰虚线 = 死拿线 y=x，上方 = 操作增值） */
const contribOption = computed<EChartsCoreOption | null>(() => {
  const rows = analysisStore.contribution?.rows ?? [];
  if (rows.length === 0) return null;
  const values = rows.flatMap((r) => [r.counterfactual, r.actual]);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const pad = (hi - lo) * 0.08 || 1;
  const a = lo - pad;
  const b = hi + pad;
  void settingsStore.trendTheme;
  return {
    grid: { left: 52, right: 16, top: 12, bottom: 30 },
    tooltip: {
      formatter: (params: unknown) => {
        const d = (params as { data?: { name?: string; actual?: number; counterfactual?: number; contribution?: number } }).data;
        if (!d?.name) return '';
        return `<b>${d.name}</b><br/>实际 ${signYuan(d.actual ?? 0)}<br/>反事实 ${signYuan(d.counterfactual ?? 0)}<br/>操作贡献 ${signYuan(d.contribution ?? 0)}`;
      },
    },
    xAxis: {
      type: 'value',
      min: a,
      max: b,
      name: '反事实（死拿不动）',
      nameTextStyle: { color: CHART_TEXT_COLOR, fontSize: 9 },
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 9, formatter: (v: number) => v.toFixed(0) },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    yAxis: {
      type: 'value',
      min: a,
      max: b,
      name: '实际',
      nameTextStyle: { color: CHART_TEXT_COLOR, fontSize: 9 },
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 9, formatter: (v: number) => v.toFixed(0) },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: [
      {
        // 死拿参考线 y=x（两端点直线）
        type: 'line',
        data: [
          [a, a],
          [b, b],
        ],
        symbol: 'none',
        lineStyle: { color: '#94a3b8', type: 'dashed', width: 1 },
        silent: true,
        tooltip: { show: false },
        z: 1,
      },
      {
        type: 'scatter',
        symbolSize: 11,
        z: 2,
        data: rows.map((r) => ({
          value: [r.counterfactual, r.actual],
          name: r.name,
          actual: r.actual,
          counterfactual: r.counterfactual,
          contribution: r.contribution,
          code: r.code,
          itemStyle: { color: r.contribution > 0 ? UP_COLOR : r.contribution < 0 ? DOWN_COLOR : '#94a3b8', opacity: 0.85 },
        })),
      },
    ],
  };
});

/**
 * 贡献散点点击 → 打开个股侧栏（数据内成员校验，防残留图元错位）
 * @param params ECharts click 事件参数
 */
const onContribClick = (params: unknown): void => {
  const code = (params as { data?: { code?: string } }).data?.code;
  if (code) emit('open', code);
};

/** 贡献视角可见行（贡献口径仅覆盖个股；kind = 个基时走空态） */
const contribRows = computed<ContributionStockRow[]>(() => {
  if (kind.value === 'fund') return [];
  return analysisStore.contribution?.rows ?? [];
});

/** 贡献逐票表列 */
const contribColumns: TableColumn<ContributionStockRow>[] = [
  { key: 'name', label: '证券' },
  { key: 'buyCount', label: '买入笔数', align: 'right' },
  { key: 'buyAmount', label: '买入金额', align: 'right' },
  { key: 'actual', label: '实际盈亏', align: 'right' },
  { key: 'counterfactual', label: '反事实', align: 'right' },
  { key: 'contribution', label: '操作贡献', align: 'right' },
  { key: 'rounds', label: '回合', align: 'right' },
];

/* ---------------- 热力视图（treemap，同市场总览板块热力口径） ---------------- */

const heatOption = computed<EChartsCoreOption>(() => {
  // 依赖 trendTheme：切换涨跌配色后本 computed 重新求值
  void settingsStore.trendTheme;
  return {
    tooltip: {
      formatter: (params: unknown) => {
        const data = (params as { data: { name: string; profit: number; rate: number } }).data;
        return `${data.name}<br/>累计 ${signYuan(data.profit)}（${formatPercent(data.rate)}）`;
      },
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        animation: false,
        breadcrumb: { show: false },
        itemStyle: { borderColor: CHART_GAP_COLOR, borderWidth: 2, gapWidth: 2 },
        label: {
          show: true,
          color: CHART_LABEL_ON_TREND_COLOR,
          fontSize: 11,
          formatter: (params: unknown) => {
            const data = (params as { data: { name: string; rate: number } }).data;
            return `${data.name}\n${formatPercent(data.rate)}`;
          },
        },
        data: displayRows.value.map((r) => ({
          name: r.name,
          // 面积权重 = |累计盈亏|；为 0 时给最小权重避免格子消失
          value: Math.max(1, Math.abs(r.profit)),
          profit: r.profit,
          rate: r.rate,
          code: r.code,
          itemStyle: { color: getTrendColorCss(r.rate) },
        })),
      },
    ],
  };
});

/**
 * 热力格子点击 → 打开详情（数据内成员校验，防残留图元错位）
 * @param params ECharts click 事件参数
 */
const onHeatClick = (params: unknown): void => {
  const data = (params as { data?: { code?: string } }).data;
  const row = displayRows.value.find((r) => r.code === data?.code);
  if (row) openDetail(row);
};
</script>

<template>
  <div class="flex flex-col xl:min-h-0 xl:flex-1">
    <!-- 筛选行：视角 × 品种 × Top 档位 × 视图（Top / 视图仅总盈亏视角） -->
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <BaseTabs v-model="perspective" :options="PERSPECTIVE_OPTIONS" class="self-start" />
      <BaseTabs v-model="kind" :options="KIND_OPTIONS" class="self-start" />
      <div class="flex-1" />
      <template v-if="perspective === 'pnl'">
        <BaseTabs v-model="topN" :options="TOP_OPTIONS" class="self-start" />
        <BaseTabs v-model="viewMode" :options="VIEW_OPTIONS" class="self-start" />
      </template>
    </div>

    <!-- 操作贡献视角（阶段 3 新增：摘要条 + 死拿散点 + 逐票贡献表） -->
    <template v-if="perspective === 'contribution'">
      <div v-if="analysisStore.status === 'idle'" class="flex flex-col items-center gap-1">
        <BaseEmpty text="实际盈亏 vs 买入持有反事实——官方只答选股水平，这里答择时水平" />
        <button
          type="button"
          class="pressable -mt-4 rounded-lg bg-primary px-4 py-1.5 text-sm text-white hover:opacity-90"
          @click="emit('generate')"
        >
          生成分析
        </button>
      </div>
      <div v-else-if="analysisStore.status === 'running'" class="flex flex-col justify-center gap-2 py-10">
        <p class="text-sm text-text-secondary">正在错峰拉取个股前复权日 K…</p>
        <div class="h-2 overflow-hidden rounded-full bg-flat-weak">
          <div
            class="h-full rounded-full bg-primary transition-all"
            :style="{ width: `${analysisStore.progressTotal === 0 ? 0 : (analysisStore.progressDone / analysisStore.progressTotal) * 100}%` }"
          />
        </div>
        <p class="font-mono text-xs text-text-tertiary">
          {{ analysisStore.progressDone }} / {{ analysisStore.progressTotal }} 只已完成
        </p>
      </div>
      <div v-else-if="analysisStore.status === 'error'" class="flex flex-col items-center gap-2 py-10">
        <p class="text-sm text-down">生成失败：{{ analysisStore.errorMessage || '未知错误' }}</p>
        <button
          type="button"
          class="pressable rounded-lg bg-primary px-4 py-1.5 text-sm text-white hover:opacity-90"
          @click="emit('generate')"
        >
          重试
        </button>
      </div>
      <BaseEmpty v-else-if="contribRows.length === 0" text="操作贡献视角仅覆盖个股：窗口内无个股流水 / 清仓记录" />
      <div v-else class="flex flex-col gap-3">
        <!-- 摘要条 -->
        <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
            <p class="text-xs text-text-tertiary">实际盈亏</p>
            <p class="mt-0.5 font-mono text-base font-semibold tabular-nums" :class="plClass(analysisStore.contribution?.actualTotal ?? 0)">
              {{ signYuan(analysisStore.contribution?.actualTotal ?? 0) }}
            </p>
          </div>
          <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
            <p class="text-xs text-text-tertiary">反事实（买入持有）</p>
            <p class="mt-0.5 font-mono text-base font-semibold tabular-nums" :class="plClass(analysisStore.contribution?.counterfactualTotal ?? 0)">
              {{ signYuan(analysisStore.contribution?.counterfactualTotal ?? 0) }}
            </p>
          </div>
          <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
            <p class="text-xs text-text-tertiary">操作贡献（你的操作值多少）</p>
            <p class="mt-0.5 font-mono text-base font-semibold tabular-nums" :class="plClass(analysisStore.contribution?.contributionTotal ?? 0)">
              {{ signYuan(analysisStore.contribution?.contributionTotal ?? 0) }}
            </p>
          </div>
          <div class="rounded-lg bg-flat-weak/60 px-3 py-2">
            <p class="text-xs text-text-tertiary">计分覆盖</p>
            <p class="mt-0.5 font-mono text-base font-semibold tabular-nums text-text">
              {{ analysisStore.contribution?.rows.length ?? 0 }} 票
            </p>
            <p class="mt-0.5 text-xs text-text-tertiary">
              未计分买入 {{ analysisStore.contribution?.unscoredBuys ?? 0 }} 笔（超 K 线覆盖 / 停牌）
            </p>
          </div>
        </div>
        <!-- 死拿散点 -->
        <div v-if="contribOption" class="h-56">
          <BaseChart :options="contribOption" not-merge @chart-click="onContribClick" />
        </div>
        <!-- 逐票贡献表 -->
        <BaseTable
          :columns="contribColumns"
          :rows="contribRows"
          :row-key="(r) => r.code"
          :min-width="'720px'"
          scroll-class="table-scroll-sm"
          row-clickable
          footer-text="单击开侧栏 / 双击进详情 · 反事实为 qfq 口径买入持有推演"
          @row-click="(r) => emit('open', r.code)"
          @row-dblclick="(r) => emit('openPage', r.code)"
        >
          <template #name="{ row }">
            <span class="font-medium text-text">{{ row.name }}</span>
            <span class="ml-1 font-mono text-xs text-text-tertiary">{{ row.code }}</span>
          </template>
          <template #buyAmount="{ row }">
            <span class="font-mono tabular-nums">{{ row.buyAmount.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) }}</span>
          </template>
          <template #actual="{ row }">
            <span class="font-mono font-medium tabular-nums" :class="plClass(row.actual)">{{ signYuan(row.actual) }}</span>
          </template>
          <template #counterfactual="{ row }">
            <span class="font-mono tabular-nums" :class="plClass(row.counterfactual)">{{ signYuan(row.counterfactual) }}</span>
          </template>
          <template #contribution="{ row }">
            <span class="font-mono font-semibold tabular-nums" :class="plClass(row.contribution)">{{ signYuan(row.contribution) }}</span>
          </template>
        </BaseTable>
        <p class="text-xs text-text-tertiary">
          口径：实际 = 清仓回合盈亏合计（官方含费，持有中为已实现部分）；反事实 = 每笔买入按买入日 qfq 收盘持有到末日；浮动盈亏未计入
        </p>
      </div>
    </template>

    <!-- 总盈亏视角（存量原样） -->
    <template v-else>
      <BaseEmpty v-if="displayRows.length === 0" text="暂无品种盈亏数据" />

      <!-- 排行视图（高度随左侧卡片，超出滚动） -->
      <div
        v-else-if="viewMode === 'rank'"
        class="min-h-0 flex-1 overflow-y-auto max-h-[28rem] pr-0.5 xl:max-h-none"
      >
        <button
          v-for="(row, i) in displayRows"
          :key="`${row.type}-${row.code}`"
          type="button"
          class="pressable flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-flat-weak/60"
          :title="`${row.type === 'fund' ? '基金' : '个股'} · 单击开侧栏 / 双击进详情`"
          @click="openDetail(row)"
          @dblclick="openDetailPage(row)"
        >
          <span class="w-5 shrink-0 text-center font-mono text-xs text-text-tertiary">{{ i + 1 }}</span>
          <span class="w-28 shrink-0 truncate text-[13px] font-medium text-text">
            {{ row.name }}
            <span class="ml-0.5 font-mono text-[10px] font-normal text-text-tertiary">
              {{ row.code }}{{ row.type === 'fund' ? ' · 基金' : '' }}
            </span>
          </span>
          <span class="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-flat-weak">
            <span
              class="block h-full rounded-full"
              :class="fillClass(row.profit)"
              :style="{ width: `${Math.max(2, (Math.abs(row.profit) / maxAbs) * 100)}%` }"
            />
          </span>
          <span class="w-20 shrink-0 text-right font-mono text-[13px] font-medium tabular-nums" :class="plClass(row.profit)">
            {{ signYuan(row.profit) }}
          </span>
          <span class="w-14 shrink-0 text-right font-mono text-xs tabular-nums" :class="plClass(row.rate)">
            {{ (row.rate * 100).toFixed(2) }}%
          </span>
        </button>
      </div>

      <!-- 热力视图（treemap：面积 = |累计盈亏|，色阶 = 收益率） -->
      <div v-else class="h-80 min-h-0 xl:h-auto xl:flex-1">
        <BaseChart :options="heatOption" not-merge :style="{ height: '100%' }" @chart-click="onHeatClick" />
      </div>
    </template>
  </div>
</template>
