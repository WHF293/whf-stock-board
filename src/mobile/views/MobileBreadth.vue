<script setup lang="ts">
/**
 * 市场广度指标（2026-10-21 新增二级页，入口在首页金刚区；PC MarketBreadthView 的移动版）
 *
 * 内容与 PC 一致：五大市场广度指标副图组（ADL / ADR / OBOS / ARMS / MCO），基于本地
 * 积累的日 bar（readBreadthBars）经 computeBreadthIndicatorSeries 离线计算，五指标
 * 全部零上游请求；当日概览读当日分钟点最后一点。
 *
 * 数据生产：与 PC 同一前提——ingest 必须有人负责。移动端首页 / 行情页的快照轮询
 * 只在对应页面活跃时跑，停留本页期间快照无人 ingest，因此本页自带一路
 * useMobilePolling（前台生效、按用户设置的移动端轮询间隔），活跃时由本页负责。
 *
 * 移动端适配：无 hover → 指标说明改为「点击卡头展开/收起」；图表用 MobileEChart
 * （SVG 渲染器，暗色切换重建实例）；副图高度 180px，grid 收紧 + containLabel。
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useDark } from '@vueuse/core';
import type { EChartsCoreOption } from 'echarts/core';
import {
  ARMS_NEUTRAL_LINE,
  BREADTH_ADL_MA_PERIOD,
  BREADTH_ARMS_MA_PERIOD,
  BREADTH_ADR_OVERBOUGHT,
  BREADTH_ADR_OVERSOLD,
  BREADTH_INDICATOR_INFO,
  BREADTH_INDICATOR_KIND,
  BREADTH_INDICATOR_VIEW,
  BREADTH_INDICATOR_VIEW_DAYS,
  BREADTH_INDICATOR_VIEW_OPTIONS,
  BREADTH_MCO_OVERBOUGHT,
  BREADTH_MCO_OVERSOLD,
  type BreadthIndicatorKind,
  type BreadthIndicatorViewKey,
} from '../../common/constants/market-breadth.constants.ts';
import { CHART_AXIS_LINE_COLOR, CHART_LINE_BLUE, CHART_LINE_TEAL } from '../../common/constants/chart.constants.ts';
import type { BreadthDayBar, BreadthPoint } from '../../common/types/market-breadth.types.ts';
import { fetchAllMarketQuotes } from '../../common/api/quotes.api.ts';
import { ingestBreadthSnapshot, readBreadthBars, readBreadthDay } from '../../common/api/market-breadth-db.api';
import { computeBreadthIndicatorSeries } from '../../common/utils/compute-breadth-indicators';
import { classifyArms, type ArmsStateResult } from '../../common/utils/classify-arms';
import { readTrendColors } from '../../common/utils/trend-colors';
import { toDayKey } from '../../common/utils/to-day-key';
import { useMobilePolling } from '../composables/use-mobile-polling';
import MobileEChart from '../components/MobileEChart.vue';

const router = useRouter();

/** MCO 趋稳所需参考积累天数（EMA39 + 信号线预热，与 PC 同值） */
const MCO_READY_DAYS = 50;

/** 单张副图高度（px；移动端 5 张纵向排布，比 PC 略矮） */
const CHART_HEIGHT = 180;

/** 视图档位（近 60 / 120 日 / 全部积累） */
const view = ref<BreadthIndicatorViewKey>(BREADTH_INDICATOR_VIEW.ALL);

/** 日 bar 序列（appStorage 读取，日期升序） */
const bars = ref<BreadthDayBar[]>([]);

/** 当日分钟点序列（取最后一点作当日概览） */
const todaySeries = ref<BreadthPoint[]>([]);

/** 从本地库刷新（含日 bar 与当日分钟点） */
const refreshFromLocal = (): void => {
  bars.value = readBreadthBars();
  todaySeries.value = readBreadthDay(toDayKey(Date.now()));
};

/**
 * 拉一轮全市场快照并 ingest（生产分钟点 / 定稿日 bar），随后重读本地库
 */
const fetchAndIngest = async (): Promise<void> => {
  try {
    const quotes = await fetchAllMarketQuotes();
    ingestBreadthSnapshot(quotes);
    refreshFromLocal();
  } catch (error) {
    console.warn('[mobile-breadth] snapshot ingest failed', error);
  }
};

/** 下拉刷新（van-pull-refresh 入口；结束态由 refreshing 控制） */
const refreshing = ref(false);
const onRefresh = async (): Promise<void> => {
  refreshing.value = true;
  await fetchAndIngest();
  refreshing.value = false;
};

