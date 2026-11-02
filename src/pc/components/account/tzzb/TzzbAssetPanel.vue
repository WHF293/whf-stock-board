<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_LINE_BLUE,
  CHART_LINE_PURPLE,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../../common/constants/chart.constants.ts';
import {
  TZZB_RANGE_LABEL,
  TZZB_RANGE_OPTIONS,
  type TzzbPnlSummary,
  type TzzbStockTrade,
} from '../../../../common/types/tzzb.types.ts';
import { useSettingsStore } from '../../../../common/stores/settings';
import { computeUnderwater } from '../../../../common/utils/compute-underwater';
import { DOWN_COLOR } from '../../../../common/constants/stock-colors.constants.ts';
import BaseChart from '../../charts/BaseChart.vue';
import BaseTabs from '../../ui/BaseTabs.vue';

/**
 * 投资账本 · 资产曲线（queryPnlSummary）
 *
 * - 左轴净值指数（基点 1000），沪深300 / 上证按首点归一化对比；
 * - 开关「仓位变化」：右轴 0~100% 紫色虚线（双 y 轴）；
 * - 开关「最大回撤」：净值曲线下方渲染黄色半透明背景（王总 2026-10-23 定稿：
 *   染色画在曲线下方，黄色；不再用峰值差 stack 填充）；
 * - 区间为受控状态（父级持有），切换时 emit 给父级重拉 queryPnlSummary——
 *   指标行「区间盈亏 / 对比沪深300」随之联动（王总 2026-10-23 确认口径）；
 *   mock 阶段采样只覆盖 2026-10，切区间数据不变仅状态联动
 */
const props = defineProps<{
  /** 资产曲线汇总 */
  pnl: TzzbPnlSummary | null;
  /** 当前区间（父级持有；TZZB_RANGE_OPTIONS value） */
  range: string;
  /** 可选全量股票流水（回撤段「期间操作」列统计用；缺省时该列显示 —） */
  trades?: TzzbStockTrade[] | null;
}>();

const emit = defineEmits<{
  /** 区间切换（父级重拉 queryPnlSummary 并联动指标行） */
  'range-change': [range: string];
  /** 自定义区间起止变化 */
  'custom-change': [from: string, to: string];
}>();

const settingsStore = useSettingsStore();

/** 区间 v-model 代理（get = 父级状态，set = 上抛） */
const rangeModel = computed({
  get: () => props.range,
  set: (v: string) => emit('range-change', v),
});

/** 自定义区间起止（mock 阶段仅展示） */
const customFrom = ref('2026-09-01');
const customTo = ref('2026-10-23');

/** 区间副标题文案 */
const rangeLabel = computed(
  () => TZZB_RANGE_LABEL[props.range] ?? '本月',
);

/** 切到自定义区间或日期变化时上抛起止 */
watch([rangeModel, customFrom, customTo], ([r, from, to]) => {
  if (r === 'custom') emit('custom-change', from, to);
});

/** 仓位变化开关（默认开） */
const posOn = ref(true);

/** 最大回撤开关 */
const ddOn = ref(false);

/** 回撤水下开关（操作复盘阶段 2 新增：净值曲线之外的水下视角，纯本地计算） */
const uwOn = ref(false);

/** 曲线数据（空态兜底） */
const trend = computed(() => props.pnl?.assetTrend ?? []);
const idxTrend = computed(() => props.pnl?.indexTrend ?? []);

/** 归一化后的曲线数据（空数据给占位单点防 ECharts 报错） */
const trend0 = computed(() => {
  const asset = trend.value;
  const idx = idxTrend.value;
  if (asset.length === 0) {
    return { dates: ['-'], navVals: [1000], hs300Vals: [1000], shVals: [1000], posVals: [0] };
  }
  const navVals = asset.map((p) => p.navIndex);
  const base = navVals[0] || 1000;
  const hs300Vals =
    idx.length === asset.length && idx[0].hs300 !== 0
      ? idx.map((p) => (p.hs300 / idx[0].hs300) * base)
      : asset.map(() => base);
  const shVals =
    idx.length === asset.length && idx[0].sh !== 0
      ? idx.map((p) => (p.sh / idx[0].sh) * base)
      : asset.map(() => base);
  const posVals = asset.map((p) => Number((p.positionRatio * 100).toFixed(2)));
  return {
    dates: asset.map((p) => dayjs(`${p.date.slice(0, 4)}-${p.date.slice(4, 6)}-${p.date.slice(6, 8)}`).format('MM-DD')),
    navVals,
    hs300Vals: hs300Vals.map((v) => Number(v.toFixed(2))),
    shVals: shVals.map((v) => Number(v.toFixed(2))),
    posVals,
  };
});

