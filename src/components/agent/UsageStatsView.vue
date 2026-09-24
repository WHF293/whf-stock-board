<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import type { EChartsCoreOption } from 'echarts/core';
import { useSettingsStore } from '@/stores/settings';
import BaseEmpty from '@/components/ui/BaseEmpty.vue';
import MenuIcon from '@/components/ui/MenuIcon.vue';
import BaseChart from '@/components/charts/BaseChart.vue';
import { listUsage } from '@/composables/use-agent-db';
import { toDayKey, DAY_KEY_FORMAT } from '@/utils/to-day-key';
import { calcUsageStreaks } from '@/utils/calc-usage-streaks';
import { formatCompactNumber } from '@/utils/format-compact-number';
import { formatDurationMs } from '@/utils/format-duration-ms';
import { readCssVar } from '@/utils/read-css-var';
import { CSS_VAR_PRIMARY } from '@/constants/theme-color.constants';
import {
  CHART_TEXT_COLOR,
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
} from '@/constants/chart.constants';
import {
  USAGE_HEATMAP_WEEKS,
  USAGE_HEATMAP_LEVELS,
  USAGE_HEATMAP_ALPHAS,
  USAGE_HEATMAP_FALLBACK_COLOR,
  USAGE_HEATMAP_WEEKDAY_LABELS,
  USAGE_TREND_DAYS,
  USAGE_TREND_DAYS_DEFAULT,
  USAGE_TREND_MAX_SERIES,
  USAGE_TREND_PALETTE,
  USAGE_TREND_CHART_HEIGHT,
  type UsageTrendDays,
} from '@/constants/usage-stats.constants';
import type { AgentUsageRow } from '@/types/agent.types';

/**
 * 使用统计看板（Agent 分析右区的「使用统计」视图）
 *
 * 数据源 = agent_usage 表（对话与定时任务两条链路的每次运行终态各记一行，
 * 尽力采集：模型不回 usage_metadata 则无记录）：
 * - 汇总卡：累计 Token / 峰值 Token（单日最高）/ 最长聊天时长 / 连续天数；
 * - Token 活动热力格：GitHub 式周历（16 周 × 7 天），主题色四档色阶；
 * - 每日 Token 趋势：按模型分线的折线图（7 / 30 日窗口切换）。
 */
const emit = defineEmits<{
  /** 返回对话视图 */
  (e: 'back'): void;
}>();

const settingsStore = useSettingsStore();

/* --------------------------------- 数据加载 -------------------------------- */

/** 用量记录（进入页面一次性全量拉取，本地聚合） */
const rows = ref<AgentUsageRow[]>([]);
/** 首次加载中 */
const loading = ref(true);

/** 重新拉取全量用量（进页自动 + 顶栏手动刷新共用） */
const load = async (): Promise<void> => {
  loading.value = true;
  try {
    rows.value = await listUsage();
  } finally {
    loading.value = false;
  }
};

onMounted(() => void load());

/* --------------------------------- 聚合统计 -------------------------------- */

/** 单日用量桶（tokens 汇总 + 按模型细分，趋势线数据源） */
interface DayBucket {
  /** 当日总 token（total_tokens 累加） */
  tokens: number;
  /** 模型展示名 → 当日 token */
  byModel: Map<string, number>;
}

/** 日键 → 当日用量 */
const perDay = computed<Map<string, DayBucket>>(() => {
  const map = new Map<string, DayBucket>();
  for (const row of rows.value) {
    const key = toDayKey(row.createdAt);
    const bucket = map.get(key) ?? { tokens: 0, byModel: new Map<string, number>() };
    bucket.tokens += row.totalTokens;
    bucket.byModel.set(row.modelName, (bucket.byModel.get(row.modelName) ?? 0) + row.totalTokens);
    map.set(key, bucket);
  }
  return map;
});

/** 累计 Token（全部记录 total_tokens 之和） */
const totalTokens = computed(() => rows.value.reduce((sum, row) => sum + row.totalTokens, 0));

/** 峰值 Token（单日最高的总 token；无数据为 0） */
const peakDayTokens = computed(() => {
  let peak = 0;
  for (const bucket of perDay.value.values()) {
    if (bucket.tokens > peak) peak = bucket.tokens;
  }
  return peak;
});

/** 最长聊天时长（单次运行时长最大值，含工具等待） */
const longestChatMs = computed(() => rows.value.reduce((max, row) => Math.max(max, row.durationMs), 0));

