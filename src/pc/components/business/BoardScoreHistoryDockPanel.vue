<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import BaseButton from '../ui/BaseButton.vue';
import BaseChart from '../charts/BaseChart.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { useTheme } from '../../../common/composables/use-theme';
import { useSettingsStore } from '../../../common/stores/settings';
import { useDataCacheStore } from '../../../common/stores/data-cache';
import { appStorage } from '../../../common/utils/app-local-storage';
import { readCssVar } from '../../../common/utils/read-css-var';
import { applyBoardScoreWeights } from '../../../common/utils/apply-board-score-weights';
import { DATA_CACHE_KEY } from '../../../common/constants/data-cache.constants.ts';
import {
  ROTATION_MIN_LIMIT_UP,
  ROTATION_PALETTE,
  ROTATION_SCORE_HISTORY_MAX,
  STORAGE_NS_ROTATION_SCORE_HISTORY_BOARDS,
} from '../../../common/constants/board-rotation.constants.ts';
import type { BoardDailyRow } from '../../../common/types/board-calendar.types.ts';

/**
 * 板块历史得分 · 右侧停靠面板（题材轮动控制行「查看板块历史得分」发起，
 * 王总 2026-11-03 指定由弹窗改 dock 化：拖宽 / 持久化复用容器能力）
 *
 * 定位：bump 图只画每日上榜（Top N）板块的名次切换，板块掉榜的日子线就断了；
 * 本面板补「单板块视角」——从 36 板块池任选（最多 8 个），画窗口内逐日得分曲线，
 * 未上榜日也照常取数（board_daily 每天每板块都有得分）。
 *
 * 数据源与页面解耦（同赚钱效应气泡图口径）——直接读 data-cache 的 board_daily
 * 会话缓存（页内轮询持续刷新）并按自定义权重重算，可在任意页面打开。
 *
 * 持久化：板块勾选（rotation.scoreHistoryBoards）写 appStorage，下次打开恢复；
 * 展示范围档收在 settings store（rotationRange），与页面题材轮动范围 Tabs 实时同步。
 */

const settingsStore = useSettingsStore();
const dataCache = useDataCacheStore();
const { isDark } = useTheme();

/* --------------------------------- 状态与持久化 --------------------------------- */

/** 曲线值口径：score = 原始得分（板块Top 同源）；scoreRate = 得分率（上榜门槛同源） */
const metric = ref<'score' | 'scoreRate'>('score');
/** 口径切换选项 */
const metricOptions = [
  { label: '得分', value: 'score' },
  { label: '得分率', value: 'scoreRate' },
] as const;

/** 展示范围档（近 10/20/30 日）：真身在 settings store，与页面题材轮动范围 Tabs 同步（王总 2026-11-03 指定移除抽屉内独立筛选） */
const range = computed<number>(() => settingsStore.rotationRange);

/** 从 appStorage 读已持久化的勾选（非法值静默回落空选）
 * @returns 已勾选板块代码数组 */
const loadSelectedCodes = (): string[] => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_ROTATION_SCORE_HISTORY_BOARDS);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

/** 已勾选板块代码（数组序 = 曲线配色序，持久化于 appStorage） */
const selectedCodes = ref<string[]>(loadSelectedCodes());

// 勾选变化即持久化（数组整体替换式更新，无需 deep）
watch(selectedCodes, (codes) => {
  appStorage.setItem(STORAGE_NS_ROTATION_SCORE_HISTORY_BOARDS, JSON.stringify(codes));
});

/* --------------------------------- 数据模型（自取数，与页面解耦） --------------------------------- */

/** 会话缓存的板块日聚合（页内轮询持续写入） */
const cachedRows = computed<BoardDailyRow[]>(() =>
  dataCache.get<BoardDailyRow[]>(DATA_CACHE_KEY.BOARD_CALENDAR_MATRIX) ?? [],
);

/** 应用自定义权重后的日聚合（与页面同口径） */
const weightedRows = computed<BoardDailyRow[]>(() =>
  applyBoardScoreWeights(cachedRows.value, settingsStore.boardScoreWeights),
);

/** 本地有数据的交易日（升序） */
const datesWithData = computed<string[]>(() =>
  [...new Set(weightedRows.value.map((row) => row.tradeDate))].sort(),
);

/** 展示窗口的交易日（取末尾 N 个，升序；N = settings 的题材轮动范围档，与页面联动） */
const windowDates = computed<string[]>(() =>
  datesWithData.value.slice(-range.value),
);