/** 水下计算（trend 为空时 underwater 为空数组，消费侧短路） */
const uw = computed(() => computeUnderwater(trend.value, props.trades ?? null));

/** 水下子图数据（百分比口径，-3.2 = 水下 3.2%） */
const uwPct = computed(() =>
  uw.value.underwater.length >= 2
    ? uw.value.underwater.map((v) => Number((v * 100).toFixed(2)))
    : [],
);

/** 水下子图配置（主图下方独立小图，绿色=亏损语义，红涨绿跌口径） */
const uwOption = computed<EChartsCoreOption>(() => {
  void settingsStore.trendTheme;
  return {
    grid: { left: 44, right: 12, top: 8, bottom: 20 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const p = list[0] as { axisValue?: string; data?: number } | undefined;
        const v = p?.data ?? 0;
        return `<b>${p?.axisValue ?? ''}</b><br/>水下 ${Math.abs(v).toFixed(2)}%`;
      },
    },
    xAxis: {
      type: 'category',
      data: trend0.value.dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      max: 0,
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: (v: number) => `${v}%` },
    },
    series: [
      {
        name: '回撤水下',
        type: 'line',
        data: uwPct.value,
        symbol: 'none',
        lineStyle: { color: DOWN_COLOR, width: 1.2 },
        itemStyle: { color: DOWN_COLOR },
        areaStyle: { color: DOWN_COLOR, opacity: 0.22 },
      },
    ],
  };
});

/**
 * 千分位金额（回撤段操作列，整数元）
 * @param v 金额
 * @returns 千分位整数文案
 */
const yuan = (v: number): string => v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });

/**
 * 回撤段操作列文案（无流水输入返回 —）
 * @param i 段下标
 * @returns 操作文案（买/卖笔数与金额；未操作 / —）
 */
const activityText = (i: number): string => {
  const a = uw.value.segments[i]?.activity;
  if (!a) return '—';
  if (a.buys === 0 && a.sells === 0) return '未操作';
  const parts: string[] = [];
  if (a.buys > 0) parts.push(`买 ${a.buys} 笔 ¥${yuan(a.buyAmount)}`);
  if (a.sells > 0) parts.push(`卖 ${a.sells} 笔 ¥${yuan(a.sellAmount)}`);
  return parts.join(' · ');
};