/** 连续天数（当前 + 最长） */
const streaks = computed(() => calcUsageStreaks(new Set(perDay.value.keys()), toDayKey(Date.now())));

/* --------------------------------- 热力格 --------------------------------- */

/** 热力格单元（future = 今天之后的占位格，不渲染底色） */
interface HeatCell {
  key: string;
  tokens: number;
  /** 色阶档位 0..4（0 = 无活动） */
  level: number;
  future: boolean;
}

/** 一列（周）的热力格 */
interface HeatColumn {
  cells: HeatCell[];
  /** 月份标注（隔列显示，避免拥挤） */
  label?: string;
}

/**
 * 当日 tokens → 色阶档位（相对峰值归一化，最少 1 档封顶 4 档）
 * @param tokens 当日总 token
 * @param maxTokens 覆盖窗口内单日峰值
 * @returns 档位 0..4
 */
const levelOf = (tokens: number, maxTokens: number): number => {
  if (tokens <= 0 || maxTokens <= 0) return 0;
  return Math.min(USAGE_HEATMAP_LEVELS, Math.max(1, Math.ceil((tokens / maxTokens) * USAGE_HEATMAP_LEVELS)));
};

/** 热力格色板（主题色 + 四档 alpha；依赖 themeColor 切换时重算） */
const heatColors = computed<string[]>(() => {
  void settingsStore.themeColor;
  const primary = readCssVar(CSS_VAR_PRIMARY) || USAGE_HEATMAP_FALLBACK_COLOR;
  // 主题色恒为 6 位 hex（theme.css 口径），直接追加 8 位 hex 的透明段
  return USAGE_HEATMAP_ALPHAS.map((alpha) => (primary.startsWith('#') ? `${primary}${alpha}` : primary));
});

/** 周历列（末列 = 当前周；行序周一..周日） */
const heatColumns = computed<HeatColumn[]>(() => {
  const map = perDay.value;
  const maxTokens = peakDayTokens.value;
  const today = dayjs(toDayKey(Date.now()));
  const currentWeekMonday = today.subtract((today.day() + 6) % 7, 'day');
  const startMonday = currentWeekMonday.subtract(USAGE_HEATMAP_WEEKS - 1, 'week');
  const columns: HeatColumn[] = [];
  for (let week = 0; week < USAGE_HEATMAP_WEEKS; week += 1) {
    const monday = startMonday.add(week, 'week');
    const cells: HeatCell[] = [];
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const day = monday.add(dayOffset, 'day');
      const key = day.format(DAY_KEY_FORMAT);
      const tokens = map.get(key)?.tokens ?? 0;
      cells.push({
        key,
        tokens,
        level: levelOf(tokens, maxTokens),
        future: day.isAfter(today),
      });
    }
    columns.push({
      cells,
      // 隔列标月份（首列必标），格子太小密标反而花
      label: week % 2 === 0 ? `${monday.month() + 1}月` : undefined,
    });
  }
  return columns;
});

/** 热力格图例（少 → 多） */
const heatLegend = computed(() => [0, 1, 2, 3, 4].map((level) => ({ level, color: heatColors.value[level - 1] ?? '' })));

/** 格子悬浮提示（Teleport 到 body 的 fixed 浮层；x/y 为视口坐标，锚在格子上方居中） */
const hoverTip = ref<{ cell: HeatCell; x: number; y: number } | null>(null);

/**
 * 悬浮提示文案（日期 + token 用量；无活动日只出日期）
 * @param cell 格子
 * @returns 文案
 */
const hoverTipText = (cell: HeatCell): string => {
  const day = dayjs(cell.key);
  const date = `${day.month() + 1}月${day.date()}日 ${USAGE_HEATMAP_WEEKDAY_LABELS[day.day()] ?? ''}`.trimEnd();
  return cell.tokens > 0 ? `${formatCompactNumber(cell.tokens)} tokens · ${date}` : date;
};

/**
 * 格子悬停进入：记录提示状态（future 占位格不提示）
 * @param cell 格子
 * @param event 鼠标事件（取当前格子的视口位置）
 */
const onCellEnter = (cell: HeatCell, event: MouseEvent): void => {
  if (cell.future) return;
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const rect = target.getBoundingClientRect();
  hoverTip.value = { cell, x: rect.left + rect.width / 2, y: rect.top - 6 };
};

/** 格子悬停离开：关闭提示 */
const onCellLeave = (): void => {
  hoverTip.value = null;
};