/** 前台轮询（间隔跟随移动端设置档位；useMobilePolling 内部处理可见性与重排） */
useMobilePolling(fetchAndIngest);

/** 五指标序列（随 bars 全量重算，250 bar 量级毫秒级完成） */
const series = computed(() => computeBreadthIndicatorSeries(bars.value));

/** 已积累交易日数 */
const accumDays = computed(() => bars.value.length);

/** 当日概览（当日最后一个分钟点；无采样为 null） */
const todayPoint = computed<BreadthPoint | null>(() => todaySeries.value.at(-1) ?? null);

/** ARMS 现值五档状态（null 显「--」） */
const armsState = computed<ArmsStateResult | null>(() => classifyArms(todayPoint.value?.arms ?? null));

/**
 * 序列内最后一个非 null 值（副图标题行的「最新值」）
 * @param values 指标序列
 * @returns 最新值；全空为 null
 */
const lastValue = (values: ReadonlyArray<number | null>): number | null => {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (value !== null) return value;
  }
  return null;
};

/** 各副图最新值文案（null 显「--」） */
const latest = computed(() => ({
  adl: lastValue(series.value.adl),
  adr: lastValue(series.value.adr),
  obos: lastValue(series.value.obos),
  armsMa: lastValue(series.value.armsMa),
  mco: lastValue(series.value.mco),
}));

/**
 * 数值 → 展示文案（千分位或两位小数；null 显「--」）
 * @param value 数值
 * @param digits 小数位
 * @returns 文案
 */
const fmt = (value: number | null, digits = 2): string =>
  value === null
    ? '--'
    : Math.abs(value) >= 1000
      ? value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
      : value.toFixed(digits);

/** ADR/OBOS 是否达标准口径周期 */
const adrReady = computed(() => accumDays.value >= 10);

/** ARMS 平滑均线是否达惯例周期 */
const armsMaReady = computed(() => accumDays.value >= BREADTH_ARMS_MA_PERIOD);

/** MCO 是否过预热期（约 50 日，参考值） */
const mcoReady = computed(() => accumDays.value >= MCO_READY_DAYS);

/** 就绪徽标（副图上方一行小字，与 PC readinessBadges 同源口径） */
const readinessBadges = computed(() => [
  { label: `ADR/OBOS ${adrReady.value ? '已就绪' : `积累中 ${accumDays.value}/10`}`, ok: adrReady.value },
  { label: `ARMS MA${BREADTH_ARMS_MA_PERIOD} ${armsMaReady.value ? '已就绪' : `积累中 ${accumDays.value}/${BREADTH_ARMS_MA_PERIOD}`}`, ok: armsMaReady.value },
  { label: `MCO ${mcoReady.value ? '已趋稳' : `预热中 ${accumDays.value}/${MCO_READY_DAYS}`}`, ok: mcoReady.value },
]);

/** 窗口内是否无任何数据（整页空态判定） */
const isPageEmpty = computed(() => series.value.dates.length === 0);

/** 当前展开说明的指标（再次点击收起；移动端无 hover，说明走点击展开） */
const expandedKind = ref<BreadthIndicatorKind | null>(null);

/**
 * 展开 / 收起指标说明
 * @param kind 指标 kind
 */
const toggleInfo = (kind: BreadthIndicatorKind): void => {
  expandedKind.value = expandedKind.value === kind ? null : kind;
};

/**
 * 指标说明文本（公式 + 意义，两段分行展示）
 * @param kind 指标 kind
 * @returns [公式, 意义]
 */
const infoParts = (kind: BreadthIndicatorKind): [string, string] => {
  const info = BREADTH_INDICATOR_INFO[kind];
  return [info.formula, info.meaning];
};

// ---------- 副图 option 构建（与 PC BreadthIndicatorChart 同逻辑，尺寸口径按移动端收紧） ----------

const isDark = useDark();

/** 视图窗口切片下标起点（全部积累时为 0） */
const startIndex = computed(() => {
  const days = BREADTH_INDICATOR_VIEW_DAYS[view.value];
  return days === undefined ? 0 : Math.max(0, series.value.dates.length - days);
});

/** 窗口内日期标签（MM-DD） */
const dateLabels = computed(() => series.value.dates.slice(startIndex.value).map((date) => date.slice(5)));

/**
 * 数组窗口切片（null / 对象项均保留）
 * @param values 完整序列
 * @returns 窗口内切片
 */
const sliceSeries = <T>(values: T[]): T[] => values.slice(startIndex.value);

/**
 * 移动端公共骨架：紧凑 grid（containLabel 自适应轴宽）+ 日期类 x 轴 + 单值 y 轴
 * @returns ECharts 公共骨架（xAxis boundaryGap 由各指标按需覆盖）
 */
