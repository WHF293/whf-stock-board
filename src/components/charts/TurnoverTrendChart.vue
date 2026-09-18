<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../constants/chart.constants';
import { CSS_VAR_PRIMARY } from '../../constants/theme-color.constants';
import { YUAN_PER_YI } from '../../constants/format.constants';
import {
  TURNOVER_CHART_METRIC,
  type TurnoverChartMetric,
} from '../../constants/turnover.constants';
import { readCssVar } from '../../utils/read-css-var';
import { useSettingsStore } from '../../stores/settings';
import type { TurnoverDayItem } from '../../types/turnover.types';
import BaseChart from './BaseChart.vue';

/**
 * 沪深两市成交额趋势折线图：逐日 总 / 上证 / 深证 三条曲线，近 N 个交易日走势；
 * 折线用主题色（运行时读 CSS 变量，切主题即时跟随），上证 / 深证用固定区分色；
 * 曲线逐日带数据点标记（成交额按亿计量，折线量级差异大，无点则看不清单日突变）
 *
 * 量纲口径（`metric`）：
 * - 成交量：当日成交额（亿），Y 轴固定 5000 亿步长；
 * - 相对成交量：当日成交额 − 上一交易日成交额（差额，放量正 / 缩量负），
 *   并画 0 轴虚线基准；入参需多带 1 天基准日（首个可见交易日的差额才有前值可比）。
 */
const { days, height = 260, metric = TURNOVER_CHART_METRIC.AMOUNT } = defineProps<{
  /** 成交额序列（日期升序）；相对成交量口径需在窗口前多含 1 天基准日 */
  days: TurnoverDayItem[];
  /** 图表高度（像素）；调用方传值可与同卡片表格高度对齐避免布局跳动 */
  height?: number;
  /** 量纲口径：成交量（绝对额）/ 相对成交量（较上一日差额） */
  metric?: TurnoverChartMetric;
}>();

const settingsStore = useSettingsStore();

/** 图表容器高度（像素） */
const CHART_HEIGHT_PX = height;

/** 亿元换算保留位数（展示值） */
const YI_DECIMALS = 2;

/** Y 轴固定步长（亿）：成交量口径刻度恒为 5000 亿的整数倍 */
const Y_AXIS_STEP_YI = 5000;

/** Y 轴固定步长（元，与序列同单位） */
const Y_AXIS_STEP = Y_AXIS_STEP_YI * YUAN_PER_YI;

/** Y 轴固定步长（亿）：相对成交量口径刻度恒为 3000 亿的整数倍 */
const RELATIVE_AXIS_STEP_YI = 3000;

/** 相对成交量口径 Y 轴固定步长（元，与序列同单位） */
const RELATIVE_AXIS_STEP = RELATIVE_AXIS_STEP_YI * YUAN_PER_YI;

/** 副系列固定配色（保证深色 / 浅色主题下均可读） */
const SH_COLOR = '#f97316'; // 上证：橙
const SZ_COLOR = '#22d3ee'; // 深证：青

/** 相对成交量 0 轴基准（放量 / 缩量分界），raw min/max 恒含 0 保证基准线落在刻度上 */
const RELATIVE_ZERO = 0;

/**
 * 元 -> 亿元并保留小数
 * @param value 成交额（元）
 * @returns 亿元字符串（含「亿」单位）
 */
const toYi = (value: number): string => `${(value / YUAN_PER_YI).toFixed(YI_DECIMALS)}亿`;

/**
 * 带符号亿元文案（相对成交量口径：正显 +、负自带 -）
 * @param value 差额（元）
 * @returns 形如 `+123.45亿` / `-67.89亿` 的文案
 */
const toSignedYi = (value: number): string =>
  `${value > 0 ? '+' : ''}${(value / YUAN_PER_YI).toFixed(YI_DECIMALS)}亿`;

/** 成交额取值键（总 / 上证 / 深证共用同一套差额换算） */
type AmountKey = 'totalAmount' | 'shanghaiAmount' | 'shenzhenAmount';

/** 单系列定义（名称 / 配色 / 线宽 / 符号尺寸 / 数据） */
interface SeriesDef {
  /** 图例与 tooltip 中的系列名 */
  name: string;
  /** 线与数据点颜色 */
  color: string;
  /** 线宽 */
  width: number;
  /** 数据点直径 */
  symbolSize: number;
  /** 是否带面积填充（仅总量曲线） */
  area: boolean;
  /** 逐日数值（口径换算后；相对口径首日之前无前值为 null） */
  data: Array<number | null>;
}