/* --------------------------------- 趋势图 --------------------------------- */

/** 当前趋势窗口（天） */
const trendDays = ref<UsageTrendDays>(USAGE_TREND_DAYS_DEFAULT);

/** 窗口内日键（升序，末位 = 今天） */
const trendKeys = computed<string[]>(() => {
  const today = dayjs(toDayKey(Date.now()));
  const keys: string[] = [];
  for (let i = trendDays.value - 1; i >= 0; i -= 1) {
    keys.push(today.subtract(i, 'day').format(DAY_KEY_FORMAT));
  }
  return keys;
});

/** 窗口内系列（按窗口总用量取前 N 个模型，逐日对齐；窗口内无数据的模型不出线） */
const trendSeries = computed<Array<{ name: string; values: number[] }>>(() => {
  const totals = new Map<string, number>();
  for (const key of trendKeys.value) {
    const bucket = perDay.value.get(key);
    if (!bucket) continue;
    for (const [name, tokens] of bucket.byModel) {
      totals.set(name, (totals.get(name) ?? 0) + tokens);
    }
  }
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, USAGE_TREND_MAX_SERIES);
  return ordered.map(([name]) => ({
    name,
    values: trendKeys.value.map((key) => perDay.value.get(key)?.byModel.get(name) ?? 0),
  }));
});

/** 趋势图配置（主题色运行时读取，切主题色即重算） */
const trendOption = computed<EChartsCoreOption>(() => {
  void settingsStore.themeColor;
  const primary = readCssVar(CSS_VAR_PRIMARY) || USAGE_HEATMAP_FALLBACK_COLOR;
  const palette = [primary, ...USAGE_TREND_PALETTE];
  const series = trendSeries.value;
  return {
    animation: false,
    color: palette,
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const list = params as Array<{ axisValue: string; seriesName: string; value: number; color: string }>;
        if (!list.length) return '';
        const lines = list
          .map(
            (it) =>
              `<span style="color:${it.color}">●</span> ${it.seriesName}：${formatCompactNumber(it.value)}`,
          )
          .join('<br/>');
        return `${list[0]?.axisValue ?? ''}<br/>${lines}`;
      },
    },
    legend: {
      data: series.map((s) => s.name),
      textStyle: { color: CHART_TEXT_COLOR },
      top: 0,
      right: 0,
      itemWidth: 14,
      itemHeight: 8,
    },
    grid: { left: 8, right: 16, top: 30, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trendKeys.value.map((key) => key.slice(5)),
      axisLabel: { color: CHART_TEXT_COLOR },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: CHART_TEXT_COLOR, formatter: (value: number) => formatCompactNumber(value) },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: series.map((s) => ({
      name: s.name,
      type: 'line',
      data: s.values,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.06 },
    })),
  };
});
</script>

