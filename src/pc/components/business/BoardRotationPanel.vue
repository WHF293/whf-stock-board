<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import BaseButton from '../ui/BaseButton.vue';
import BaseChart from '../charts/BaseChart.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import NoticeBar from '../ui/NoticeBar.vue';
import { useTheme } from '../../../common/composables/use-theme';
import { useSettingsStore } from '../../../common/stores/settings';
import {
  ROTATION_CHART_HEIGHT,
  ROTATION_COL_WIDTH,
  ROTATION_DEFAULT_RANGE,
  ROTATION_LOW_VOLUME_LIMIT,
  ROTATION_MAINLINE_MIN,
  ROTATION_RANGES,
  ROTATION_TIER_MID_STREAK,
  ROTATION_TOP_N,
  ROTATION_TOP_N_OPTIONS,
} from '../../../common/constants/board-rotation.constants.ts';
import { readCssVar } from '../../../common/utils/read-css-var';
import { readTrendColors } from '../../../common/utils/trend-colors';
import type {
  BoardCalendarMeta,
  BoardDailyRow,
  BoardLimitStock,
} from '../../../common/types/board-calendar.types.ts';
import type {
  RotationDay,
  RotationDayPoint,
  RotationModel,
  RotationSegment,
} from '../../../common/types/board-rotation.types.ts';
import { buildBoardRotation } from '../../../common/utils/build-board-rotation';

/**
 * 题材轮动面板（上下布局，2026-10-21 王总定稿）：
 *
 * 上栏 = 题材名次 bump 图（x = 交易日升序左旧右新、y = 涨停榜名次第 1 名在顶，
 * 一条线一个题材：线爬顶 = 主线强化，断线 = 掉榜，隔日重现开新线新色）；
 * 下栏 = 详情区（无弹窗）：默认渲染最新交易日的单日构成，
 * 点图上日期列（x 轴标签）原地切换单日，点线 / 端点题材名切换题材段生命周期。
 *
 * 组件只吃 props 不直连数据层；跳转通过事件上抛（stockClick / boardClick），页面负责路由与停靠面板。
 * 口径与交互定论见 .ai/开发方案/2026-10-21-前端-题材轮动页面开发方案.md。
 */

const props = defineProps<{
  /** 交易日轴（升序；仅用于约束取数口径，模型日期以落库行为准） */
  dates: string[];
  /** 板块 × 交易日聚合行（board_daily） */
  dailyRows: BoardDailyRow[];
  /** 涨停个股明细（board_limit_stock，仅 limitType = 1 参与龙头判定） */
  limitRows: BoardLimitStock[];
  /** 采集台账（board_calendar_meta） */
  metaRows: BoardCalendarMeta[];
}>();

const emit = defineEmits<{
  /** 成员股 / 龙头点击：打开右侧停靠面板（全站口径，页面处理） */
  stockClick: [symbol: string];
  /** 板块点击：跳板块详情页（页面处理路由） */
  boardClick: [boardCode: string];
}>();

const { isDark } = useTheme();
const settingsStore = useSettingsStore();

/* --------------------------------- 视图状态 --------------------------------- */

/** 展示范围（交易日数；BaseTabs value 为字符串） */
const range = ref<string>(String(ROTATION_DEFAULT_RANGE));
/** 主线宽度 TopN（字符串档位，建模时转数字） */
const topN = ref<string>(String(ROTATION_TOP_N));
/** 选中的交易日（'' = 最新） */
const selectedDate = ref('');
/** 激活的题材段键（boardCode|startIndex；null = 单日构成模式） */
const activeSegmentKey = ref<string | null>(null);
/** 图例气泡开关 */
const legendOpen = ref(false);

/** 范围切换选项 */
const rangeOptions = ROTATION_RANGES.map((value) => ({ label: `近${value}日`, value: String(value) }));
/** TopN 切换选项 */
const topNOptions = ROTATION_TOP_N_OPTIONS.map((value) => ({ label: `Top${value}`, value: String(value) }));