const buildBase = () => ({
  grid: { left: 4, right: 8, top: 14, bottom: 4, containLabel: true },
  tooltip: { trigger: 'axis', axisPointer: { type: 'line' } },
    xAxis: {
      type: 'category',
      data: dateLabels.value,
      boundaryGap: false,
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisLabel: { fontSize: 9 },
      axisTick: { show: false },
    },
  yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 9 } },
});

/** ADL：面积线 + MA 虚线 */
const adlOption = computed<EChartsCoreOption>(() => {
  void isDark.value;
  const trend = readTrendColors();
  const base = buildBase();
  return {
    ...base,
    xAxis: { ...base.xAxis, boundaryGap: false },
    series: [
      {
        name: 'ADL',
        type: 'line',
        data: sliceSeries(series.value.adl),
        connectNulls: false,
        symbol: 'none',
        lineStyle: { color: CHART_LINE_BLUE, width: 1.6 },
        areaStyle: { color: CHART_LINE_BLUE, opacity: 0.08 },
      },
      {
        name: 'ADL 均线',
        type: 'line',
        data: sliceSeries(series.value.adlMa),
        connectNulls: false,
        symbol: 'none',
        lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
      },
    ],
  };
});

/** ADR：线 + 超买 1.5 / 平衡 1.0 / 超卖 0.5 参考线 */
const adrOption = computed<EChartsCoreOption>(() => {
  void isDark.value;
  const trend = readTrendColors();
  const base = buildBase();
  return {
    ...base,
    xAxis: { ...base.xAxis, boundaryGap: false },
    series: [
      {
        name: 'ADR',
        type: 'line',
        data: sliceSeries(series.value.adr),
        connectNulls: false,
        symbol: 'none',
        lineStyle: { color: CHART_LINE_TEAL, width: 1.6 },
        itemStyle: { color: CHART_LINE_TEAL },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { fontSize: 9 },
          data: [
            {
              yAxis: BREADTH_ADR_OVERBOUGHT,
              label: { color: trend.down, formatter: `超买 ${BREADTH_ADR_OVERBOUGHT}` },
              lineStyle: { color: trend.down, type: 'dashed', width: 1 },
            },
            {
              yAxis: 1,
              label: { color: trend.flat, formatter: '1.0' },
              lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
            },
            {
              yAxis: BREADTH_ADR_OVERSOLD,
              label: { color: trend.up, formatter: `超卖 ${BREADTH_ADR_OVERSOLD}` },
              lineStyle: { color: trend.up, type: 'dashed', width: 1 },
            },
          ],
        },
      },
    ],
  };
});

/** OBOS：净差柱（红正绿负）+ MA 虚线 */
const obosOption = computed<EChartsCoreOption>(() => {
  void isDark.value;
  const trend = readTrendColors();
  const base = buildBase();
  return {
    ...base,
    xAxis: { ...base.xAxis, boundaryGap: true },
    series: [
      {
        name: 'OBOS',
        type: 'bar',
        barMaxWidth: 6,
        data: sliceSeries(series.value.obos).map((value) => ({
          value,
          itemStyle: { color: value === null ? trend.flat : value >= 0 ? trend.upLight : trend.downLight },
        })),
      },
      {
        name: 'OBOS 均线',
        type: 'line',
        data: sliceSeries(series.value.obosMa),
        connectNulls: false,
        symbol: 'none',
        lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
      },
    ],
  };
});

/** ARMS：ARMS 线 + MA 虚线 + 家数差柱（次轴） */
const armsOption = computed<EChartsCoreOption>(() => {
  void isDark.value;
  const trend = readTrendColors();
  const base = buildBase();
  const diffBars = bars.value.map((bar) => {
    const diff = bar.upCount - bar.downCount;
    return { value: diff, itemStyle: { color: diff >= 0 ? trend.upLight : trend.downLight } };
  });
  return {
    ...base,
    xAxis: { ...base.xAxis, boundaryGap: true },
    yAxis: [
      { ...base.yAxis, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => v.toFixed(1) } },
      { type: 'value', scale: true, axisLabel: { fontSize: 9, formatter: (v: number) => `${v / 10_000}万` } },
    ],
    series: [
      {
        name: 'ARMS',
        type: 'line',
        yAxisIndex: 0,
        data: sliceSeries(series.value.dates.map((_, i) => bars.value[startIndex.value + i]?.arms ?? null)),
        connectNulls: false,
        symbol: 'none',
        lineStyle: { color: CHART_LINE_TEAL, width: 1.6 },
        itemStyle: { color: CHART_LINE_TEAL },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { color: trend.flat, fontSize: 9, formatter: '1.0' },
          lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
          data: [{ yAxis: ARMS_NEUTRAL_LINE }],
        },
      },
      {
        name: 'ARMS 均线',
        type: 'line',
        yAxisIndex: 0,
        data: sliceSeries(series.value.armsMa),
        connectNulls: false,
        symbol: 'none',
        lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
      },
      {
        name: '上涨-下跌家数差',
        type: 'bar',
        yAxisIndex: 1,
        barMaxWidth: 6,
        data: sliceSeries(diffBars),
      },
    ],
  };
});