<template>
  <div class="flex h-full min-w-0 flex-1 flex-col">
    <!-- 顶栏：返回对话视图 + 手动刷新 -->
    <div class="flex h-12 shrink-0 items-center gap-2 border-b border-flat-weak px-4">
      <button
        type="button"
        class="pressable rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text"
        aria-label="返回对话"
        @click="emit('back')"
      >
        <MenuIcon name="chevronLeft" :size="18" />
      </button>
      <h2 class="text-sm font-medium text-text">使用统计</h2>
      <span v-if="!loading" class="text-xs text-text-tertiary">
        {{ rows.length }} 次运行记录
      </span>
      <button
        type="button"
        class="pressable ml-auto rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text"
        aria-label="刷新统计"
        title="刷新"
        @click="void load()"
      >
        <MenuIcon name="refresh" :size="16" />
      </button>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="flex flex-1 items-center justify-center text-sm text-text-tertiary">
      正在读取用量记录…
    </div>

    <!-- 空态：模型不回 usage（或还没有对话）时 agent_usage 无记录 -->
    <BaseEmpty
      v-else-if="rows.length === 0"
      class="flex-1"
      text="暂无用量数据：与 Agent 对话后，这里会展示 Token 统计（模型需回传 usage）"
    />

    <!-- 看板主体 -->
    <div v-else class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <!-- 汇总卡 -->
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-xl border border-flat-weak p-4">
          <p class="text-xs text-text-tertiary">累计 Token</p>
          <p class="mt-1 text-2xl font-semibold text-text">{{ formatCompactNumber(totalTokens) }}</p>
          <p class="mt-1 text-xs text-text-tertiary">{{ totalTokens.toLocaleString() }} tokens</p>
        </div>
        <div class="rounded-xl border border-flat-weak p-4">
          <p class="text-xs text-text-tertiary">峰值 Token</p>
          <p class="mt-1 text-2xl font-semibold text-text">{{ formatCompactNumber(peakDayTokens) }}</p>
          <p class="mt-1 text-xs text-text-tertiary">单日最高</p>
        </div>
        <div class="rounded-xl border border-flat-weak p-4">
          <p class="text-xs text-text-tertiary">最长聊天时长</p>
          <p class="mt-1 text-2xl font-semibold text-text">{{ formatDurationMs(longestChatMs) }}</p>
          <p class="mt-1 text-xs text-text-tertiary">单次运行（含工具等待）</p>
        </div>
        <div class="rounded-xl border border-flat-weak p-4">
          <p class="text-xs text-text-tertiary">连续天数</p>
          <p class="mt-1 text-2xl font-semibold text-text">{{ streaks.current }} 天</p>
          <p class="mt-1 text-xs text-text-tertiary">最长连续 {{ streaks.longest }} 天</p>
        </div>
      </div>

      <!-- Token 活动热力格 -->
      <section class="rounded-xl border border-flat-weak p-4">
        <div class="flex items-baseline justify-between">
          <h3 class="text-sm font-medium text-text">Token 活动</h3>
          <p class="text-xs text-text-tertiary">近 {{ USAGE_HEATMAP_WEEKS }} 周</p>
        </div>
        <!-- 列宽 1fr 平分容器：格子高度固定、宽度随卡片拉伸（宽容器铺满不挤左侧） -->
        <div
          class="mt-3 grid gap-1"
          :style="{ gridTemplateColumns: `repeat(${USAGE_HEATMAP_WEEKS}, minmax(0, 1fr))` }"
        >
          <!-- 每列顶部留 h-3 标注槽（隔列给月份文字），格子行对齐天然成立 -->
          <div v-for="column in heatColumns" :key="column.cells[0]?.key" class="flex flex-col gap-1">
            <span class="h-3 text-[10px] leading-3 text-text-tertiary">{{ column.label ?? '' }}</span>
            <div
              v-for="cell in column.cells"
              :key="cell.key"
              class="h-3 rounded-[3px]"
              :class="[cell.future ? 'opacity-0' : cell.level === 0 ? 'bg-flat-weak' : '']"
              :style="cell.level > 0 ? { backgroundColor: heatColors[cell.level - 1] } : undefined"
              @mouseenter="onCellEnter(cell, $event)"
              @mouseleave="onCellLeave"
            />
          </div>
        </div>
        <div class="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-text-tertiary">
          <span>少</span>
          <span
            v-for="item in heatLegend"
            :key="item.level"
            class="h-3 w-3 rounded-[3px]"
            :class="item.level === 0 ? 'bg-flat-weak' : ''"
            :style="item.level > 0 ? { backgroundColor: item.color } : undefined"
          />
          <span>多</span>
        </div>
      </section>

      <!-- 格子悬浮提示：Teleport 到 body 防 overflow 裁剪；pointer-events-none 防闪烁 -->
      <Teleport to="body">
        <div
          v-if="hoverTip"
          class="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-flat-weak bg-surface px-2.5 py-1.5 text-xs text-text shadow-lg"
          :style="{ left: `${hoverTip.x}px`, top: `${hoverTip.y}px` }"
        >
          {{ hoverTipText(hoverTip.cell) }}
        </div>
      </Teleport>

      <!-- 每日 Token 趋势（按模型分线） -->
      <section class="rounded-xl border border-flat-weak p-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-text">每日 Token</h3>
          <div class="flex gap-1 rounded-lg bg-flat-weak p-0.5">
            <button
              v-for="days in USAGE_TREND_DAYS"
              :key="days"
              type="button"
              class="rounded-md px-2.5 py-0.5 text-xs transition-colors"
              :class="trendDays === days ? 'bg-surface text-text shadow-sm' : 'text-text-tertiary hover:text-text'"
              @click="trendDays = days"
            >
              {{ days }}日
            </button>
          </div>
        </div>
        <BaseChart class="mt-2" :options="trendOption" :style="{ height: `${USAGE_TREND_CHART_HEIGHT}px` }" />
      </section>
    </div>
  </div>
</template>