/** 36 板块池（加权行去重派生，按名称排序） */
const boardPool = computed(() => {
  const seen = new Map<string, string>();
  for (const row of weightedRows.value) {
    if (!seen.has(row.boardCode)) seen.set(row.boardCode, row.boardName);
  }
  return [...seen.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
});

/** (日期|板块) → 聚合行 索引 */
const rowIndex = computed(() => {
  const map = new Map<string, BoardDailyRow>();
  for (const row of weightedRows.value) map.set(`${row.tradeDate}|${row.boardCode}`, row);
  return map;
});

/** 有效勾选（剔除池中已不存在的代码，防止历史持久化残留） */
const validCodes = computed(() => {
  const poolCodes = new Set(boardPool.value.map((board) => board.code));
  return selectedCodes.value.filter((code) => poolCodes.has(code));
});

/** 已勾选数展示（含失效代码，与持久化内容一致） */
const selectedCount = computed(() => selectedCodes.value.length);

/** 勾选满额后其余板块置灰不可点 */
const isFull = computed(() => selectedCodes.value.length >= ROTATION_SCORE_HISTORY_MAX);

/**
 * 勾选 / 取消某板块（满额后忽略新增；先取消一个才能再选）
 * @param code 板块代码
 */
const onToggle = (code: string): void => {
  if (selectedCodes.value.includes(code)) {
    selectedCodes.value = selectedCodes.value.filter((item) => item !== code);
    return;
  }
  if (isFull.value) return;
  selectedCodes.value = [...selectedCodes.value, code];
};

/** 清空勾选 */
const onClear = (): void => {
  selectedCodes.value = [];
};

/** 板块代码 → 名称 */
const nameByCode = computed(() => new Map(boardPool.value.map((board) => [board.code, board.name])));

/**
 * 勾选板块的曲线配色（按勾选顺序轮转题材段调色板，与 chips 底色一致）
 * @param code 板块代码
 * @returns 颜色值（未勾选返回空串）
 */
const colorOf = (code: string): string => {
  const index = validCodes.value.indexOf(code);
  return index >= 0 ? (ROTATION_PALETTE[index % ROTATION_PALETTE.length] ?? '#0e9488') : '';
};

/* ------------------------------ 选择器展开 / 收起 ------------------------------ */

/**
 * 选择器展开态（王总 2026-11-03：收起只显示已选板块，避免 36 个 chips 占满面板）
 *
 * 初始：有持久化勾选则收起（只看已选），无勾选则展开（否则没得选）。
 */
const pickerExpanded = ref(loadSelectedCodes().length === 0);

/** 实际渲染的板块（收起但无勾选时强制展开，避免空列表） */
const visibleBoards = computed(() =>
  pickerExpanded.value || selectedCount.value === 0
    ? boardPool.value
    : boardPool.value.filter((board) => selectedCodes.value.includes(board.code)),
);

/** 展开 / 收起切换按钮文案 */
const pickerToggleLabel = computed(() =>
  pickerExpanded.value ? `收起，仅看已选` : `展开全部 ${boardPool.value.length} 个`,
);

/* --------------------------------- 图表配置 --------------------------------- */

/** 主题色（依赖暗色主题，切换后重算；实例由 BaseChart 重建跟随） */
const chartColors = computed(() => {
  void isDark.value;
  return {
    text: readCssVar('--color-text'),
    muted: readCssVar('--color-text-tertiary'),
    grid: readCssVar('--color-flat-weak'),
    tooltipBg: readCssVar('--color-surface'),
  };
});

/** tooltip 数据项形态（data 上携带的扩展字段） */
interface ScoreHistoryDatum {
  value: [string, number];
  score: number;
  scoreRate: number;
  qualified: boolean;
  backfilled: boolean;
}

const chartOptions = computed<EChartsCoreOption>(() => {
  const colors = chartColors.value;
  const isRate = metric.value === 'scoreRate';

  const series = validCodes.value.map((code) => {
    const data = windowDates.value.map((date) => {
      const row = rowIndex.value.get(`${date}|${code}`);
      if (!row) return null;
      return {
        value: [date, isRate ? row.scoreRate : row.score],
        score: row.score,
        scoreRate: row.scoreRate,
        qualified: row.limitUp >= ROTATION_MIN_LIMIT_UP && row.scoreRate >= settingsStore.rotationMinScoreRate,
        backfilled: row.dataLevel === 0,
      } satisfies ScoreHistoryDatum;
    });
    return {
      name: nameByCode.value.get(code) ?? code,
      type: 'line',
      smooth: 0.3,
      symbol: 'circle',
      symbolSize: 5,
      connectNulls: true,
      lineStyle: { width: 2, color: colorOf(code) },
      itemStyle: { color: colorOf(code) },
      emphasis: { focus: 'series' },
      data,
    };
  });

  // 0 分参考线（多空平衡线）挂首条系列，避免每条线重复画
  if (series[0]) {
    (series[0] as Record<string, unknown>).markLine = {
      silent: true,
      symbol: 'none',
      label: { show: false },
      lineStyle: { color: colors.grid, type: 'dashed' },
      data: [{ yAxis: 0 }],
    };
  }

  return {
    animation: false,
    grid: { left: 46, right: 16, top: 24, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: colors.tooltipBg,
      borderColor: colors.grid,
      textStyle: { color: colors.text, fontSize: 11 },
      formatter: (params: unknown) => {
        const list = (params as Array<{ seriesName?: string; data?: ScoreHistoryDatum | null }>).filter(
          (item) => item.data !== null && item.data !== undefined,
        );
        if (list.length === 0) return '';
        const date = list[0]!.data!.value[0];
        return (
          `<b>${date}</b>` +
          list
            .map((item) => {
              const data = item.data!;
              const status = data.qualified ? '达标' : '未达标';
              const extra = data.backfilled ? ' · 回补日' : '';
              return (
                `<br/>${item.seriesName ?? '--'}：得分 ${data.score.toFixed(2)}` +
                `（得分率 ${data.scoreRate.toFixed(2)}）· ${status}${extra}`
              );
            })
            .join('')
        );
      },
    },
    xAxis: {
      type: 'category',
      data: windowDates.value,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: colors.grid } },
      axisLabel: { fontSize: 10, color: colors.muted, formatter: (value: string) => value.slice(5) },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { fontSize: 10, color: colors.muted },
      splitLine: { lineStyle: { color: colors.grid, type: 'dashed' } },
    },
    series,
  };
});
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <p class="text-[11px] leading-relaxed text-text-tertiary">
      bump 图只画每日上榜板块的名次切换，掉榜日线会断；这里按板块看完整得分走势
      （未上榜日照常取数）。曲线值可切「得分」或「得分率」。
    </p>

    <!-- 控制行：口径切换 + 展开/收起（范围档与页面题材轮动 Tabs 同步，面板内不重复提供） -->
    <div class="flex flex-wrap items-center gap-2">
      <BaseTabs v-model="metric" class="shrink-0" :options="[...metricOptions]" aria-label="曲线值口径" />
      <span class="text-[11px] text-text-tertiary">近{{ range }}日 · 与页面范围同步</span>
      <BaseButton
        variant="ghost"
        class="ml-auto !px-2 !py-1 text-xs"
        :title="pickerExpanded ? '收起选择器，只显示已选板块' : '展开完整板块池'"
        @click="pickerExpanded = !pickerExpanded"
      >
        <MenuIcon
          name="chevronDown"
          :size="12"
          :class="{ 'rotate-180 transition-transform': pickerExpanded }"
        />
        {{ pickerToggleLabel }}
      </BaseButton>
    </div>

    <!-- 已选计数 + 清空 -->
    <div class="flex items-center gap-2">
      <span class="text-[11px] tabular-nums text-text-tertiary">
        已选 {{ selectedCount }}/{{ ROTATION_SCORE_HISTORY_MAX }}（勾选记忆，下次打开恢复）
      </span>
      <BaseButton
        variant="ghost"
        class="ml-auto !px-2 !py-1 text-xs"
        :disabled="selectedCount === 0"
        @click="onClear"
      >
        清空
      </BaseButton>
    </div>

    <!-- 板块多选器（收起 = 只显示已选板块；满 8 个置灰） -->
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="board in visibleBoards"
        :key="board.code"
        type="button"
        class="pressable rounded-full border px-2.5 py-1 text-xs transition-colors"
        :class="
          validCodes.includes(board.code)
            ? 'font-bold'
            : isFull
              ? 'border-flat-weak text-text-tertiary opacity-50'
              : 'border-flat-weak text-text-secondary hover:border-primary hover:text-primary'
        "
        :style="validCodes.includes(board.code) ? { borderColor: colorOf(board.code), color: colorOf(board.code), background: `${colorOf(board.code)}1a` } : undefined"
        @click="onToggle(board.code)"
      >
        {{ board.name }}
      </button>
    </div>

    <!-- 得分曲线（无勾选 / 无数据兜底；宽度 100% 随面板拖宽自适应） -->
    <BaseEmpty v-if="boardPool.length === 0" text="暂无板块日历数据，请先同步板块数据" />
    <BaseEmpty
      v-else-if="validCodes.length === 0"
      :text="`请选择板块（最多 ${ROTATION_SCORE_HISTORY_MAX} 个）`"
    />
    <div v-else class="h-[min(420px,48dvh)] min-w-0">
      <BaseChart :options="chartOptions" not-merge />
    </div>
  </div>
</template>
