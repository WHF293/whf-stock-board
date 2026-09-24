<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import {
  BOARD_PROFIT_BUBBLE,
  BOARD_PROFIT_METRIC,
  BOARD_PROFIT_METRIC_DEFAULT,
  BOARD_PROFIT_METRIC_OPTIONS,
  BOARD_SCORE_BUCKET,
  BOARD_SCORE_LEGEND,
} from '../../constants/board-calendar.constants';
import type {
  BoardDailyRow,
  BoardProfitMetric,
  BoardScoreBucket,
} from '../../types/board-calendar.types';
import {
  getBoardBucketBackground,
  getBoardBucketTextColor,
  resolveBoardScoreBucket,
} from '../../utils/board-score-colors';
import { layoutBubbles } from '../../utils/bubble-layout';
import type { BubbleLayoutOptions, BubbleLayoutNode } from '../../utils/bubble-layout';
import { formatYuan } from '../../utils/format-yuan';

/**
 * 赚钱效应气泡图（最新一个交易日的板块得分，内嵌于板块日历页主区）
 *
 * 编码口径（三条通道各司其职）：
 * - **横向位置 + 面积**：|口径值| 越大越靠「值域边缘」、气泡越大 →
 *   一眼看出哪些行业赚钱效应最强 / 亏钱效应最重；
 * - **颜色**：7 档涨跌语义色，**恒按得分率判定**（与表格色阶同一口径），
 *   正得分为涨色、负得分为跌色，绝对值越档位越深；
 * - 布局是纯几何计算（`utils/bubble-layout.ts`），本组件只负责取数与交互；
 *   画布高度固定为「得分率 / 原始得分」两口径适配高度的公共值，切换口径不跳高。
 *
 * 数据口径见 `.ai/开发方案/2026-09-14-板块日历与赚钱效应开发方案.md`。
 */

const props = defineProps<{
  /** 该交易日全部板块的日聚合行（不受页面「板块过滤器」影响） */
  rows: BoardDailyRow[];
  /** 数据日期（YYYY-MM-DD） */
  tradeDate: string;
  /** 该日是否为完整快照（false = 仅回补到涨跌停，无涨跌家数 → 不参与色阶） */
  isFullSnapshot: boolean;
}>();

/** 面积 / 横向位置口径（默认得分率：跨板块可比） */
const metric = ref<BoardProfitMetric>(BOARD_PROFIT_METRIC_DEFAULT);
/** 悬停中的板块代码 */
const hoveredKey = ref<string | null>(null);
/** 悬停指针的视口坐标（悬停卡片用） */
const pointer = ref<{ x: number; y: number } | null>(null);

/** 悬停卡片尺寸（用于贴边翻转，避免溢出视口） */
const TOOLTIP_WIDTH = 252;
const TOOLTIP_HEIGHT = 178;

/**
 * 口径取值
 * @param row 板块日聚合行
 * @param target 口径
 * @returns 该口径下的数值
 */
const valueOfMetric = (row: BoardDailyRow, target: BoardProfitMetric): number =>
  target === BOARD_PROFIT_METRIC.SCORE ? row.score : row.scoreRate;

/**
 * 口径取值（当前选中口径）
 * @param row 板块日聚合行
 * @returns 当前口径下的数值
 */
const valueOf = (row: BoardDailyRow): number => valueOfMetric(row, metric.value);

/** 当前口径展示名 */
const metricLabel = computed<string>(
  () =>
    BOARD_PROFIT_METRIC_OPTIONS.find((item) => item.value === metric.value)?.label ?? '',
);

/**
 * 带符号数值文案
 * @param value 数值
 * @param digits 小数位
 * @returns 形如 `+3.84` / `-4.41` / `0` 的文案
 */
