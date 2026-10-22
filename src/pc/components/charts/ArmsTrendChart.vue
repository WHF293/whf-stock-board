<script setup lang="ts">
import { computed } from 'vue';
import { useDark } from '@vueuse/core';
import dayjs from 'dayjs';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_LINE_TEAL,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../common/constants/chart.constants.ts';
import { MINUTE_AXIS_RANGES } from '../../../common/constants/kline.constants.ts';
import { ARMS_NEUTRAL_LINE } from '../../../common/constants/market-breadth.constants.ts';
import type { BreadthPoint } from '../../../common/types/market-breadth.types.ts';
import { useSettingsStore } from '../../../common/stores/settings';
import { readTrendColors } from '../../../common/utils/trend-colors';
import BaseChart from './BaseChart.vue';

/**
 * 市场宽度 · ARMS 当日分时图（ECharts）
 *
 * - ARMS 曲线（30s 采样、同分钟去重）+ y=1 平衡虚线 + 强/弱淡色带；
 * - X 轴恒定为全天固定时间轴（09:31~11:30 + 13:01~14:57 + 15:00，共 238 格，
 *   与 K 线图分时同口径，参考 buildMinuteAxis）：盘中已发生的分钟之后以 null 占位，
 *   曲线只画到当前时刻，X 轴始终横跨 09:30~15:00；
 * - 缺口断线（connectNulls: false）；曲线固定青绿（CHART_LINE_TEAL，不随主题色）
 */
const { points = [] } = defineProps<{
  /** 当日分钟点序列（30s 采样、同分钟去重，时间升序） */
  points?: BreadthPoint[];
}>();

const settingsStore = useSettingsStore();
const isDark = useDark();

/** 平衡线文案（tooltip / markLine） */
const NEUTRAL_LINE_LABEL = '平衡线 1.0';

/** 全天固定时间轴槽位（升序毫秒时间戳，minute 对齐） */
const axisSlots = (() => {
  const day = dayjs().startOf('day');
  const slots: number[] = [];
  for (const { start, count } of MINUTE_AXIS_RANGES) {
    const [hour, minute] = start.split(':').map(Number);
    const first = day.hour(hour).minute(minute);
    for (let i = 0; i < count; i += 1) slots.push(first.add(i, 'minute').valueOf());
  }
  return slots;
})();

/** 槽位分钟（day-of-minute）→ 槽位时间戳（采样点归槽用） */
const slotTsByMinute = new Map<number, number>(
  axisSlots.map((ts) => {
    const d = dayjs(ts);
    return [d.hour() * 60 + d.minute(), ts];
  }),
);

/** 上午连续竞价有效分钟（09:30~11:30；09:30 采样归 09:31 首格，与分钟线口径一致） */
const AM_START = 9 * 60 + 30;
const AM_END = 11 * 60 + 30;
/** 下午连续竞价有效分钟（13:00~14:57；13:00 采样归 13:01 首格） */
const PM_START = 13 * 60;
const PM_END = 14 * 60 + 57;
/** 收盘时刻（15:00 单独一格，覆盖集合竞价口径） */
const CLOSE_MINUTE = 15 * 60;

/**
 * 采样点归槽：返回该采样分钟对应的轴槽位时间戳；午休 / 14:58~14:59 集合竞价 /
 * 盘外采样不入轴（返回 undefined）
 * @param time 采样点毫秒时间戳
 * @returns 对应轴槽位时间戳；无效时段返回 undefined
 */
const resolveSlot = (time: number): number | undefined => {
  const d = dayjs(time);
  const minute = d.hour() * 60 + d.minute();
  if (minute >= AM_START && minute <= AM_END) {
    return slotTsByMinute.get(Math.max(minute, AM_START + 1));
  }
  if (minute >= PM_START && minute <= PM_END) {
    return slotTsByMinute.get(Math.max(minute, PM_START + 1));
  }
  if (minute === CLOSE_MINUTE) return slotTsByMinute.get(CLOSE_MINUTE);
  return undefined;
};

/** X 轴刻度展示文案：首格 09:31 按分时图惯例标开盘时刻 09:30，其余原样 */
const axisLabels = axisSlots.map((ts) => {
  const label = dayjs(ts).format('HH:mm');
  return label === '09:31' ? '09:30' : label;
});

/** 仅在固定刻度处显示轴标签（对齐 K 线图分时轴：09:30 / 10:30 / 11:30 / 14:00 / 15:00） */
const TICK_LABELS = new Set(['09:30', '10:30', '11:30', '14:00', '15:00']);

const option = computed<EChartsCoreOption>(() => {
  void settingsStore.trendTheme;
  void isDark.value;
  const trend = readTrendColors();

  // 采样点按分钟归槽（同槽后者覆盖，与「同分钟去重」口径一致）；arms 无法计算（null）
  // 与未到时刻的槽位一样落 null，connectNulls: false 统一断线
  const armsBySlot = new Map<number, number | null>();
  for (const point of points) {
    const slot = resolveSlot(point.time);
    if (slot !== undefined) armsBySlot.set(slot, point.arms);
  }

  return {
    grid: { left: 44, right: 14, top: 18, bottom: 24 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      // 全天固定轴有大量未到时刻 / 午休的空槽（null）：悬停时不再显示「ARMS --」，
      // 改为「暂无采样」；只有有值的格子才显示数值行
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const first = list[0] as
          | { axisValueLabel?: string; name?: string; data?: number | null; marker?: string }
          | undefined;
        if (!first) return '';
        const time = first.axisValueLabel ?? first.name ?? '';
        if (typeof first.data !== 'number') {
          return `${time}<br/><span style="color: var(--color-text-tertiary)">暂无采样</span>`;
        }
        return `${first.marker ?? ''}${time}<br/>ARMS&nbsp;&nbsp;${first.data.toFixed(2)}`;
      },
    },
    xAxis: {
      type: 'category',
      data: axisLabels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisLabel: {
        color: CHART_TEXT_COLOR,
        fontSize: 10,
        interval: (_index: number, label: string) => TICK_LABELS.has(label),
      },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: (v: number) => v.toFixed(1) },
    },
    series: [
      {
        name: 'ARMS',
        type: 'line',
        data: axisSlots.map((slot) => armsBySlot.get(slot) ?? null),
        connectNulls: false,
        symbol: 'none',
        lineStyle: { color: CHART_LINE_TEAL, width: 1.8 },
        itemStyle: { color: CHART_LINE_TEAL },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: NEUTRAL_LINE_LABEL },
          lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
          data: [{ yAxis: ARMS_NEUTRAL_LINE }],
        },
        markArea: {
          silent: true,
          data: [
            [
              { yAxis: 'min', itemStyle: { color: trend.up, opacity: 0.05 } },
              { yAxis: ARMS_NEUTRAL_LINE },
            ],
            [
              { yAxis: ARMS_NEUTRAL_LINE, itemStyle: { color: trend.down, opacity: 0.05 } },
              { yAxis: 'max' },
            ],
          ],
        },
      },
    ],
  };
});
</script>

<template>
  <!-- 高度交给父级容器决定（h-full 撑满，ResizeObserver 自适应），不再固定像素 -->
  <BaseChart :options="option" />
</template>
