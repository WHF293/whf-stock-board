<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseTabs from '../../ui/BaseTabs.vue';
import MenuIcon from '../../ui/MenuIcon.vue';
import type {
  TzzbDayCalendar,
  TzzbMonthCalendar,
  TzzbYearPoint,
} from '../../../../common/types/tzzb.types.ts';

/**
 * 投资账本 · 盈亏日历（三级小方格下钻）
 *
 * - 日历（逐日格，queryDayCalendarSummary 按月）：◀▶ 切月，红涨绿跌弱底着色；
 * - 月历（12 个月格，queryMonthCalendarSummary 按年）：点击月份格下钻到该月日历；
 * - 年历（年份格）：点击年份格下钻到该年月历；
 * - 展示开关【收益 / 收益率 / 全部】（默认全部）：控制三种格子中金额与收益率的显隐；
 * - 右侧汇总栏随视图切换：日 = 当月汇总 + 最好/最差日 + 指数对比；
 *   月 = 年累计 + 最好/最差月；年 = 年度指标（含月度序列最大回撤）
 */
const props = defineProps<{
  /** 月视图数据（当前采样月） */
  dayCal: TzzbDayCalendar | null;
  /** 年视图数据（12 个月点） */
  monthCal: TzzbMonthCalendar | null;
  /** 年历聚合点 */
  yearPoints: TzzbYearPoint[];
}>();

const emit = defineEmits<{
  /** 日历切月（yyyyMM；父级按月重拉） */
  'day-month': [month: string];
  /** 月历切年（yyyy；父级按年重拉） */
  'month-year': [year: string];
}>();

const VIEW_OPTIONS = [
  { label: '日历', value: 'day' },
  { label: '月历', value: 'month' },
  { label: '年历', value: 'year' },
];

/** 当前视图 */
const view = ref<string>('day');

/** 格子展示模式：收益金额 / 收益率 / 全部（默认全部 = 同时显示） */
const SHOW_OPTIONS = [
  { label: '收益', value: 'profit' },
  { label: '收益率', value: 'rate' },
  { label: '全部', value: 'all' },
];
const showMode = ref<string>('all');

/** 是否显示收益金额（收益率独占时隐藏） */
const showProfit = computed(() => showMode.value !== 'rate');

/** 是否显示收益率（收益独占时隐藏） */
const showRate = computed(() => showMode.value !== 'profit');

/** 日历当前年月（初始取采样月） */
const dayY = ref(2026);
const dayM = ref(10);
watch(
  () => props.dayCal?.month,
  (m) => {
    if (!m) return;
    dayY.value = Number(m.slice(0, 4));
    dayM.value = Number(m.slice(4, 6));
  },
  { immediate: true },
);

/** 月历当前年 */
const monY = ref(2026);
watch(
  () => props.monthCal?.year,
  (y) => {
    if (y) monY.value = Number(y);
  },
  { immediate: true },
);

/** 采样截止年月（最新有数据月；来自日历数据） */
const lastMonth = computed(() => props.dayCal?.month ?? '202610');

/** 逐日盈亏 map（yyyyMMdd → 点） */
const dayMap = computed(() => {
  const map = new Map<string, { profit: number; rate: number }>();
  for (const d of props.dayCal?.days ?? []) map.set(d.date, d);
  return map;
});

/** 逐月盈亏 map（yyyyMM → 点） */
const monthMap = computed(() => {
  const map = new Map<string, { profit: number; rate: number }>();
  for (const m of props.monthCal?.months ?? []) map.set(m.month, m);
  return map;
});