/* --------------------------------- 模型构建 --------------------------------- */

const fullModel = computed<RotationModel>(() =>
  buildBoardRotation(props.dailyRows, props.limitRows, props.metaRows, { topN: Number(topN.value) }),
);

/** 当前展示窗口内的交易日（模型日期末尾 N 个，升序） */
const windowDays = computed<RotationDay[]>(() =>
  fullModel.value.days.slice(-Number(range.value)),
);

/** 当前窗口日期集合（bump 图线点裁剪用） */
const windowDateSet = computed<Set<string>>(
  () => new Set(windowDays.value.map((day) => day.tradeDate)),
);

/** 详情区当前日（选中日缺位时回退最新交易日） */
const currentDay = computed<RotationDay | null>(
  () =>
    windowDays.value.find((day) => day.tradeDate === selectedDate.value) ??
    windowDays.value[windowDays.value.length - 1] ??
    null,
);

/** 详情区当前段（段生命周期模式） */
const activeSegment = computed<RotationSegment | null>(() => {
  if (activeSegmentKey.value === null) return null;
  return fullModel.value.segments.find(
    (segment) => `${segment.boardCode}|${segment.startIndex}` === activeSegmentKey.value,
  ) ?? null;
});

// 窗口变化后保持选中日有效（切 TopN / 范围时掉出窗口的日期回退最新）
watch([range, topN, () => props.dailyRows.length], () => {
  if (selectedDate.value !== '' && !windowDateSet.value.has(selectedDate.value)) {
    selectedDate.value = '';
  }
});

/* --------------------------------- 涨停明细索引 --------------------------------- */

/** (日期) → 该日涨停个股（按 symbol 去重取最高连板；一只票可归属多板块，全市场梯队统计必须去重） */
const limitUpByDate = computed<Map<string, BoardLimitStock[]>>(() => {
  const byDate = new Map<string, BoardLimitStock[]>();
  const bestBySymbol = new Map<string, BoardLimitStock>();
  for (const row of props.limitRows) {
    if (row.limitType !== 1) continue;
    const key = `${row.tradeDate}|${row.symbol}`;
    const known = bestBySymbol.get(key);
    const streak = row.limitStreak ?? 1;
    if (!known || streak > (known.limitStreak ?? 1)) {
      bestBySymbol.set(key, row);
    }
  }
  for (const row of bestBySymbol.values()) {
    const list = byDate.get(row.tradeDate);
    if (list) {
      list.push(row);
    } else {
      byDate.set(row.tradeDate, [row]);
    }
  }
  return byDate;
});

/** 涨停梯队四格（高度板 / 中军 / 首板 / 曾炸板；无明细时各项为 null → 展示「--」） */
const tierStats = computed(() => {
  const day = currentDay.value;
  if (!day) return null;
  const rows = limitUpByDate.value.get(day.tradeDate) ?? [];
  if (rows.length === 0) return null;
  const height = rows.reduce((best, row) =>
    (row.limitStreak ?? 1) > (best.limitStreak ?? 1) ? row : best,
  );
  return {
    height: height.name ? `${height.name} ${height.limitStreak ?? 1}板` : '--',
    mid: rows.filter((row) => (row.limitStreak ?? 1) === ROTATION_TIER_MID_STREAK).length,
    first: rows.filter((row) => (row.limitStreak ?? 1) === 1).length,
    opened: rows.filter((row) => (row.openTimes ?? 0) > 0).length,
  };
});

/* --------------------------------- bump 图配置 --------------------------------- */

/** 主题色（依赖暗色与涨跌配色主题，切换后重算；实例由 BaseChart 重建跟随） */
const palette = computed(() => {
  void isDark.value;
  void settingsStore.trendTheme;
  const trend = readTrendColors();
  return {
    text: readCssVar('--color-text'),
    muted: readCssVar('--color-text-tertiary'),
    grid: readCssVar('--color-flat-weak'),
    up: trend.up,
    downStrong: trend.downStrong,
    tooltipBg: readCssVar('--color-surface'),
  };
});

