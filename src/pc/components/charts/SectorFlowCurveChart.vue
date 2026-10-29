<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../common/constants/chart.constants.ts';
import { MINUTE_AXIS_TICKS } from '../../../common/constants/kline.constants.ts';
import { YUAN_PER_YI } from '../../../common/constants/format.constants.ts';
import { buildMinuteAxis } from '../../../common/utils/build-minute-axis';
import { useSettingsStore } from '../../../common/stores/settings';
import { readTrendColors } from '../../../common/utils/trend-colors';
import type { SectorFlowCurveView } from '../../../common/types/sector-flow-curve.types.ts';
import BaseChart from './BaseChart.vue';

/**
 * 行业资金曲线图：多行业当日累计主力净流入分时曲线同屏叠加
 *
 * - 时间轴与 K 线图 / 分时图同口径：按曲线归属交易日生成 238 格固定交易分钟轴
 *   （09:31~11:30 + 13:01~14:57 + 15:00，午休压缩、刻度恒定），标签只在
 *   MINUTE_AXIS_TICKS 指定的五个时刻展示；曲线按 `HH:mm` 对齐到固定轴，
 *   缺失分钟为 null 并 connectNulls 连线，盘中未走到的时段曲线自然止步；
 * - 线色按收盘主力净流入正负分 up / down 色系，同侧按传入顺序在四档色阶内循环
 *   （调用方应按「流入值降序 / 流出值升序」传入，保证最强者拿最深的颜色）；
 * - 涨跌配色运行时读 CSS 变量（computed 依赖 trendTheme / themeColor，切主题即时跟随）
 */
const { curves, height = undefined } = defineProps<{
  /** 曲线视图模型列表（按展示顺序：流入侧值降序在前、流出侧流出幅度降序在后） */
  curves: SectorFlowCurveView[];
  /** 图表固定高度（像素）；不传时填满父容器（父级需给定高度） */
  height?: number;
}>();

const settingsStore = useSettingsStore();

/** 零线基准（累计主力净流入正负分界） */
const ZERO_BASELINE = 0;

/** 固定刻度查找表（轴分钟 → 展示文案；非刻度分钟不展示标签） */
const tickLabelByTime = new Map(MINUTE_AXIS_TICKS.map((tick) => [tick.time, tick.label]));

/** 公共时间轴（曲线归属交易日的 238 格固定交易分钟轴，`HH:mm` 文案） */
const timeline = computed<string[]>(() => {
  const tradeDate = curves[0]?.tradeDate;
  if (!tradeDate) {
    return [];
  }
  const dayStart = dayjs(`${tradeDate}T00:00:00`).valueOf();
  return buildMinuteAxis(dayStart).map((timestamp) => dayjs(timestamp).format('HH:mm'));
});

/** 线色列表（收盘正负定色系，侧内按传入顺序循环四档色阶） */
const colorList = computed<string[]>(() => {
  // 依赖涨跌配色与主题色：切换后本 computed 重新求值
  void settingsStore.trendTheme;
  void settingsStore.themeColor;
  const colors = readTrendColors();
  const upPalette = [colors.upStrong, colors.up, colors.upLight, colors.upPale];
  const downPalette = [colors.downStrong, colors.down, colors.downLight, colors.downPale];
  let upIndex = 0;
  let downIndex = 0;
  return curves.map((curve) => {
    const final = curve.points[curve.points.length - 1]?.mainNetInflow ?? 0;
    if (final >= 0) {
      return upPalette[upIndex++ % upPalette.length];
    }
    return downPalette[downIndex++ % downPalette.length];
  });
});

/** 每条曲线对齐到固定交易分钟轴后的数值序列（缺失分钟为 null，ECharts 断点） */
const alignedSeries = computed<Array<number | null>[]>(() => {
  const axis = timeline.value;
  return curves.map((curve) => {
    const valueByTime = new Map(curve.points.map((point) => [point.time, point.mainNetInflow]));
    return axis.map((time) => valueByTime.get(time) ?? null);
  });
});

const option = computed<EChartsCoreOption>(() => {
  const axis = timeline.value;
  const colors = colorList.value;
  return {
    animation: false,
    legend: {
      type: 'scroll',
      top: 0,
      textStyle: { color: CHART_TEXT_COLOR },
      pageIconColor: CHART_TEXT_COLOR,
      pageIconInactiveColor: CHART_SPLIT_LINE_COLOR,
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (params: unknown) => {
        const items = params as {
          marker: string;
          seriesName: string;
          axisValue: string;
          value: number | null;
        }[];
        const list = items.filter(
          (item): item is (typeof items)[number] & { value: number } => item.value !== null,
        );
        if (list.length === 0) {
          return '';
        }
        const rows = [...list]
          .sort((a, b) => b.value - a.value)
          .map(
            (item) => `${item.marker}${item.seriesName} <b>${(item.value / YUAN_PER_YI).toFixed(2)}亿</b>`,
          );
        return `${list[0].axisValue}<br/>${rows.join('<br/>')}`;
      },
    },
    grid: { left: 8, right: 16, top: 36, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: axis,
      boundaryGap: false,
      // 分时图刻度口径：只在 MINUTE_AXIS_TICKS 的五个时刻出标签与纵向网格线
      axisLabel: {
        color: CHART_TEXT_COLOR,
        formatter: (value: string) => tickLabelByTime.get(value) ?? '',
      },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
      splitLine: {
        show: true,
        interval: (_index: number, value: string) => tickLabelByTime.has(value),
        lineStyle: { color: CHART_SPLIT_LINE_COLOR },
      },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: {
        color: CHART_TEXT_COLOR,
        formatter: (value: number) => `${(value / YUAN_PER_YI).toFixed(0)}亿`,
      },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: curves.map((curve, index) => {
      const color = colors[index];
      const line: Record<string, unknown> = {
        name: curve.name,
        type: 'line',
        data: alignedSeries.value[index],
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 1.5, color },
        itemStyle: { color },
        emphasis: { focus: 'series' },
      };
      // 零线基准挂首条曲线，避免每条重复绘制
      if (index === 0) {
        line.markLine = {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { type: 'dashed', color: CHART_TEXT_COLOR, opacity: 0.6 },
          data: [{ yAxis: ZERO_BASELINE }],
        };
      }
      return line;
    }),
  };
});
</script>

<template>
  <BaseChart
    not-merge
    :options="option"
    :style="height ? { height: `${height}px` } : undefined"
  />
</template>