/** 日历网格：周日开头（第一列周日，王总 2026-10-23 口径），含前导空格 */
const dayCells = computed(() => {
  const y = dayY.value;
  const m = dayM.value;
  const first = dayjs(`${y}-${String(m).padStart(2, '0')}-01`);
  const lead = first.day(); // dayjs day(): 0 = 周日
  const days = first.daysInMonth();
  const cells: { day: number | null; profit?: number; rate?: number }[] = [];
  for (let i = 0; i < lead; i += 1) cells.push({ day: null });
  for (let d = 1; d <= days; d += 1) {
    const key = `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
    const hit = dayMap.value.get(key);
    cells.push({ day: d, profit: hit?.profit, rate: hit?.rate });
  }
  return cells;
});

/** 当月有盈亏的日子（最好 / 最差） */
const dayExtremes = computed(() => {
  const list = (props.dayCal?.days ?? []).filter((d) => d.profit !== 0);
  if (list.length === 0) return null;
  return {
    best: list.reduce((a, b) => (b.profit > a.profit ? b : a)),
    worst: list.reduce((a, b) => (b.profit < a.profit ? b : a)),
  };
});

/** 月历 12 格模型 */
const monthCells = computed(() => {
  const y = monY.value;
  const last = lastMonth.value;
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const key = `${y}${String(m).padStart(2, '0')}`;
    const future = key > last;
    const hit = monthMap.value.get(key);
    return { month: m, future, profit: hit?.profit, rate: hit?.rate };
  });
});

/** 年视图选中年的月度明细（年度指标用） */
const yearDetail = computed(() => {
  const y = String(monY.value);
  return props.yearPoints.find((p) => p.year === y) ?? null;
});

/** 选中年的月度序列（来自 monthCal；用于月数统计与最大回撤） */
const yearMonths = computed(() => props.monthCal?.months ?? []);

/** 年度指标（盈利亏损月数 / 单月极值 / 盈亏比 / 月度序列最大回撤） */
const yearStats = computed(() => {
  const list = yearMonths.value.filter((m) => m.profit !== 0);
  if (list.length === 0) return null;
  const wins = list.filter((m) => m.profit > 0);
  const losses = list.filter((m) => m.profit < 0);
  const best = list.reduce((a, b) => (b.profit > a.profit ? b : a));
  const worst = list.reduce((a, b) => (b.profit < a.profit ? b : a));
  const gain = wins.reduce((s, m) => s + m.profit, 0);
  const loss = Math.abs(losses.reduce((s, m) => s + m.profit, 0));
  // 月度累计盈亏曲线对运行峰值的最大回撤（幅度口径）
  let peak = -Infinity;
  let maxDd = 0;
  let cum = 0;
  for (const m of yearMonths.value) {
    cum += m.profit;
    peak = Math.max(peak, cum);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - cum) / peak);
  }
  return {
    winCount: wins.length,
    lossCount: losses.length,
    best,
    worst,
    ratio: loss > 0 ? (gain / loss).toFixed(2) : '—',
    maxDd,
  };
});

/**
 * 千分位金额
 * @param v 数值
 * @returns 千分位两位小数文案
 */
const yuan = (v: number): string =>
  v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 带符号金额
 * @param v 数值
 * @returns 正值补 + 号的千分位文案
 */
const signYuan = (v: number): string => `${v > 0 ? '+' : ''}${yuan(v)}`;

/**
 * 盈亏文本色类
 * @param v 数值（undefined 视为无数据）
 * @returns 涨跌语义色类
 */
const plClass = (v: number | undefined): string =>
  v === undefined || v === 0
    ? 'text-flat'
    : v > 0
      ? 'text-up'
      : 'text-down';

/**
 * 盈亏格子底色类
 * @param v 数值（undefined 视为无数据）
 * @returns 涨跌弱底色类（无数据返回空串）
 */
const plBgClass = (v: number | undefined): string =>
  v === undefined || v === 0 ? '' : v > 0 ? 'bg-up-weak' : 'bg-down-weak';

/**
 * 切换日历月份
 * @param delta 月份偏移（±1）
 */
const shiftDayMonth = (delta: number): void => {
  const next = dayjs(`${dayY.value}-${String(dayM.value).padStart(2, '0')}-01`).add(delta, 'month');
  dayY.value = next.year();
  dayM.value = next.month() + 1;
  emit('day-month', `${dayY.value}${String(dayM.value).padStart(2, '0')}`);
};

/**
 * 切换月历年份
 * @param delta 年份偏移（±1）
 */
const shiftMonYear = (delta: number): void => {
  monY.value += delta;
  emit('month-year', String(monY.value));
};

/**
 * 月历格点击下钻到该月日历
 * @param month 月份 1~12
 */
const drillDay = (month: number): void => {
  dayY.value = monY.value;
  dayM.value = month;
  view.value = 'day';
  emit('day-month', `${dayY.value}${String(dayM.value).padStart(2, '0')}`);
};

/**
 * 年历格点击下钻到该年月历
 * @param year 年份 yyyy
 */
const drillYear = (year: string): void => {
  monY.value = Number(year);
  view.value = 'month';
  emit('month-year', String(monY.value));
};

/**
 * 日期显示（yyyyMMdd → MM-DD）
 * @param date 日期 yyyyMMdd
 * @returns MM-DD 文案
 */
const dayLabel = (date: string): string => `${date.slice(4, 6)}-${date.slice(6, 8)}`;
</script>

<template>
  <div class="flex flex-col gap-4 lg:flex-row lg:gap-5">
    <!-- 主区 -->
    <div class="min-w-0 flex-1">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <BaseTabs v-model="view" :options="VIEW_OPTIONS" />
        <BaseTabs v-model="showMode" :options="SHOW_OPTIONS" />
      </div>

      <!-- 日历视图 -->
      <div v-if="view === 'day'">
        <div class="mb-2 flex items-center gap-2">
          <button
            type="button"
            class="pressable rounded-md bg-flat-weak px-2 py-1 text-xs text-text-secondary hover:text-text active:scale-90"
            aria-label="上一月"
            @click="shiftDayMonth(-1)"
          >
            <MenuIcon name="chevronLeft" :size="14" />
          </button>
          <span class="text-sm font-semibold text-text">{{ dayY }} 年 {{ dayM }} 月</span>
          <button
            type="button"
            class="pressable rounded-md bg-flat-weak px-2 py-1 text-xs text-text-secondary hover:text-text active:scale-90"
            aria-label="下一月"
            @click="shiftDayMonth(1)"
          >
            <MenuIcon name="chevronRight" :size="14" />
          </button>
          <span class="text-xs text-text-tertiary">红涨绿跌 · 空格 = 非交易日 / 无数据</span>
        </div>
        <div class="grid grid-cols-7 gap-1.5">
          <span v-for="w in ['日', '一', '二', '三', '四', '五', '六']" :key="w" class="py-1 text-center text-xs text-text-tertiary">
            {{ w }}
          </span>
          <template v-for="(cell, i) in dayCells" :key="i">
            <div
              v-if="cell.day === null"
              class="min-h-16 rounded-lg"
            />
            <div
              v-else
              class="min-h-16 rounded-lg px-2 py-1.5"
              :class="[cell.profit ? plBgClass(cell.profit) : 'bg-flat-weak/50']"
            >
              <p class="font-mono text-xs text-text-tertiary">{{ cell.day }}</p>
              <template v-if="cell.profit">
                <p
                  v-if="showProfit"
                  class="mt-1 text-right font-mono text-xs font-semibold tabular-nums"
                  :class="plClass(cell.profit)"
                >
                  {{ signYuan(cell.profit) }}
                </p>
                <p
                  class="text-right font-mono tabular-nums"
                  :class="showProfit ? 'text-[10px] text-text-tertiary' : 'mt-1 text-xs font-semibold ' + plClass(cell.profit)"
                >
                  {{ ((cell.rate ?? 0) * 100).toFixed(2) }}%
                </p>
              </template>
            </div>
          </template>
        </div>
      </div>

      <!-- 月历视图 -->
      <div v-else-if="view === 'month'">
        <div class="mb-2 flex items-center gap-2">
          <button
            type="button"
            class="pressable rounded-md bg-flat-weak px-2 py-1 text-xs text-text-secondary hover:text-text active:scale-90"
            aria-label="上一年"
            @click="shiftMonYear(-1)"
          >
            <MenuIcon name="chevronLeft" :size="14" />
          </button>
          <span class="text-sm font-semibold text-text">{{ monY }} 年</span>
          <button
            type="button"
            class="pressable rounded-md bg-flat-weak px-2 py-1 text-xs text-text-secondary hover:text-text active:scale-90"
            aria-label="下一年"
            @click="shiftMonYear(1)"
          >
            <MenuIcon name="chevronRight" :size="14" />
          </button>
          <span class="text-xs text-text-tertiary">点击月份格下钻到该月「日历」</span>
        </div>
        <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
          <button
            v-for="cell in monthCells"
            :key="cell.month"
            type="button"
            class="min-h-20 rounded-lg px-3 py-2 text-left"
            :class="[
              cell.profit !== undefined ? `${plBgClass(cell.profit)} pressable` : 'bg-flat-weak/50',
            ]"
            :disabled="cell.profit === undefined"
            @click="cell.profit !== undefined && drillDay(cell.month)"
          >
            <p class="text-sm font-semibold" :class="cell.profit !== undefined ? 'text-text' : 'text-text-tertiary'">
              {{ cell.month }} 月
            </p>
            <p
              v-if="cell.profit !== undefined && showProfit"
              class="mt-1.5 font-mono text-base font-semibold tabular-nums"
              :class="plClass(cell.profit)"
            >
              {{ signYuan(cell.profit) }}
            </p>
            <p
              v-else-if="cell.profit !== undefined"
              class="mt-1.5 font-mono text-base font-semibold tabular-nums"
              :class="plClass(cell.profit)"
            >
              {{ ((cell.rate ?? 0) * 100).toFixed(2) }}%
            </p>
            <p v-else class="mt-1.5 text-xs text-text-tertiary">
              {{ cell.future ? '未至' : '无同步数据' }}
            </p>
            <p v-if="cell.profit !== undefined && showProfit && showRate" class="font-mono text-xs text-text-tertiary">
              {{ ((cell.rate ?? 0) * 100).toFixed(2) }}%
            </p>
          </button>
        </div>
      </div>

      <!-- 年历视图 -->
      <div v-else>
        <div class="mb-2 flex items-center gap-2">
          <span class="text-sm font-semibold text-text">全部年份</span>
          <span class="text-xs text-text-tertiary">点击年份格下钻到该年「月历」· 逐年拉取后前端聚合</span>
        </div>
        <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
          <template v-for="point in yearPoints" :key="point.year">
            <button
              type="button"
              class="min-h-20 rounded-lg px-3 py-2 text-left pressable"
              :class="plBgClass(point.profit)"
              @click="drillYear(point.year)"
            >
              <p class="text-sm font-semibold text-text">{{ point.year }} 年</p>
              <p
                v-if="showProfit"
                class="mt-1.5 font-mono text-base font-semibold tabular-nums"
                :class="plClass(point.profit)"
              >
                {{ signYuan(point.profit) }}
              </p>
              <p v-else class="mt-1.5 font-mono text-base font-semibold tabular-nums" :class="plClass(point.profit)">
                {{ (point.rate * 100).toFixed(2) }}%
              </p>
              <p v-if="showProfit && showRate" class="font-mono text-xs text-text-tertiary">
                {{ (point.rate * 100).toFixed(2) }}%
              </p>
            </button>
          </template>
          <div class="min-h-20 rounded-lg bg-flat-weak/50 px-3 py-2">
            <p class="text-sm font-semibold text-text-tertiary">更早</p>
            <p class="mt-1.5 text-xs text-text-tertiary">未同步</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧汇总栏（竖线分割；空态占位在栏内居中） -->
    <div class="flex w-full shrink-0 flex-col lg:w-72 lg:border-l lg:border-flat-weak lg:pl-5">
      <!-- 日视图侧栏 -->
      <template v-if="view === 'day'">
        <template v-if="dayCal && dayMap.size > 0">
          <h4 class="mb-1.5 text-xs text-text-tertiary">{{ dayY }}-{{ String(dayM).padStart(2, '0') }} 盈亏</h4>
          <div class="flex items-center justify-between py-1.5 text-sm">
            <span class="text-text-secondary">股票</span>
            <span class="font-mono font-medium tabular-nums" :class="plClass(dayCal.summary.stockProfit)">
              {{ signYuan(dayCal.summary.stockProfit) }}
            </span>
          </div>
          <div class="flex items-center justify-between py-1.5 text-sm">
            <span class="text-text-secondary">基金</span>
            <span class="font-mono font-medium tabular-nums" :class="plClass(dayCal.summary.fundProfit)">
              {{ signYuan(dayCal.summary.fundProfit) }}
            </span>
          </div>
          <div class="flex items-center justify-between border-t border-dashed border-flat-weak py-1.5 text-sm">
            <span class="text-text-secondary">合计</span>
            <span class="font-mono font-semibold tabular-nums" :class="plClass(dayCal.summary.total)">
              {{ signYuan(dayCal.summary.total) }}（{{ (dayCal.summary.rate * 100).toFixed(2) }}%）
            </span>
          </div>
          <template v-if="dayExtremes">
            <h4 class="mb-1.5 mt-3 text-xs text-text-tertiary">最好 / 最差</h4>
            <div class="flex items-center justify-between py-1 text-sm">
              <span class="text-text-secondary">最佳 {{ dayLabel(dayExtremes.best.date) }}</span>
              <span class="font-mono tabular-nums" :class="plClass(dayExtremes.best.profit)">
                {{ signYuan(dayExtremes.best.profit) }}
              </span>
            </div>
            <div class="flex items-center justify-between py-1 text-sm">
              <span class="text-text-secondary">最差 {{ dayLabel(dayExtremes.worst.date) }}</span>
              <span class="font-mono tabular-nums" :class="plClass(dayExtremes.worst.profit)">
                {{ signYuan(dayExtremes.worst.profit) }}
              </span>
            </div>
          </template>
          <h4 class="mb-1.5 mt-3 text-xs text-text-tertiary">本月指数对比</h4>
          <div class="grid grid-cols-2 gap-x-3">
            <div
              v-for="idx in dayCal.indexes"
              :key="idx.name"
              class="flex items-center justify-between py-0.5 text-xs"
            >
              <span class="text-text-secondary">{{ idx.name }}</span>
              <span class="font-mono tabular-nums" :class="plClass(idx.rate)">
                {{ (idx.rate > 0 ? '+' : '') + (idx.rate * 100).toFixed(2) }}%
              </span>
            </div>
          </div>
        </template>
        <BaseEmpty v-else class="flex-1" text="该月无同步数据：queryDayCalendarSummary 按月拉取（区间须覆盖整月）" />
      </template>

      <!-- 月视图侧栏 -->
      <template v-else-if="view === 'month'">
        <template v-if="(monthCal?.months.length ?? 0) > 0">
          <h4 class="mb-1.5 text-xs text-text-tertiary">{{ monY }} 年累计</h4>
          <div class="flex items-center justify-between py-1.5 text-sm">
            <span class="text-text-secondary">合计</span>
            <span
              class="font-mono font-semibold tabular-nums"
              :class="plClass(yearDetail?.profit)"
            >
              {{ signYuan(yearDetail?.profit ?? 0) }}（{{ ((yearDetail?.rate ?? 0) * 100).toFixed(2) }}%）
            </span>
          </div>
          <h4 class="mb-1.5 mt-3 text-xs text-text-tertiary">最好 / 最差月份</h4>
          <template v-if="yearStats">
            <div class="flex items-center justify-between py-1 text-sm">
              <span class="text-text-secondary">最佳 {{ yearStats.best.month.slice(4, 6) }} 月</span>
              <span class="font-mono tabular-nums" :class="plClass(yearStats.best.profit)">
                {{ signYuan(yearStats.best.profit) }}
              </span>
            </div>
            <div class="flex items-center justify-between py-1 text-sm">
              <span class="text-text-secondary">最差 {{ yearStats.worst.month.slice(4, 6) }} 月</span>
              <span class="font-mono tabular-nums" :class="plClass(yearStats.worst.profit)">
                {{ signYuan(yearStats.worst.profit) }}
              </span>
            </div>
          </template>
          <p class="mt-3 text-xs leading-5 text-text-tertiary">◀ ▶ 切换年份；点击月份格下钻到该月日历。</p>
        </template>
        <BaseEmpty v-else class="flex-1" :text="`${monY} 年无同步数据（同步水位始于 2025-09-30）`" />
      </template>

      <!-- 年视图侧栏 -->
      <template v-else>
        <template v-if="yearStats">
          <h4 class="mb-1.5 text-xs text-text-tertiary">{{ monY }} 年度指标</h4>
          <div class="flex items-center justify-between py-1.5 text-sm">
            <span class="text-text-secondary">年度总盈亏</span>
            <span class="font-mono font-semibold tabular-nums" :class="plClass(yearDetail?.profit)">
              {{ signYuan(yearDetail?.profit ?? 0) }}（{{ ((yearDetail?.rate ?? 0) * 100).toFixed(2) }}%）
            </span>
          </div>
          <div class="flex items-center justify-between py-1.5 text-sm">
            <span class="text-text-secondary">盈利 / 亏损月份</span>
            <span class="font-mono tabular-nums text-text">
              {{ yearStats.winCount }} / {{ yearStats.lossCount }}
            </span>
          </div>
          <div class="flex items-center justify-between py-1.5 text-sm">
            <span class="text-text-secondary">单月最高</span>
            <span class="font-mono tabular-nums" :class="plClass(yearStats.best.profit)">
              {{ signYuan(yearStats.best.profit) }}（{{ yearStats.best.month.slice(4, 6) }} 月）
            </span>
          </div>
          <div class="flex items-center justify-between py-1.5 text-sm">
            <span class="text-text-secondary">单月最低</span>
            <span class="font-mono tabular-nums" :class="plClass(yearStats.worst.profit)">
              {{ signYuan(yearStats.worst.profit) }}（{{ yearStats.worst.month.slice(4, 6) }} 月）
            </span>
          </div>
          <div class="flex items-center justify-between py-1.5 text-sm">
            <span class="text-text-secondary">盈亏比</span>
            <span class="font-mono tabular-nums text-text">{{ yearStats.ratio }}</span>
          </div>
          <div class="flex items-center justify-between py-1.5 text-sm">
            <span class="text-text-secondary">年度最大回撤</span>
            <span class="font-mono font-semibold tabular-nums text-down">
              -{{ (yearStats.maxDd * 100).toFixed(1) }}%
            </span>
          </div>
        </template>
        <BaseEmpty v-else class="flex-1" text="该年无月度数据，同步补齐历史后自动填充" />
      </template>
    </div>
  </div>
</template>