/** 星期文案 */
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const weekdayOf = (iso: string): string => {
  const parsed = new Date(`${iso}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : (WEEKDAY_LABELS[parsed.getDay()] ?? '');
};

/**
 * 首封时间 HHMMSS → HH:MM:SS
 * @param sealTime 首次封板时间（HHMMSS）
 * @returns 展示文案（非法值返回 '--'）
 */
const formatSealTime = (sealTime: string | null): string =>
  sealTime === null || sealTime.length !== 6 ? '--' : `${sealTime.slice(0, 2)}:${sealTime.slice(2, 4)}:${sealTime.slice(4)}`;

/** 图表总宽（列宽固定不压缩，30 日超出容器横向滚动） */
const chartWidth = computed<number>(
  () => 46 + windowDays.value.length * ROTATION_COL_WIDTH + 120,
);

const chartOptions = computed<EChartsCoreOption>(() => {
  const colors = palette.value;
  const dayMeta = new Map(windowDays.value.map((day) => [day.tradeDate, day]));

  /**
   * x 轴三层标签：日期+星期 / 全市场涨停 / 主线判定
   * @param value 类目值（交易日）
   * @returns rich 文本标签
   */
  const xAxisLabel = (value: string): string => {
    const day = dayMeta.get(value);
    if (!day) return value;
    const pill = day.isLowVolume
      ? `{quiet|无主线·缩量}`
      : day.isMainline
        ? `{main|主线 · ${day.topBoardName ?? '--'}}`
        : `{quiet|无主线}`;
    return `{date|${value.slice(5)} ${weekdayOf(value)}}\n{limit|涨停 ${day.limitUpCnt}}\n${pill}`;
  };

  const series = fullModel.value.segments.flatMap((segment) => {
    const points = segment.points.filter((point) => windowDateSet.value.has(point.tradeDate));
    if (points.length === 0) return [];
    const data = points.map((point, index) => ({
      value: [point.tradeDate, point.rank] as [string, number],
      point,
      // 线首写题材名（单点段也靠它标注）；段尾由 endLabel 标注
      label:
        index === 0
          ? { show: true, formatter: segment.boardName, position: 'top' as const, fontSize: 10, fontWeight: 700 as const, color: segment.color }
          : { show: false },
    }));
    return [
      {
        name: segment.boardName,
        type: 'line',
        smooth: 0.45,
        symbol: 'circle',
        symbolSize: 9,
        data,
        lineStyle: { width: 3, color: segment.color },
        itemStyle: { color: segment.color },
        emphasis: { focus: 'series' },
        endLabel: {
          show: true,
          formatter: segment.boardName,
          fontSize: 10,
          fontWeight: 700 as const,
          color: segment.color,
          distance: 6,
        },
        z: 3,
      },
    ];
  });

  return {
    animation: false,
    // 顶部留白 44：第 1 名线首的题材名 label 在轴线上方，太小会被容器裁掉一半
    grid: { left: 46, right: 110, top: 44, bottom: 64 },
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: colors.tooltipBg,
      borderColor: colors.grid,
      textStyle: { color: colors.text, fontSize: 11 },
      formatter: (params: unknown) => {
        const item = (params as { data?: { point?: RotationDayPoint } }).data;
        const point = item?.point;
        if (!point) return '';
        const leader = point.leader;
        return (
          `<b>${point.tradeDate} ${point.boardName} · 第 ${point.rank} 名</b><br/>` +
          `涨停 ${point.limitUp} 家 · 得分率 ${point.scoreRate.toFixed(2)}<br/>` +
          (leader ? `龙头：${leader.name} ${leader.limitStreak}板（首封 ${formatSealTime(leader.sealTime)}）` : '龙头：--')
        );
      },
    },
    xAxis: {
      type: 'category',
      data: windowDays.value.map((day) => day.tradeDate),
      triggerEvent: true,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: colors.grid } },
      axisLabel: {
        interval: 0,
        margin: 10,
        formatter: xAxisLabel,
        rich: {
          date: { fontSize: 10, fontWeight: 700, color: colors.text, lineHeight: 14, align: 'center' },
          limit: { fontSize: 9, color: colors.up, lineHeight: 13, align: 'center' },
          main: { fontSize: 9, fontWeight: 700, color: colors.up, lineHeight: 14, align: 'center' },
          quiet: { fontSize: 9, fontWeight: 700, color: colors.downStrong, lineHeight: 14, align: 'center' },
        },
      },
    },
    yAxis: {
      type: 'value',
      inverse: true,
      min: 1,
      max: topN.value,
      interval: 1,
      axisLabel: { formatter: '第{value}名', fontSize: 10, color: colors.muted },
      splitLine: { lineStyle: { color: colors.grid, type: 'dashed' } },
    },
    series,
  };
});

/* --------------------------------- 交互 --------------------------------- */

/** 图表点击参数（ECharts 透传，仅取用到的字段） */
interface ChartClickParams {
  componentType?: string;
  seriesType?: string;
  seriesName?: string;
  name?: string;
  value?: unknown;
}

/**
 * 选中某交易日（回到单日构成模式）
 * @param date 交易日
 */
const selectDay = (date: string): void => {
  selectedDate.value = date;
  activeSegmentKey.value = null;
};

/**
 * 打开题材段生命周期
 * @param segment 题材段
 */
const openSegment = (segment: RotationSegment): void => {
  activeSegmentKey.value = `${segment.boardCode}|${segment.startIndex}`;
  selectedDate.value = segment.points[segment.points.length - 1]?.tradeDate ?? '';
};

/** 返回最新交易日（详情区回默认态） */
const backToLatest = (): void => {
  selectedDate.value = '';
  activeSegmentKey.value = null;
};

const onChartClick = (raw: unknown): void => {
  const params = raw as ChartClickParams;
  // x 轴标签（triggerEvent）点击 = 切换单日
  if (params.componentType === 'xAxis') {
    if (typeof params.value === 'string') selectDay(params.value);
    return;
  }
  if (params.componentType !== 'series' || params.seriesType !== 'line') return;
  // 线 / 色点点击 = 选中该日并切到该段生命周期
  const date = Array.isArray(params.value) ? String(params.value[0]) : (params.name ?? '');
  const segment = fullModel.value.segments.find(
    (item) => item.boardName === params.seriesName && item.points.some((point) => point.tradeDate === date),
  );
  selectDay(date);
  if (segment) openSegment(segment);
};

/**
 * 点击板块（Top 表 / 详情按钮 / 段头）：跳板块详情
 * @param boardCode 板块代码
 */
const onBoardClick = (boardCode: string): void => {
  emit('boardClick', boardCode);
};

/**
 * 点击个股：停靠面板
 * @param symbol 个股代码
 */
const onStockClick = (symbol: string): void => {
  emit('stockClick', symbol);
};

/* --------------------------------- 展示辅助 --------------------------------- */

/** 详情区单日状态 pill 文案与样式 */
const dayPill = computed(() => {
  const day = currentDay.value;
  if (!day) return null;
  if (day.isLowVolume) return { text: '无主线 · 缩量', class: 'bg-down-weak text-down-strong' };
  if (day.isMainline) return { text: `主线 · ${day.topBoardName ?? '--'}`, class: 'bg-up-weak text-up-strong' };
  return { text: '无主线', class: 'bg-down-weak text-down-strong' };
});

/**
 * 得分率展示（回补日不可比 → '--'）
 * @param day 所属交易日
 * @param point 上榜节点
 * @returns 展示文案
 */
const scoreRateText = (day: RotationDay, point: RotationDayPoint): string =>
  day.isFullSnapshot ? point.scoreRate.toFixed(2) : '--';

/**
 * 段内状态文案
 * @param segment 题材段
 * @returns 状态文案
 */
const segmentStatus = (segment: RotationSegment): string => {
  const lastDate = fullModel.value.days[fullModel.value.days.length - 1]?.tradeDate ?? '';
  return segment.isActive
    ? `进行中 · 第 ${segment.points.length} 天`
    : `已退潮 · ${segment.points[segment.points.length - 1]!.tradeDate === lastDate ? '今日' : '近期'}掉榜`;
};
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <NoticeBar
      class="shrink-0"
      text="一条线一个题材的名次轨迹：线爬顶 = 主线强化，断线 = 掉榜退潮（隔日重现开新线新色）；悬停色点看当日龙头，点日期列看单日构成，点题材名看题材段生命周期。"
    />

    <!-- 卡片一：控制行 + bump 图（默认撑满卡片宽度；窗口天数多到列宽不够时横向滚动） -->
    <div class="shrink-0 rounded-card bg-surface p-4 shadow-card">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <BaseTabs v-model="range" :options="rangeOptions" />
        <BaseTabs v-model="topN" :options="topNOptions" />
        <div class="relative ml-auto">
          <button
            type="button"
            class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
            aria-label="图例"
            title="图例"
            @click="legendOpen = !legendOpen"
          >
            <MenuIcon name="help" :size="14" />
          </button>
          <div v-if="legendOpen" class="fixed inset-0 z-30" @click="legendOpen = false" />
          <div
            v-if="legendOpen"
            class="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-flat-weak bg-surface p-3 shadow-xl"
            role="tooltip"
          >
            <p class="mb-2 text-xs font-medium text-text">视觉语言</p>
            <ul class="space-y-1.5 text-[11px] text-text-tertiary">
              <li class="flex items-center gap-2">
                <i class="inline-block h-0.5 w-4 rounded-full bg-primary" />bump 线 = 一个题材的名次轨迹
              </li>
              <li class="flex items-center gap-2">
                <i
                  class="inline-block h-0.5 w-4"
                  style="background: repeating-linear-gradient(90deg, var(--color-primary) 0 4px, transparent 4px 8px)"
                />断线 = 掉榜（隔日重现开新线新色）
              </li>
              <li class="flex items-center gap-2">
                <i class="inline-block h-2 w-2 rounded-full bg-primary" />色点 = 当日在榜名次（悬停看龙头）
              </li>
              <li class="flex items-center gap-2">
                <i class="inline-block h-3 w-3 rounded-sm bg-up-weak" />主线日（Top1 涨停 ≥ {{ ROTATION_MAINLINE_MIN }} 家）
              </li>
              <li class="flex items-center gap-2">
                <i class="inline-block h-3 w-3 rounded-sm bg-down-weak" />无主线日（全市场涨停 &lt; {{ ROTATION_LOW_VOLUME_LIMIT }} 家为缩量）
              </li>
              <li class="flex items-center gap-2">题材名色 = 题材段身份（同板块新段新色）</li>
            </ul>
          </div>
        </div>
      </div>
      <div class="overflow-x-auto overflow-y-hidden">
        <div :style="{ width: '100%', minWidth: `${chartWidth}px`, height: `${ROTATION_CHART_HEIGHT}px` }">
          <BaseChart :options="chartOptions" not-merge @chart-click="onChartClick" />
        </div>
      </div>
    </div>

    <!-- 下栏：详情区（无弹窗，两个内容态；卡片样式包裹） -->
    <div class="board-calendar-fill min-h-0 flex-1 overflow-y-auto">
      <BaseEmpty
        v-if="!currentDay"
        text="当前窗口内暂无题材轮动数据，请先在其他视图同步板块数据"
      />
      <div v-else class="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card">
        <!-- 内容态一：单日构成 -->
        <div v-if="!activeSegment" class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <b class="text-sm text-text">{{ currentDay.tradeDate }} {{ weekdayOf(currentDay.tradeDate) }}</b>
            <span
              v-if="dayPill"
              class="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
              :class="dayPill.class"
            >
              {{ dayPill.text }}
            </span>
            <span class="text-[10px] text-text-tertiary">
              {{ currentDay.isFinal ? '数据已定稿' : '盘中（实时刷新）' }}
            </span>
          </div>
          <p class="text-[11px] text-text-tertiary">
            全市场涨停 {{ currentDay.limitUpCnt }} · 跌停 {{ currentDay.limitDownCnt }} ·
            上涨 {{ currentDay.upCount ?? '--' }} / 下跌 {{ currentDay.downCount ?? '--' }}
          </p>

          <div class="overflow-hidden rounded-lg border border-flat-weak">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-flat-weak bg-flat-weak/40 text-text-tertiary">
                  <th class="px-2 py-1.5 text-left font-medium">#</th>
                  <th class="px-2 py-1.5 text-left font-medium">板块</th>
                  <th class="px-2 py-1.5 text-right font-medium">涨停</th>
                  <th class="px-2 py-1.5 text-right font-medium">得分率</th>
                  <th class="px-2 py-1.5 text-left font-medium">当日龙头</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="point in currentDay.top"
                  :key="point.boardCode"
                  class="border-b border-flat-weak last:border-0"
                >
                  <td class="px-2 py-1.5 tabular-nums text-text-tertiary">{{ point.rank }}</td>
                  <td class="px-2 py-1.5">
                    <button
                      type="button"
                      class="pressable font-bold hover:underline"
                      :title="`${point.boardName} · 查看板块详情`"
                      @click="onBoardClick(point.boardCode)"
                    >
                      {{ point.boardName }}
                    </button>
                  </td>
                  <td class="px-2 py-1.5 text-right tabular-nums text-up-strong">{{ point.limitUp }}</td>
                  <td class="px-2 py-1.5 text-right tabular-nums">
                    {{ scoreRateText(currentDay, point) }}
                  </td>
                  <td class="px-2 py-1.5">
                    <template v-if="point.leader">
                      <button
                        type="button"
                        class="pressable hover:underline"
                        :title="`${point.leader.name} · 打开个股详情`"
                        @click="onStockClick(point.leader!.symbol)"
                      >
                        {{ point.leader.name }} {{ point.leader.limitStreak }}板
                      </button>
                    </template>
                    <span v-else class="text-text-tertiary">--</span>
                  </td>
                </tr>
                <tr v-if="currentDay.top.length === 0">
                  <td colspan="5" class="px-2 py-3 text-center text-text-tertiary">
                    当日无板块达到上榜阈值（涨停 ≥ 2 家）
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 涨停梯队四格 -->
          <div class="grid grid-cols-4 gap-2">
            <div class="rounded-lg border border-flat-weak px-2 py-1.5">
              <p class="text-[10px] text-text-tertiary">高度板</p>
              <p class="truncate text-xs font-bold text-text">{{ tierStats?.height ?? '--' }}</p>
            </div>
            <div class="rounded-lg border border-flat-weak px-2 py-1.5">
              <p class="text-[10px] text-text-tertiary">中军（{{ ROTATION_TIER_MID_STREAK }}板）</p>
              <p class="text-xs font-bold text-text">{{ tierStats ? `${tierStats.mid} 家` : '--' }}</p>
            </div>
            <div class="rounded-lg border border-flat-weak px-2 py-1.5">
              <p class="text-[10px] text-text-tertiary">首板</p>
              <p class="text-xs font-bold text-text">{{ tierStats ? `${tierStats.first} 家` : '--' }}</p>
            </div>
            <div class="rounded-lg border border-flat-weak px-2 py-1.5">
              <p class="text-[10px] text-text-tertiary">曾炸板</p>
              <p class="text-xs font-bold text-text">{{ tierStats ? `${tierStats.opened} 家` : '--' }}</p>
            </div>
          </div>
        </div>

        <!-- 内容态二：题材段生命周期 -->
        <div v-else class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <b class="text-sm" :style="{ color: activeSegment.color }">{{ activeSegment.boardName }}</b>
            <BaseButton variant="ghost" @click="backToLatest">← 返回最新交易日</BaseButton>
          </div>
          <dl class="flex flex-col text-xs">
            <div class="flex justify-between border-b border-dashed border-flat-weak py-1.5">
              <dt class="text-text-tertiary">持续</dt>
              <dd class="font-bold">
                {{ activeSegment.points.length }} 个交易日（{{ activeSegment.points[0]?.tradeDate }} ~
                {{ activeSegment.points[activeSegment.points.length - 1]?.tradeDate }}）
              </dd>
            </div>
            <div class="flex justify-between border-b border-dashed border-flat-weak py-1.5">
              <dt class="text-text-tertiary">累计涨停家次</dt>
              <dd class="font-bold tabular-nums">{{ activeSegment.totalLimitUp }}</dd>
            </div>
            <div class="flex justify-between border-b border-dashed border-flat-weak py-1.5">
              <dt class="text-text-tertiary">最高连板</dt>
              <dd class="font-bold">
                <template v-if="activeSegment.topLeader">
                  <button
                    type="button"
                    class="pressable hover:underline"
                    @click="onStockClick(activeSegment.topLeader.symbol)"
                  >
                    {{ activeSegment.topLeader.name }} {{ activeSegment.topLeader.limitStreak }}板
                  </button>
                </template>
                <template v-else>--</template>
              </dd>
            </div>
            <div class="flex justify-between border-b border-dashed border-flat-weak py-1.5">
              <dt class="text-text-tertiary">段内状态</dt>
              <dd class="font-bold">{{ segmentStatus(activeSegment) }}</dd>
            </div>
            <div class="flex justify-between py-1.5">
              <dt class="text-text-tertiary">接棒题材</dt>
              <dd class="font-bold">
                <template v-if="activeSegment.successorName">{{ activeSegment.successorName }}</template>
                <template v-else>--</template>
              </dd>
            </div>
          </dl>

          <div>
            <p class="mb-1 text-[11px] font-semibold text-text-secondary">龙头变迁链</p>
            <div class="flex flex-wrap items-center gap-1">
              <template v-for="(point, index) in activeSegment.points" :key="point.tradeDate">
                <span v-if="index > 0" class="text-text-tertiary">→</span>
                <span
                  class="rounded-full border border-flat-weak px-2 py-0.5 text-[10px]"
                  :title="`${point.tradeDate} · 涨停 ${point.limitUp} 家`"
                >
                  <template v-if="point.leader">
                    <button
                      type="button"
                      class="pressable font-semibold hover:underline"
                      @click="onStockClick(point.leader.symbol)"
                    >
                      {{ point.leader.name }} {{ point.leader.limitStreak }}板
                    </button>
                  </template>
                  <template v-else>--</template>
                </span>
              </template>
            </div>
          </div>

          <div>
            <p class="mb-1 text-[11px] font-semibold text-text-secondary">成员股明细</p>
            <div class="overflow-hidden rounded-lg border border-flat-weak">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b border-flat-weak bg-flat-weak/40 text-text-tertiary">
                    <th class="px-2 py-1.5 text-left font-medium">成员股</th>
                    <th class="px-2 py-1.5 text-right font-medium">现连板</th>
                    <th class="px-2 py-1.5 text-right font-medium">首封时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="member in activeSegment.members"
                    :key="member.symbol"
                    class="border-b border-flat-weak last:border-0"
                  >
                    <td class="px-2 py-1.5">
                      <button
                        type="button"
                        class="pressable font-semibold text-primary hover:underline"
                        @click="onStockClick(member.symbol)"
                      >
                        {{ member.name }}
                      </button>
                    </td>
                    <td class="px-2 py-1.5 text-right tabular-nums">{{ member.limitStreak }}</td>
                    <td class="px-2 py-1.5 text-right tabular-nums text-text-tertiary">
                      {{ formatSealTime(member.sealTime) }}
                    </td>
                  </tr>
                  <tr v-if="activeSegment.members.length === 0">
                    <td colspan="3" class="px-2 py-3 text-center text-text-tertiary">段内无涨停明细</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="flex justify-end">
            <BaseButton variant="primary" @click="onBoardClick(activeSegment.boardCode)">
              进入{{ activeSegment.boardName }}板块详情
            </BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
