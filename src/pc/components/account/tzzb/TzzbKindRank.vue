<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import BaseChart from '../../charts/BaseChart.vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseTabs from '../../ui/BaseTabs.vue';
import {
  CHART_GAP_COLOR,
  CHART_LABEL_ON_TREND_COLOR,
} from '../../../../common/constants/chart.constants.ts';
import { formatPercent } from '../../../../common/utils/format-percent';
import { getTrendColorCss } from '../../../../common/utils/trend-colors';
import { useSettingsStore } from '../../../../common/stores/settings';
import type {
  TzzbClearedPosition,
  TzzbHoldingReturn,
} from '../../../../common/types/tzzb.types.ts';

/**
 * 投资账本 · 品种总盈亏（排行 / 热力双视图）
 *
 * - 口径：个股 = 清仓记录按代码聚合（totalProfit 求和，率取绝对值最大一条）；
 *   个基 = queryFundHoldingReturns（allProfit / allRate 累计口径）；全部 = 两者合并；
 * - Top 展示档位：Top5 / Top10 = 盈利前 N + 亏损前 N（各按盈亏排序），全部 = 全量降序；
 * - 视图：排行（进度条列表）/ 热力（treemap，面积 = |累计盈亏|，色阶 = 收益率，
 *   同市场总览板块热力模块口径）；点击行 / 格子打开个股或基金详情
 */
const props = defineProps<{
  /** 清仓记录（聚合个股用） */
  cleared: TzzbClearedPosition[];
  /** 个基累计收益 */
  fundReturns: TzzbHoldingReturn[];
}>();

const emit = defineEmits<{
  /** 点击行 / 格子打开个股详情（父级统一跳转） */
  open: [code: string];
}>();

const settingsStore = useSettingsStore();

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
 * 点击行打开详情（ emit 给父级统一跳转，与建清仓记录行为一致）
 * @param row 排行行
 */
const openDetail = (row: RankRow): void => {
  emit('open', row.code);
};

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
    <!-- 筛选行：品种 × Top 档位 × 视图 -->
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <BaseTabs v-model="kind" :options="KIND_OPTIONS" class="self-start" />
      <div class="flex-1" />
      <BaseTabs v-model="topN" :options="TOP_OPTIONS" class="self-start" />
      <BaseTabs v-model="viewMode" :options="VIEW_OPTIONS" class="self-start" />
    </div>

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
        :title="`${row.type === 'fund' ? '基金' : '个股'} · 点击打开详情`"
        @click="openDetail(row)"
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
  </div>
</template>