const option = computed<EChartsCoreOption>(() => {
  // 依赖 themeColor：切换主题色后本 computed 重新求值
  void settingsStore.themeColor;
  const primary = readCssVar(CSS_VAR_PRIMARY);
  const isRelative = metric === TURNOVER_CHART_METRIC.RELATIVE;

  /* 相对口径：入参第 0 天是基准日（调用方在窗口前多切一天），出图从第 1 天起；
     差额 = 当日 − 上一日，seriesDays[i] 的前值即 baseDays[i]（slice 偏移 1） */
  const baseDays = days;
  const seriesDays = isRelative ? days.slice(1) : days;
  const seriesValues = (key: AmountKey): Array<number | null> =>
    seriesDays.map((day, index) => {
      const value = day[key];
      if (!isRelative) return value;
      const prev = baseDays[index];
      return prev ? value - prev[key] : null;
    });

  const seriesDefs: SeriesDef[] = [
    {
      name: isRelative ? '总成交额较上日' : '两市总成交额',
      color: primary,
      width: 2,
      symbolSize: 6,
      area: true,
      data: seriesValues('totalAmount'),
    },
    {
      name: isRelative ? '上证较上日' : '上证成交额',
      color: SH_COLOR,
      width: 1.5,
      symbolSize: 4,
      area: false,
      data: seriesValues('shanghaiAmount'),
    },
    {
      name: isRelative ? '深证较上日' : '深证成交额',
      color: SZ_COLOR,
      width: 1.5,
      symbolSize: 4,
      area: false,
      data: seriesValues('shenzhenAmount'),
    },
  ];

  /* Y 轴范围：两种口径都按固定步长对齐（min/max 取步长整数倍），
     相对口径 raw min/max 恒含 0，保证 0 轴基准线必为一条刻度线 */
  let yMin: number;
  let yMax: number;
  if (isRelative) {
    const values = seriesDefs
      .flatMap((def) => def.data)
      .filter((value): value is number => value !== null);
    const rawMin = Math.min(...values, RELATIVE_ZERO);
    const rawMax = Math.max(...values, RELATIVE_ZERO);
    yMin = Math.floor(rawMin / RELATIVE_AXIS_STEP) * RELATIVE_AXIS_STEP;
    yMax = Math.max(
      Math.ceil(rawMax / RELATIVE_AXIS_STEP) * RELATIVE_AXIS_STEP,
      yMin + RELATIVE_AXIS_STEP,
    );
  } else {
    const amounts = days.flatMap((day) => [day.totalAmount, day.shanghaiAmount, day.shenzhenAmount]);
    const rawMin = amounts.length ? Math.min(...amounts) : 0;
    const rawMax = amounts.length ? Math.max(...amounts) : Y_AXIS_STEP;
    yMin = Math.floor(rawMin / Y_AXIS_STEP) * Y_AXIS_STEP;
    yMax = Math.max(Math.ceil(rawMax / Y_AXIS_STEP) * Y_AXIS_STEP, yMin + Y_AXIS_STEP);
  }

  /**
   * 数值文案：成交量口径换算亿元、相对口径带符号差额
   * @param value 序列数值（口径换算后）
   * @returns tooltip 用的格式化文案
   */
  const formatValue = (value: number): string => (isRelative ? toSignedYi(value) : toYi(value));

  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const list = params as { axisValue: string; seriesName: string; value: number; color: string }[];
        if (!list.length) {
          return '';
        }
        const lines = list
          .map((it) => `<span style="color:${it.color}">●</span> ${it.seriesName}：${formatValue(it.value)}`)
          .join('<br/>');
        return `${list[0].axisValue}<br/>${lines}`;
      },
    },
    legend: {
      data: seriesDefs.map((def) => def.name),
      textStyle: { color: CHART_TEXT_COLOR },
      top: 0,
      right: 0,
      itemWidth: 14,
      itemHeight: 8,
    },
    grid: { left: 8, right: 16, top: 28, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: seriesDays.map((day) => day.date.slice(5)),
      axisLabel: { color: CHART_TEXT_COLOR },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      // 两种口径都按固定步长出刻度：成交量 5000 亿 / 相对成交量 500 亿
      min: yMin,
      max: yMax,
      interval: isRelative ? RELATIVE_AXIS_STEP : Y_AXIS_STEP,
      axisLabel: {
        color: CHART_TEXT_COLOR,
        formatter: (value: number) =>
          isRelative ? `${value > 0 ? '+' : ''}${(value / YUAN_PER_YI).toFixed(0)}亿` : `${(value / YUAN_PER_YI).toFixed(0)}亿`,
      },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: seriesDefs.map((def, index) => ({
      name: def.name,
      type: 'line',
      data: def.data,
      smooth: true,
      showSymbol: true,
      symbolSize: def.symbolSize,
      lineStyle: { width: def.width, color: def.color },
      itemStyle: { color: def.color },
      areaStyle: def.area && !isRelative ? { opacity: 0.08, color: def.color } : undefined,
      // 0 轴基准线只挂总曲线一条（相对口径），避免三条线各画一遍互相重叠
      markLine:
        isRelative && index === 0
          ? {
              silent: true,
              symbol: 'none',
              animation: false,
              label: { show: false },
              lineStyle: { color: CHART_TEXT_COLOR, type: 'dashed', width: 1, opacity: 0.45 },
              data: [{ yAxis: RELATIVE_ZERO }],
            }
          : undefined,
    })),
  };
});
</script>

<template>
  <BaseChart :options="option" :style="{ height: `${CHART_HEIGHT_PX}px` }" />
</template>