const formatSigned = (value: number, digits: number): string =>
  `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;

/**
 * 气泡内数值文案（原始得分取整、得分率两位小数）
 * @param value 当前口径数值
 * @returns 数值文案
 */
const formatMetricValue = (value: number): string =>
  formatSigned(value, metric.value === BOARD_PROFIT_METRIC.SCORE ? 0 : 2);

/**
 * 板块当日色阶档位
 *
 * 回补日（非完整快照）按项目口径**不上色**，统一压成平盘档（灰），
 * 避免用「只有涨跌停推导出的得分」冒充完整口径的涨跌语义。
 * @param row 板块日聚合行
 * @returns 色阶档位
 */
const bucketOf = (row: BoardDailyRow): BoardScoreBucket =>
  props.isFullSnapshot
    ? resolveBoardScoreBucket(row.scoreRate)
    : BOARD_SCORE_BUCKET.FLAT;

/** 代码 → 原始行（悬停卡片回查明细） */
const rowByKey = computed<Map<string, BoardDailyRow>>(
  () => new Map(props.rows.map((row) => [row.boardCode, row])),
);

/** 代码 → 档位 */
const bucketByKey = computed<Map<string, BoardScoreBucket>>(
  () => new Map(props.rows.map((row) => [row.boardCode, bucketOf(row)])),
);

/** 气泡视图模型（布局节点 + 色阶档位） */
interface BubbleView extends BubbleLayoutNode {
  /** 色阶档位 */
  bucket: BoardScoreBucket;
}

/** 布局参数（常量为 UPPER_SNAKE 键，这里按 BubbleLayoutOptions 显式映射，避免键名对不上） */
const layoutOptions = computed<BubbleLayoutOptions>(() => ({
  width: BOARD_PROFIT_BUBBLE.WIDTH,
  minHeight: BOARD_PROFIT_BUBBLE.MIN_HEIGHT,
  maxHeight: BOARD_PROFIT_BUBBLE.MAX_HEIGHT,
  minRadius: BOARD_PROFIT_BUBBLE.MIN_RADIUS,
  maxRadius: BOARD_PROFIT_BUBBLE.MAX_RADIUS,
  minFitRadius: BOARD_PROFIT_BUBBLE.MIN_FIT_RADIUS,
  gap: BOARD_PROFIT_BUBBLE.GAP,
  topPadding: BOARD_PROFIT_BUBBLE.TOP_PADDING,
  bottomPadding: BOARD_PROFIT_BUBBLE.BOTTOM_PADDING,
  stackStep: BOARD_PROFIT_BUBBLE.STACK_STEP,
  nameFontSize: BOARD_PROFIT_BUBBLE.NAME_FONT_SIZE,
  valueFontSize: BOARD_PROFIT_BUBBLE.VALUE_FONT_SIZE,
  tickCount: BOARD_PROFIT_BUBBLE.TICK_COUNT,
  formatValue: formatMetricValue,
}));

/**
 * 指定口径下的气泡输入项
 * @param target 口径
 * @returns 布局输入（key / 名称 / 数值）
 */
const itemsOf = (target: BoardProfitMetric) =>
  props.rows.map((row) => ({
    key: row.boardCode,
    name: row.boardName,
    value: valueOfMetric(row, target),
  }));

/**
 * 两口径的公共画布高度：各自按 MAX_HEIGHT 收缩适配后取最大值。
 * 切换口径时画布高度恒等于它（切换视图不跳变）；病态数据收缩到下限
 * 仍超高时取实际最大值，两口径仍一致（图内滚动兜底）
 */
const commonHeight = computed(() => {
  // formatValue 换成空实现：泡内文案不参与几何，避免本 computed 经闭包依赖 metric
  const heights = [BOARD_PROFIT_METRIC.SCORE, BOARD_PROFIT_METRIC.SCORE_RATE].map((target) =>
    layoutBubbles(itemsOf(target), { ...layoutOptions.value, formatValue: () => '' }).height,
  );
  return Math.ceil(Math.max(...heights));
});

/** 布局结果（口径切换时自动重算，画布高度固定为两口径公共值） */
const layout = computed(() =>
  layoutBubbles(itemsOf(metric.value), {
    ...layoutOptions.value,
    fixedHeight: commonHeight.value,
  }),
);

/** 渲染用气泡（含颜色） */
const bubbles = computed<BubbleView[]>(() =>
  layout.value.nodes.map((node) => ({
    ...node,
    bucket: bucketByKey.value.get(node.key) ?? BOARD_SCORE_BUCKET.NONE,
  })),
);

/** 悬停气泡 */
const hoveredBubble = computed<BubbleView | null>(
  () => bubbles.value.find((item) => item.key === hoveredKey.value) ?? null,
);

/** 悬停行的原始明细 */
const hoveredRow = computed<BoardDailyRow | null>(() =>
  hoveredKey.value === null ? null : (rowByKey.value.get(hoveredKey.value) ?? null),
);

/** 悬停档位文案（强多 / 偏空 …） */
const hoveredBucketLabel = computed<string>(
  () =>
    BOARD_SCORE_LEGEND.find((item) => item.bucket === hoveredBubble.value?.bucket)?.label ??
    '',
);

/** 极值两端（口径最高 / 最低的板块） */
const extremes = computed<{ top: BoardDailyRow; bottom: BoardDailyRow } | null>(() => {
  if (props.rows.length === 0) return null;
  const sorted = [...props.rows].sort((a, b) => valueOf(b) - valueOf(a));
  return { top: sorted[0], bottom: sorted[sorted.length - 1] };
});

/**
 * 气泡填充色
 * @param bucket 色阶档位
 * @returns CSS 颜色值（`var(--color-*)`，随主题与涨跌配色自动变化）
 */
const fillOf = (bucket: BoardScoreBucket): string => getBoardBucketBackground(bucket);

/**
 * 气泡内文字色
 * @param bucket 色阶档位
 * @returns CSS 颜色值（深档白字 / 浅档深字）
 */
const textOf = (bucket: BoardScoreBucket): string => getBoardBucketTextColor(bucket);

/** 悬停卡片位置（贴边时翻转到指针另一侧；无悬停时挪出视口隐藏） */
const tooltipStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {
    visibility: 'hidden',
    left: '-9999px',
    top: '-9999px',
  };
  const point = pointer.value;
  if (point !== null) {
    const left =
      point.x + 16 + TOOLTIP_WIDTH > window.innerWidth
        ? Math.max(8, point.x - TOOLTIP_WIDTH - 16)
        : point.x + 16;
    const top =
      point.y + 16 + TOOLTIP_HEIGHT > window.innerHeight
        ? Math.max(8, point.y - TOOLTIP_HEIGHT - 16)
        : point.y + 16;
    style.visibility = 'visible';
    style.left = `${left}px`;
    style.top = `${top}px`;
  }
  return style;
});

/** 无障碍描述 */
const ariaLabel = computed<string>(
  () =>
    `${props.tradeDate} 板块赚钱效应气泡图：共 ${props.rows.length} 个板块，` +
    `气泡面积与横轴位置按${metricLabel.value}绝对值放大，颜色为涨跌语义色阶。`,
);

/**
 * 进入气泡：记录悬停目标与指针位置
 * @param key 板块代码
 * @param event 鼠标事件
 */
const onEnter = (key: string, event: MouseEvent): void => {
  hoveredKey.value = key;
  pointer.value = { x: event.clientX, y: event.clientY };
};

/**
 * 在气泡内移动：跟随指针
 * @param event 鼠标事件
 */
const onMove = (event: MouseEvent): void => {
  pointer.value = { x: event.clientX, y: event.clientY };
};

/** 离开气泡：清除悬停 */
const onLeave = (): void => {
  hoveredKey.value = null;
  pointer.value = null;
};
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <!-- 口径切换 + 概要 -->
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <BaseTabs
        :model-value="metric"
        :options="BOARD_PROFIT_METRIC_OPTIONS"
        @update:model-value="metric = $event as BoardProfitMetric"
      />
      <p class="text-xs text-text-tertiary">
        {{ tradeDate || '暂无数据' }} · 共 {{ rows.length }} 个板块（不受「板块过滤器」影响）
        <template v-if="extremes">
          · 最高 <span class="text-text-secondary">{{ extremes.top.boardName }}</span>
          <span class="tabular-nums">{{ formatMetricValue(valueOf(extremes.top)) }}</span>
          · 最低 <span class="text-text-secondary">{{ extremes.bottom.boardName }}</span>
          <span class="tabular-nums">{{ formatMetricValue(valueOf(extremes.bottom)) }}</span>
        </template>
      </p>
    </div>

    <!-- 回补日提示：只有涨跌停数据，颜色语义不可用 -->
    <p v-if="!isFullSnapshot && rows.length > 0" class="text-xs text-down" role="alert">
      该日仅有回补数据（板块级涨跌家数无历史接口），得分只由涨跌停推导，
      颜色统一按中性展示，仅面积可用于横向比较。
    </p>

    <BaseEmpty v-if="rows.length === 0" text="暂无板块得分数据，请先采集" />

    <!-- 气泡画布：吃掉面板剩余高度，svg preserveAspectRatio 等比缩放适配容器
         （宽屏横向撑满、矮屏整图等比缩小），任何数据下都不出现滚动条 -->
    <div v-else class="relative min-h-0 flex-1">
      <svg
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        class="block h-full w-full select-none"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        :aria-label="ariaLabel"
        @mouseleave="onLeave"
      >
        <!-- 0 值分界线：左侧跌色区、右侧涨色区 -->
        <line
          v-if="layout.zeroX !== null"
          :x1="layout.zeroX"
          :y1="0"
          :x2="layout.zeroX"
          :y2="layout.baselineY"
          :style="{ stroke: 'var(--color-flat-weak)' }"
          stroke-width="1"
          stroke-dasharray="5 5"
        />
        <!-- 基线 -->
        <line
          :x1="layout.axisStartX"
          :y1="layout.baselineY"
          :x2="layout.axisEndX"
          :y2="layout.baselineY"
          :style="{ stroke: 'var(--color-flat)' }"
          stroke-width="1"
        />
        <!-- 刻度 -->
        <g v-for="tick in layout.ticks" :key="tick.value">
          <line
            :x1="tick.x"
            :y1="layout.baselineY"
            :x2="tick.x"
            :y2="layout.baselineY + 5"
            :style="{ stroke: 'var(--color-flat)' }"
            stroke-width="1"
          />
          <text
            :x="tick.x"
            :y="layout.baselineY + 21"
            text-anchor="middle"
            :font-size="11"
            :style="{ fill: 'var(--color-text-tertiary)' }"
          >
            {{ tick.label }}
          </text>
        </g>

        <!-- 气泡 -->
        <g
          v-for="bubble in bubbles"
          :key="bubble.key"
          :opacity="hoveredKey === null || hoveredKey === bubble.key ? 1 : 0.45"
          :class="hoveredKey === bubble.key ? 'cursor-default' : 'cursor-pointer'"
          @mouseenter="onEnter(bubble.key, $event)"
          @mousemove="onMove"
          @mouseleave="onLeave"
        >
          <circle
            :cx="bubble.cx"
            :cy="bubble.cy"
            :r="bubble.r"
            :style="{
              fill: fillOf(bubble.bucket),
              stroke: hoveredKey === bubble.key ? 'var(--color-text)' : 'var(--color-surface)',
            }"
            :stroke-width="hoveredKey === bubble.key ? 2.5 : 1.5"
          />
          <text
            v-for="line in bubble.labels"
            :key="line.text"
            :x="bubble.cx"
            :y="bubble.cy + line.dy"
            text-anchor="middle"
            dominant-baseline="central"
            pointer-events="none"
            :font-size="line.fontSize"
            :font-weight="line.fontSize === BOARD_PROFIT_BUBBLE.NAME_FONT_SIZE ? 600 : 400"
            :style="{ fill: textOf(bubble.bucket) }"
          >
            {{ line.text }}
          </text>
        </g>
      </svg>

      <!-- 悬停明细卡片（Teleport 到 body 的 fixed 定位，不被页面滚动区裁切） -->
      <Teleport to="body">
        <div
          v-if="hoveredRow && hoveredBubble && pointer"
          class="pointer-events-none fixed z-[60] rounded-xl border border-flat-weak bg-surface p-3 shadow-xl"
          :style="tooltipStyle"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="truncate text-sm font-semibold text-text">
              {{ hoveredRow.boardName }}
            </span>
            <span class="shrink-0 text-[10px] text-text-tertiary">
              {{ hoveredRow.boardCode }}
            </span>
          </div>
          <div class="mt-1.5 flex items-center gap-2">
            <span class="text-base font-semibold tabular-nums text-text">
              {{ formatSigned(hoveredRow.score, 0) }}
            </span>
            <span
              class="rounded px-1.5 py-0.5 text-[10px] font-medium"
              :style="{
                background: fillOf(hoveredBubble.bucket),
                color: textOf(hoveredBubble.bucket),
              }"
            >
              {{ hoveredBucketLabel }}
            </span>
          </div>
          <p class="mt-0.5 text-[11px] text-text-secondary">
            得分率 <span class="tabular-nums">{{ formatSigned(hoveredRow.scoreRate, 2) }}</span>
          </p>
          <div class="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 text-[11px]">
            <span class="text-text-tertiary">
              涨停 <b class="tabular-nums text-text">{{ hoveredRow.limitUp }}</b>
            </span>
            <span class="text-text-tertiary">
              跌停 <b class="tabular-nums text-text">{{ hoveredRow.limitDown }}</b>
            </span>
            <span class="text-text-tertiary">
              成分 <b class="tabular-nums text-text">{{ hoveredRow.consCount }}</b>
            </span>
            <span class="text-text-tertiary">
              上涨 <b class="tabular-nums text-text">{{ hoveredRow.upCount }}</b>
            </span>
            <span class="text-text-tertiary">
              下跌 <b class="tabular-nums text-text">{{ hoveredRow.downCount }}</b>
            </span>
            <span class="text-text-tertiary">
              平盘 <b class="tabular-nums text-text">{{ hoveredRow.flatCount }}</b>
            </span>
          </div>
          <p class="mt-1.5 text-[11px] text-text-tertiary">
            成交额 {{ formatYuan(hoveredRow.amount) }}
          </p>
        </div>
      </Teleport>
    </div>

    <!-- 图例 -->
    <div v-if="rows.length > 0" class="space-y-1.5 text-[10px] text-text-tertiary">
      <p>
        面积 ∝ |{{ metricLabel }}|：泡越大赚钱 / 亏钱效应越强；横轴为{{ metricLabel }}，
        左半区（跌色）= 亏钱效应，右半区（涨色）= 赚钱效应。
        <span v-if="metric === BOARD_PROFIT_METRIC.SCORE_RATE">
          得分率 = 得分 ÷ 成分股数，避免板块体量差异（银行 42 只 vs 医药生物 511 只）
          让大板块永远最大。
        </span>
        <span v-else>原始得分 = 涨停×10 + 跌停×-10 + 净上涨×5 + 净下跌×-5，绝对值受板块体量影响。</span>
      </p>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>颜色恒按得分率取 7 档涨跌语义色（与表格色阶同口径）：</span>
        <span
          v-for="item in BOARD_SCORE_LEGEND"
          :key="item.bucket"
          class="flex items-center gap-1"
        >
          <i class="inline-block h-3 w-3 rounded-sm" :style="{ background: fillOf(item.bucket) }" />
          {{ item.label }} {{ item.hint }}
        </span>
      </div>
      <p>泡内放不下文字的板块（得分趋 0）请悬停查看明细。</p>
    </div>
  </div>
</template>