/** MCO：MCO 线 + 信号线 + 0 轴 + 超买超卖淡带（±25~35 带） */
const mcoOption = computed<EChartsCoreOption>(() => {
  void isDark.value;
  const trend = readTrendColors();
  const base = buildBase();
  return {
    ...base,
    xAxis: { ...base.xAxis, boundaryGap: false },
    series: [
      {
        name: 'MCO',
        type: 'line',
        data: sliceSeries(series.value.mco),
        connectNulls: false,
        symbol: 'none',
        lineStyle: { color: CHART_LINE_TEAL, width: 1.6 },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
          data: [{ yAxis: 0 }],
        },
        markArea: {
          silent: true,
          label: { fontSize: 9 },
          data: [
            [
              { yAxis: BREADTH_MCO_OVERBOUGHT, itemStyle: { color: trend.down, opacity: 0.06 } },
              { yAxis: 'max', label: { color: trend.down, formatter: '超买区' } },
            ],
            [
              { yAxis: 'min', itemStyle: { color: trend.up, opacity: 0.06 } },
              { yAxis: BREADTH_MCO_OVERSOLD, label: { color: trend.up, formatter: '超卖区' } },
            ],
          ],
        },
      },
      {
        name: 'MAMCO',
        type: 'line',
        data: sliceSeries(series.value.mcoSignal),
        connectNulls: false,
        symbol: 'none',
        lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
      },
    ],
  };
});

/** 副图定义（标题 / 最新值 / 一句话口径 / 说明 kind / option），模板按序渲染 */
const chartCards = computed(() => [
  { kind: BREADTH_INDICATOR_KIND.ADL, title: 'ADL 腾落线', value: fmt(latest.value.adl, 0), brief: `Σ(上涨−下跌)；虚线 MA${BREADTH_ADL_MA_PERIOD}`, option: adlOption.value },
  { kind: BREADTH_INDICATOR_KIND.ADR, title: 'ADR 涨跌比率', value: fmt(latest.value.adr), brief: 'N=10；＞1.5 超买，＜0.5 超卖', option: adrOption.value },
  { kind: BREADTH_INDICATOR_KIND.OBOS, title: 'OBOS 超买超卖', value: fmt(latest.value.obos, 0), brief: 'N=10 净差（家）；正多头占优', option: obosOption.value },
  { kind: BREADTH_INDICATOR_KIND.ARMS, title: 'TRIN 阿姆氏', value: fmt(latest.value.armsMa), brief: `日线+MA${BREADTH_ARMS_MA_PERIOD}；＜1 多头强`, option: armsOption.value },
  { kind: BREADTH_INDICATOR_KIND.MCO, title: '麦克莱伦 MCO', value: fmt(latest.value.mco, 1), brief: 'EMA19−EMA39；±25~35 超买超卖', option: mcoOption.value },
] as const);
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar
      title="市场宽度"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="router.back()"
    />

    <div class="m-sub-scroll m-bd-scroll">
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <!-- 当日概览条（当日分钟点末点；无采样显占位） -->
        <div class="m-card m-bd-today">
          <template v-if="todayPoint">
            <div class="m-bd-cell">
              <i>上涨 / 平盘 / 下跌</i>
              <b class="m-num">
                <span class="m-up">{{ todayPoint.upCount.toLocaleString() }}</span>
                <em> / {{ todayPoint.flatCount.toLocaleString() }} / </em>
                <span class="m-down">{{ todayPoint.downCount.toLocaleString() }}</span>
              </b>
            </div>
            <div class="m-bd-cell">
              <i>上涨量 / 下跌量（手）</i>
              <b class="m-num">
                <span class="m-up">{{ todayPoint.upVol.toLocaleString() }}</span>
                <em> / </em>
                <span class="m-down">{{ todayPoint.downVol.toLocaleString() }}</span>
              </b>
            </div>
            <div class="m-bd-cell">
              <i>ARMS 现值</i>
              <b class="m-num">
                {{ fmt(todayPoint.arms ?? null) }}
                <span
                  v-if="armsState"
                  class="m-bd-tag"
                  :class="armsState.tone === 'up' ? 'm-up' : armsState.tone === 'down' ? 'm-down' : ''"
                >
                  {{ armsState.label }}
                </span>
              </b>
            </div>
          </template>
          <div v-else class="m-bd-today__empty">
            今日暂无采样（交易日盘中本页自动拉取全市场快照积累，收盘后定稿为当日日 bar）
          </div>
        </div>

        <div v-if="isPageEmpty" class="m-state">
          历史广度数据按本地逐日积累（收盘后落库，无法回填）；本页已自动拉取快照，收盘后首个交易日即出图
        </div>

        <template v-else>
          <!-- 视图档位 + 就绪徽标 -->
          <div class="m-bd-chips">
            <button
              v-for="opt in BREADTH_INDICATOR_VIEW_OPTIONS"
              :key="opt.value"
              class="m-home-chip"
              :class="{ on: view === opt.value }"
              @click="view = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
          <div class="m-bd-ready">
            <span
              v-for="badge in readinessBadges"
              :key="badge.label"
              class="m-bd-ready__item"
              :class="{ 'm-bd-ready__item--ok': badge.ok }"
            >
              {{ badge.label }}
            </span>
          </div>

          <!-- 五张副图卡：卡头（名称 + 最新值 + 口径）点击展开公式与意义说明 -->
          <div
            v-for="card in chartCards"
            :key="card.kind"
            class="m-card m-bd-panel"
          >
            <button type="button" class="m-bd-head" @click="toggleInfo(card.kind)">
              <span class="m-bd-head__title">{{ card.title }}</span>
              <span class="m-bd-head__ask" :class="{ on: expandedKind === card.kind }">?</span>
              <b class="m-num m-bd-head__val">{{ card.value }}</b>
              <span class="m-bd-head__brief">{{ card.brief }}</span>
            </button>
            <div v-if="expandedKind === card.kind" class="m-bd-info">
              <p class="m-bd-info__formula">{{ infoParts(card.kind)[0] }}</p>
              <p class="m-bd-info__meaning">{{ infoParts(card.kind)[1] }}</p>
            </div>
            <MobileEChart :options="card.option" not-merge :style="{ height: `${CHART_HEIGHT}px` }" />
          </div>
        </template>
      </van-pull-refresh>
    </div>
  </div>