const option = computed<EChartsCoreOption>(() => {
  void settingsStore.trendTheme;
  const { dates, navVals, hs300Vals, shVals, posVals } = trend0.value;

  const series: Record<string, unknown>[] = [];
  // 最大回撤：黄色半透明背景垫底（净值曲线下方，先渲染被后续曲线覆盖）
  if (ddOn.value) {
    series.push({
      name: '回撤背景',
      type: 'line',
      data: navVals,
      symbol: 'none',
      lineStyle: { width: 0, opacity: 0 },
      areaStyle: { color: '#f59e0b', opacity: 0.15 },
      tooltip: { show: false },
      silent: true,
      z: 0,
    });
  }
  series.push(
    {
      name: '账户净值',
      type: 'line',
      data: navVals,
      symbol: 'none',
      lineStyle: { color: CHART_LINE_BLUE, width: 2 },
      itemStyle: { color: CHART_LINE_BLUE },
      areaStyle: { color: CHART_LINE_BLUE, opacity: 0.07 },
    },
    {
      name: '沪深300',
      type: 'line',
      data: hs300Vals,
      symbol: 'none',
      lineStyle: { color: '#94a3b8', width: 1.4 },
      itemStyle: { color: '#94a3b8' },
    },
    {
      name: '上证指数',
      type: 'line',
      data: shVals,
      symbol: 'none',
      lineStyle: { color: '#f59e0b', width: 1.4 },
      itemStyle: { color: '#f59e0b' },
    },
  );
  if (posOn.value) {
    series.push({
      name: '仓位',
      type: 'line',
      data: posVals,
      yAxisIndex: 1,
      symbol: 'none',
      lineStyle: { color: CHART_LINE_PURPLE, width: 1.5, type: 'dashed' },
      itemStyle: { color: CHART_LINE_PURPLE },
    });
  }

  return {
    grid: { left: 44, right: 44, top: 18, bottom: 24 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const date = (list[0] as { axisValue?: string } | undefined)?.axisValue ?? '';
        const pick = (name: string): string | null => {
          const hit = list.find((p) => (p as { seriesName?: string }).seriesName === name);
          return hit ? String((hit as { data?: unknown }).data) : null;
        };
        const navText = pick('账户净值');
        const posText = pick('仓位');
        const lines = [`<b>${date}</b>`];
        if (navText) lines.push(`净值指数 ${navText}`);
        if (posText) lines.push(`<span style="color:${CHART_LINE_PURPLE}">仓位 ${posText}%</span>`);
        for (const name of ['沪深300', '上证指数']) {
          const v = pick(name);
          if (v) lines.push(`${name} ${v}`);
        }
        return lines.join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
        axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: (v: number) => v.toFixed(0) },
      },
      {
        type: 'value',
        min: 0,
        max: 100,
        position: 'right',
        splitLine: { show: false },
        axisLabel: {
          color: CHART_LINE_PURPLE,
          fontSize: 10,
          formatter: (v: number) => `${v}%`,
        },
      },
    ],
    series,
  };
});
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 区间切换 + 开关 -->
    <div class="mb-2 flex flex-wrap items-center gap-3">
      <BaseTabs v-model="rangeModel" :options="TZZB_RANGE_OPTIONS" />
      <label class="flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary">
        <input v-model="posOn" type="checkbox" class="accent-primary" />
        仓位变化
      </label>
      <label class="flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary">
        <input v-model="ddOn" type="checkbox" class="accent-primary" />
        最大回撤
      </label>
      <label class="flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary">
        <input v-model="uwOn" type="checkbox" class="accent-primary" />
        回撤水下
      </label>
    </div>

    <!-- 自定义区间行 -->
    <div v-if="rangeModel === 'custom'" class="mb-2 flex items-center gap-2 text-xs text-text-secondary">
      <input v-model="customFrom" type="date" class="rounded-lg bg-flat-weak px-2 py-1 font-mono text-xs text-text" />
      <span class="text-text-tertiary">~</span>
      <input v-model="customTo" type="date" class="rounded-lg bg-flat-weak px-2 py-1 font-mono text-xs text-text" />
      <span class="text-text-tertiary">正式接入后按起止日调 queryPnlSummary（区间过长自动分段）</span>
    </div>

    <!-- 图表 -->
    <div class="relative min-h-0 flex-1">
      <BaseChart :options="option" not-merge />
    </div>

    <!-- 回撤水下子图 + 回撤段明细（操作复盘阶段 2 新增；方案 §4.4） -->
    <template v-if="uwOn && uwPct.length > 0">
      <div class="mt-1 h-24 shrink-0">
        <BaseChart :options="uwOption" not-merge />
      </div>
      <div
        v-if="uw.segments.length > 0"
        class="mt-1 max-h-32 shrink-0 overflow-y-auto rounded-lg bg-flat-weak/40 p-2"
      >
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="text-text-tertiary">
              <th class="py-0.5 pr-2 font-normal">回撤段（峰值 → 谷底）</th>
              <th class="py-0.5 pr-2 text-right font-normal">深度</th>
              <th class="py-0.5 pr-2 text-right font-normal">下行</th>
              <th class="py-0.5 pr-2 text-right font-normal">修复</th>
              <th class="py-0.5 text-right font-normal">回撤期间操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(seg, i) in uw.segments"
              :key="seg.peakDate"
              class="border-t border-flat-weak"
              :class="i === uw.maxSegmentIndex ? 'bg-flat-weak/70' : ''"
            >
              <td class="py-0.5 pr-2 font-mono text-text-secondary">
                {{ seg.peakDate.slice(5) }} → {{ seg.troughDate.slice(5) }}
                <span v-if="i === uw.maxSegmentIndex" class="ml-1 text-text-tertiary">最深</span>
              </td>
              <td class="py-0.5 pr-2 text-right font-mono tabular-nums text-down">
                -{{ (seg.depth * 100).toFixed(2) }}%
              </td>
              <td class="py-0.5 pr-2 text-right font-mono tabular-nums text-text-secondary">
                {{ seg.durationDays }} 天
              </td>
              <td class="py-0.5 pr-2 text-right font-mono tabular-nums" :class="seg.recoveryDays === null ? 'text-down' : 'text-text-secondary'">
                {{ seg.recoveryDays === null ? '未修复' : `${seg.recoveryDays} 天` }}
              </td>
              <td class="py-0.5 text-right font-mono tabular-nums text-text-secondary">
                {{ activityText(i) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <p class="mt-1 shrink-0 text-xs text-text-tertiary">
      左轴净值指数（基点 1000）{{ posOn ? ' · 右轴仓位 %' : '' }} · {{ rangeLabel }}
    </p>
  </div>
</template>