</template>

<style scoped>
/* 当日概览条：三格纵排（移动端窄屏不横挤），格间分隔线 */
.m-bd-today {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 4px 0;
}
.m-bd-cell {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
}
.m-bd-cell + .m-bd-cell {
  border-top: 1px solid var(--color-flat-weak);
}
.m-bd-cell i {
  font-size: 12px;
  font-style: normal;
  color: var(--color-text-2);
  white-space: nowrap;
}
.m-bd-cell b {
  font-size: 15px;
  text-align: right;
}
.m-bd-cell em {
  font-style: normal;
  color: var(--color-text-3);
}
.m-bd-today__empty {
  padding: 10px 14px;
  font-size: 12px;
  color: var(--color-text-3);
  line-height: 1.6;
}
.m-bd-tag {
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

/* 视图档位 chips + 就绪徽标 */
.m-bd-chips {
  display: flex;
  gap: 8px;
  padding: 10px 14px 4px;
}
.m-bd-ready {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 14px 2px;
}
.m-bd-ready__item {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-3);
  background: var(--color-flat-weak);
}
.m-bd-ready__item--ok {
  color: var(--color-up-strong);
}

/* 副图卡 */
.m-bd-panel {
  padding: 10px 12px 8px;
}
.m-bd-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
}
.m-bd-head__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
  white-space: nowrap;
}
.m-bd-head__ask {
  flex-shrink: 0;
  align-self: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  font-size: 10px;
  line-height: 15px;
  text-align: center;
  color: var(--color-text-3);
  background: var(--color-flat-weak);
}
.m-bd-head__ask.on {
  color: var(--color-primary);
}
.m-bd-head__val {
  font-size: 14px;
  white-space: nowrap;
}
.m-bd-head__brief {
  margin-left: auto;
  overflow: hidden;
  font-size: 10px;
  color: var(--color-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 展开的指标说明（公式 + 意义） */
.m-bd-info {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-flat-weak);
}
.m-bd-info p {
  margin: 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--color-text-2);
  white-space: pre-line;
}
.m-bd-info__formula {
  font-weight: 600;
  color: var(--color-text-1);
}
.m-bd-info__meaning {
  margin-top: 4px;
}
</style>
