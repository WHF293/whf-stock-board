<script setup lang="ts">
/**
 * 机构行为（2026-10-20 新增二级页，入口在首页金刚区；PC FuturesInstitutionalView 的移动精简版）
 *
 * 数据源：中金所 CCPM 成交持仓排名每日披露 CSV（GBK），与 PC 完全同源同算法
 * （fetchCcpmProductDay / aggregateCcpmByMember 全部复用 common 层）。
 *
 * 核心诉求（王总 2026-10-20）：把每个上榜机构席位的当日行为标注出来——
 * 做多 / 做空 / 对冲。判定复用 common 层行为标签（阈值 20%）：
 * - |多−空| ÷ max(多,空) < 20% 且多空双向同步增仓 → 对冲（hedge）
 * - 净头寸占比 ≥ 20% → 做多（long）/ 做空（short），按多空孰大
 * - 多空任一侧未上榜 → 不参与判定（显示「不判定」）
 *
 * 页面编排：品种切换（全股指合并 / 单品种合并）→ 披露日 + 部分头寸提示 →
 * 行为统计（做多/做空/对冲/不判定 席位数）→ 席位行为列表（点击行选中席位）→
 * 席位画像卡（选中联动：合并多空/净持仓/完整性/行为标签依据）→
 * 图表区（头部席位多单 vs 空单柱状 · 对冲还是单边；选中席位合并净持仓时序，
 * 近 20 披露日按需加载）→ 衍生榜单（折叠：净多/净空/净增减 TOP5）。
 * 移仓换月面板不做（PC 已有完整版，移动端价值有限）。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import dayjs from 'dayjs';
import type { EChartsCoreOption } from 'echarts/core';
import { fetchCcpmProductDay, fetchCcpmMemberSeries } from '../../common/api/futures-ccpm.api';
import { aggregateCcpmByMember } from '../../common/utils/ccpm-compute';
import { mapWithConcurrency } from '../../common/utils/map-with-concurrency';
import {
  CCPM_EQUITY_PRODUCT_ORDER,
  CCPM_FETCH_CONCURRENCY,
  CCPM_SERIES_DAYS,
  CCPM_SERIES_MAX_PROBE_DAYS,
} from '../../common/constants/futures.constants';
import { DOWN_COLOR, UP_COLOR } from '../../common/constants/stock-colors.constants';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../common/constants/chart.constants';
import type { CcpmAggregateRow, CcpmMemberSeries, CcpmProductDayData } from '../../common/types/futures.types';
import MobileEChart from '../components/MobileEChart.vue';

const router = useRouter();

/* === 品种切换（all = 全股指四品种合并，PC 默认口径；单品种 = 同品种合并口径） === */
const PRODUCT_OPTIONS = [
  { code: 'all', label: '全股指' },
  ...CCPM_EQUITY_PRODUCT_ORDER.map((code) => ({ code, label: code })),
] as const;
const product = ref<string>('all');

/* === 行选中（联动画像卡 + 净持仓时序） === */
const selectedMember = ref<string | null>(null);
const selectMember = (name: string): void => {
  if (selectedMember.value === name) return;
  selectedMember.value = name;
  series.value = null; // 换席位后旧时序作废，按需重载
};
/** 选中席位的聚合行（画像卡数据；未选中为 null） */
const profileRow = computed<CcpmAggregateRow | null>(
  () => rows.value.find((row) => row.memberName === selectedMember.value) ?? null,
);

/* === 席位合并净持仓时序（近 N 披露日，按需加载——逐日拉上游 CSV，重接口不自动跑） === */
const series = ref<CcpmMemberSeries | null>(null);
const seriesLoading = ref(false);
const loadSeries = async (): Promise<void> => {
  const member = selectedMember.value;
  if (!member || seriesLoading.value) return;
  seriesLoading.value = true;
  try {
    const products = product.value === 'all' ? CCPM_EQUITY_PRODUCT_ORDER : [product.value];
    series.value = await fetchCcpmMemberSeries(
      member,
      products,
      resolvedDay.value || dayjs().format('YYYYMMDD'),
    );
  } catch {
    series.value = null;
  } finally {
    seriesLoading.value = false;
  }
};
/** 时序是否含部分头寸日（covered < total 的日） */
const seriesPartial = computed(() =>
  (series.value?.points ?? []).some((point) => point.coveredCount < point.totalCount),
);

/* === 图表公共轴样式（与 PC FuturesChartsPanel 同源常量） === */
const AXIS_STYLE = {
  axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
  axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
  splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
} as const;
const formatAxisNumber = (value: number): string => value.toLocaleString('en-US');

/** 图：头部席位多单 vs 空单并排柱状（top6，判断对冲还是单边；PC barsOption 聚合口径移植） */
const barsOption = computed<EChartsCoreOption | null>(() => {
  const ranked = rows.value.slice(0, 6);
  if (ranked.length === 0) return null;
  return {
    grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
    legend: { top: 0, textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: formatAxisNumber },
    xAxis: {
      type: 'category',
      data: ranked.map((row) => row.memberName.replace(/\(代客\)$/, '')),
      ...AXIS_STYLE,
      axisTick: { show: false },
      axisLabel: { ...AXIS_STYLE.axisLabel, width: 52, overflow: 'truncate' },
    },
    yAxis: { type: 'value', ...AXIS_STYLE, axisLabel: { ...AXIS_STYLE.axisLabel, formatter: formatAxisNumber } },
    series: [
      { name: '合并多单', type: 'bar', data: ranked.map((row) => row.totalBuy), barMaxWidth: 14, itemStyle: { color: UP_COLOR, borderRadius: [4, 4, 0, 0] } },
      { name: '合并空单', type: 'bar', data: ranked.map((row) => row.totalSell), barMaxWidth: 14, itemStyle: { color: DOWN_COLOR, borderRadius: [4, 4, 0, 0] } },
    ],
  };
});

/**
 * 交易日标签（yyyyMMdd → MM-DD）
 * @param day 交易日
 * @returns 短标签
 */
const dayLabel = (day: string): string => `${day.slice(4, 6)}-${day.slice(6, 8)}`;

/** 图：选中席位合并净持仓时序（线 = 净持仓，柱 = 净增减；PC seriesOption 移植） */
const seriesOption = computed<EChartsCoreOption | null>(() => {
  const points = series.value?.points ?? [];
  if (points.length === 0) return null;
  return {
    grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
    legend: { top: 0, textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 } },
    tooltip: { trigger: 'axis', valueFormatter: formatAxisNumber },
    xAxis: {
      type: 'category',
      data: points.map((point) => dayLabel(point.tradingDay)),
      ...AXIS_STYLE,
      axisTick: { show: false },
    },
    yAxis: [
      { type: 'value', ...AXIS_STYLE, axisLabel: { ...AXIS_STYLE.axisLabel, formatter: formatAxisNumber } },
      { type: 'value', ...AXIS_STYLE, splitLine: { show: false }, axisLabel: { ...AXIS_STYLE.axisLabel, formatter: formatAxisNumber } },
    ],
    series: [
      {
        name: '合并净持仓',
        type: 'line',
        data: points.map((point) => point.totalNet),
        smooth: true,
        symbolSize: 5,
        lineStyle: { width: 2, color: '#0e9488' },
        itemStyle: { color: '#0e9488' },
      },
      {
        name: '净增减',
        type: 'bar',
        yAxisIndex: 1,
        data: points.map((point) => point.totalNetChg),
        barMaxWidth: 10,
        itemStyle: {
          borderRadius: 2,
          color: (params: { data: number }) => (params.data >= 0 ? UP_COLOR : DOWN_COLOR),
        },
      },
    ],
  };
});

/* === 衍生榜单（聚合口径三榜 TOP5，折叠展示） === */
const rankOpen = ref(false);
const rankLists = computed(() => {
  const list = rows.value;
  return [
    {
      title: '合并净多 TOP5',
      items: [...list]
        .sort((a, b) => b.totalNet - a.totalNet)
        .filter((row) => row.totalNet > 0)
        .slice(0, 5)
        .map((row) => ({ name: row.memberName, value: row.totalNet, cls: 'm-up' })),
    },
    {
      title: '合并净空 TOP5',
      items: [...list]
        .sort((a, b) => a.totalNet - b.totalNet)
        .filter((row) => row.totalNet < 0)
        .slice(0, 5)
        .map((row) => ({ name: row.memberName, value: row.totalNet, cls: 'm-down' })),
    },
    {
      title: '净增减 TOP5',
      items: [...list]
        .sort((a, b) => Math.abs(b.totalNetChg) - Math.abs(a.totalNetChg))
        .slice(0, 5)
        .map((row) => ({ name: row.memberName, value: row.totalNetChg, cls: row.totalNetChg >= 0 ? 'm-up' : 'm-down' })),
    },
  ];
});

/* === 行为标签展示 === */
/** 标签文案（王总口径：做多 / 做空 / 对冲；未判定显示「不判定」） */
const TAG_META = {
  long: { label: '做多', cls: 'm-fi-tag--long' },
  short: { label: '做空', cls: 'm-fi-tag--short' },
  hedge: { label: '对冲', cls: 'm-fi-tag--hedge' },
} as const satisfies Record<string, { label: string; cls: string }>;

/* === 排序（aggregate 默认按 |净持仓| 降序，净增减为本地重排） === */
const sortKey = ref<'net' | 'netChg'>('net');

/* === 数据加载（口径对齐 PC：先以 IF 探锚最近披露日，各品种披露日历一致） === */
const rows = ref<CcpmAggregateRow[]>([]);
const loading = ref(false);
const failed = ref(false);
/** 实际披露交易日（yyyyMMdd，加载成功后回填） */
const resolvedDay = ref('');

/**
 * 从今天起向前探测最近一个有披露的交易日（跳过周末/节假日；force 透传强刷缓存）
 * @param productCode 品种代码
 * @param force 是否跳过缓存回源
 * @returns 最近披露日的品种单日数据；探测窗口内全无数据返回 null
 */
const probeLatest = async (productCode: string, force: boolean): Promise<CcpmProductDayData | null> => {
  let cursor = dayjs();
  for (let i = 0; i < CCPM_SERIES_MAX_PROBE_DAYS; i += 1) {
    const data = await fetchCcpmProductDay(productCode, cursor.format('YYYYMMDD'), force);
    if (data) return data;
    cursor = cursor.subtract(1, 'day');
  }
  return null;
};

const load = async (force = false): Promise<void> => {
  if (loading.value) return;
  loading.value = true;
  failed.value = false;
  try {
    if (product.value === 'all') {
      // 全股指：先以 IF 探锚，再四品种并发拉同日数据后合并聚合（PC 同款流程）
      const anchor = await probeLatest('IF', force);
      if (!anchor) {
        rows.value = [];
        failed.value = true;
        return;
      }
      const list = await mapWithConcurrency(
        CCPM_EQUITY_PRODUCT_ORDER,
        (code) => fetchCcpmProductDay(code, anchor.tradingDay, force),
        { concurrency: CCPM_FETCH_CONCURRENCY },
      );
      const valid = list.filter((item): item is CcpmProductDayData => item !== null);
      rows.value = aggregateCcpmByMember(valid);
      resolvedDay.value = anchor.tradingDay;
    } else {
      const anchor = await probeLatest(product.value, force);
      if (!anchor) {
        rows.value = [];
        failed.value = true;
        return;
      }
      rows.value = aggregateCcpmByMember([anchor]);
      resolvedDay.value = anchor.tradingDay;
    }
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
};

/* 品种切换：清空选中席位与旧时序（口径变了画像/时序都失效），重拉列表 */
watch(product, () => {
  selectedMember.value = null;
  series.value = null;
  void load();
});

/* === 派生：排序 / 行为统计 / 部分头寸 === */
const sortedRows = computed<CcpmAggregateRow[]>(() => {
  if (sortKey.value === 'net') return rows.value; // aggregate 出厂即按 |净持仓| 降序
  return [...rows.value].sort((a, b) => Math.abs(b.totalNetChg) - Math.abs(a.totalNetChg));
});

/** 行为统计（做多/做空/对冲/不判定 席位数） */
const tagCount = computed(() => {
  let long = 0;
  let short = 0;
  let hedge = 0;
  let unknown = 0;
  for (const row of rows.value) {
    if (row.tag === 'long') long += 1;
    else if (row.tag === 'short') short += 1;
    else if (row.tag === 'hedge') hedge += 1;
    else unknown += 1;
  }
  return { long, short, hedge, unknown };
});

/** 部分头寸席位数（coveredCount < totalCount：合并结果不完整，需红字提示） */
const partialCount = computed(() => rows.value.filter((row) => row.isPartial).length);

/** 披露日文案（yyyyMMdd → MM-DD） */
const resolvedDayLabel = computed(() =>
  resolvedDay.value ? `${resolvedDay.value.slice(4, 6)}-${resolvedDay.value.slice(6, 8)}` : '--',
);

/* === 格式化（涨红跌绿遵循 A 股配色：净多正红 / 净空负绿） === */
const signed = (v: number): string => (v > 0 ? `+${v.toLocaleString('en-US')}` : v.toLocaleString('en-US'));
const dirClass = (v: number): string => (v > 0 ? 'm-up' : v < 0 ? 'm-down' : 'm-flat');

/* === 下拉刷新 === */
const refreshing = ref(false);
const onRefresh = async (): Promise<void> => {
  try {
    await load(true);
  } finally {
    refreshing.value = false;
  }
};

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar
      title="机构行为"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="router.back()"
    />

    <div class="m-sub-scroll m-fi-scroll">
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <!-- 品种切换（全股指 = IF/IH/IC/IM 四品种合并，与 PC 默认口径一致） -->
        <div class="m-fi-chips">
          <button
            v-for="opt in PRODUCT_OPTIONS"
            :key="opt.code"
            class="m-home-chip"
            :class="{ on: product === opt.code }"
            @click="product = opt.code"
          >
            {{ opt.label }}
          </button>
        </div>

        <!-- 数据边界提示：实际披露日 + 部分头寸警示 -->
        <div v-if="resolvedDay" class="m-fi-note">
          披露日 {{ resolvedDayLabel }}
          <template v-if="partialCount > 0">
            · <b class="m-down">{{ partialCount }} 席位为部分头寸，合并结果不完整</b>
          </template>
        </div>

        <!-- 行为统计：一眼看出全体上榜机构的当日倾向 -->
        <div class="m-card m-fi-stats">
          <div class="m-fi-stat">
            <b class="m-up">{{ tagCount.long }}</b>
            <span>做多</span>
          </div>
          <div class="m-fi-stat">
            <b class="m-down">{{ tagCount.short }}</b>
            <span>做空</span>
          </div>
          <div class="m-fi-stat">
            <b>{{ tagCount.hedge }}</b>
            <span>对冲</span>
          </div>
          <div class="m-fi-stat">
            <b>{{ tagCount.unknown }}</b>
            <span>不判定</span>
          </div>
        </div>

        <!-- 排序切换 -->
        <div class="m-fi-chips m-fi-chips--sub">
          <button class="m-home-chip" :class="{ on: sortKey === 'net' }" @click="sortKey = 'net'">
            按净持仓
          </button>
          <button class="m-home-chip" :class="{ on: sortKey === 'netChg' }" @click="sortKey = 'netChg'">
            按净增减
          </button>
        </div>

        <div v-if="loading" class="m-card m-skel-fill">
          <div v-for="i in 10" :key="i" class="m-skel-row"></div>
        </div>
        <div v-else-if="failed" class="m-state">
          机构数据加载失败
          <span class="retry" @click="load(true)">重试</span>
        </div>
        <div v-else-if="sortedRows.length === 0" class="m-state">暂无披露数据</div>

        <!-- 席位行为列表（核心）：行为标签 + 多空持仓；点击行选中席位（联动画像/时序） -->
        <div v-else class="m-card m-fi-list">
          <div
            v-for="row in sortedRows"
            :key="row.memberName"
            class="m-fi-row"
            :class="{ 'm-fi-row--active': row.memberName === selectedMember }"
            @click="selectMember(row.memberName)"
          >
            <div class="m-fi-row__head">
              <span class="nm">
                <b>{{ row.memberName }}</b>
                <i v-if="row.isPartial" class="partial">部分头寸</i>
              </span>
              <span v-if="row.tag" class="m-fi-tag" :class="TAG_META[row.tag].cls">
                {{ TAG_META[row.tag].label }}
              </span>
              <span v-else class="m-fi-tag m-fi-tag--na">不判定</span>
            </div>
            <div class="m-fi-row__grid">
              <span>多单<b class="m-num">{{ row.totalBuy.toLocaleString('en-US') }}</b></span>
              <span>空单<b class="m-num">{{ row.totalSell.toLocaleString('en-US') }}</b></span>
              <span>净持仓<b class="m-num" :class="dirClass(row.totalNet)">{{ signed(row.totalNet) }}</b></span>
              <span>净增减<b class="m-num" :class="dirClass(row.totalNetChg)">{{ signed(row.totalNetChg) }}</b></span>
            </div>
          </div>
        </div>

        <!-- 席位画像卡（点击列表行联动；全股指口径带净持仓增减大数字，短视频核验口径） -->
        <div class="m-card m-fi-profile">
          <div class="m-fi-profile__head">
            <span class="m-fi-profile__title">席位画像 · {{ profileRow?.memberName ?? '--' }}</span>
            <span v-if="profileRow?.tag" class="m-fi-tag" :class="TAG_META[profileRow.tag].cls">
              {{ TAG_META[profileRow.tag].label }}
            </span>
          </div>
          <template v-if="profileRow">
            <div class="m-fi-profile__big">
              <b class="m-num" :class="dirClass(profileRow.totalNetChg)">{{ signed(profileRow.totalNetChg) }}</b>
              <span>手 · 净持仓增减（= 多头增减 − 空头增减）</span>
            </div>
            <div class="m-fi-profile__grid">
              <div class="cell">
                <i>合并多单</i>
                <b class="m-num m-up">{{ profileRow.totalBuy.toLocaleString('en-US') }}</b>
                <em :class="dirClass(profileRow.totalBuyChg)">{{ signed(profileRow.totalBuyChg) }}</em>
              </div>
              <div class="cell">
                <i>合并空单</i>
                <b class="m-num m-down">{{ profileRow.totalSell.toLocaleString('en-US') }}</b>
                <em :class="dirClass(profileRow.totalSellChg)">{{ signed(profileRow.totalSellChg) }}</em>
              </div>
              <div class="cell">
                <i>合并净持仓</i>
                <b class="m-num" :class="dirClass(profileRow.totalNet)">{{ signed(profileRow.totalNet) }}</b>
                <em>多 − 空</em>
              </div>
              <div class="cell">
                <i>完整性</i>
                <b class="m-num">{{ profileRow.coveredCount }} / {{ profileRow.totalCount }}</b>
                <em :class="profileRow.isPartial ? 'm-down' : ''">{{ profileRow.isPartial ? '部分头寸' : '完全统计' }}</em>
              </div>
            </div>
            <div class="m-fi-profile__reason">{{ profileRow.tagReason }}</div>
            <div class="m-fi-profile__rule">
              判定规则：|净持仓| ÷ max(多单, 空单) &lt; 20% 且多空同向增仓 → 对冲；占比 ≥ 20% → 单边多 / 空。
            </div>
          </template>
          <div v-else class="m-fi-profile__empty">点击上方席位行查看画像</div>
        </div>

        <!-- 图表区：多空并排柱状（对冲还是单边）+ 选中席位净持仓时序 -->
        <div v-if="barsOption" class="m-card m-fi-chart">
          <div class="m-fi-chart__head">
            <span class="m-fi-chart__t">头部席位 多单 vs 空单</span>
            <span class="m-fi-chart__s">体量对比：对冲还是单边</span>
          </div>
          <div class="m-fi-chart__box">
            <MobileEChart :options="barsOption" />
          </div>
        </div>

        <div class="m-card m-fi-chart">
          <div class="m-fi-chart__head">
            <span class="m-fi-chart__t">席位合并净持仓时序{{ selectedMember ? ` · ${selectedMember}` : '' }}</span>
            <span v-if="seriesPartial" class="m-up m-fi-chart__s">含部分头寸日</span>
          </div>
          <MobileEChart v-if="seriesOption" :options="seriesOption" />
          <div v-else class="m-fi-chart__empty">
            <template v-if="selectedMember">
              {{ seriesLoading ? '正在逐日拉取披露数据…' : '点击按钮加载时序，排除单日噪音' }}
            </template>
            <template v-else>点击席位行后，可加载该席位的净持仓时序</template>
            <button
              v-if="selectedMember && !series"
              class="m-fi-series-btn"
              :disabled="seriesLoading"
              @click="loadSeries"
            >
              {{ seriesLoading ? '加载中…' : `加载近 ${CCPM_SERIES_DAYS} 个披露日` }}
            </button>
          </div>
        </div>

        <!-- 衍生榜单（折叠）：净多 / 净空 / 净增减 TOP5 -->
        <div class="m-card m-fi-rank">
          <button class="m-fi-rank__head" @click="rankOpen = !rankOpen">
            <span class="m-fi-chart__t">衍生榜单</span>
            <span class="m-fi-chart__s">净多 / 净空 / 增减仓 TOP，按需展开</span>
            <van-icon :name="rankOpen ? 'arrow-down' : 'arrow'" />
          </button>
          <div v-if="rankOpen" class="m-fi-rank__grid">
            <div v-for="list in rankLists" :key="list.title" class="m-fi-rank__col">
              <div class="m-fi-rank__title">{{ list.title }}</div>
              <div v-for="item in list.items" :key="item.name" class="m-fi-rank__row">
                <span class="nm">{{ item.name }}</span>
                <b class="m-num" :class="item.cls">{{ item.value.toLocaleString('en-US') }}</b>
              </div>
              <div v-if="list.items.length === 0" class="m-fi-rank__row">--</div>
            </div>
          </div>
        </div>
      </van-pull-refresh>
      <div class="m-sub-tail"></div>
    </div>
  </div>
</template>

<style scoped>
/* 品种 / 排序 chips 行（复用全局 m-home-chip 药丸） */
.m-fi-chips {
  display: flex;
  gap: 6px;
  padding: 0 12px 8px;
}
.m-fi-chips--sub {
  padding: 0 12px 8px;
}

/* 数据边界提示条：小字弱化，部分头寸警示由内嵌 b.m-down 着色 */
.m-fi-note {
  padding: 0 16px 8px;
  font-size: 11px;
  color: var(--color-text-3);
}

/* 行为统计卡：四格均分，数值大号着色 */
.m-fi-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding: 12px 0;
  margin: 0 12px 8px;
}
.m-fi-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.m-fi-stat b {
  font-family: var(--font-num, 'SF Mono', Menlo, Consolas, monospace);
  font-size: 19px;
  font-weight: 800;
}
.m-fi-stat span {
  font-size: 10.5px;
  color: var(--color-text-3);
}

/* 席位行为列表：行 = 头（席位名 + 标签）+ 四格数据 + 可展开判定依据 */
.m-fi-list {
  margin: 0 12px;
  padding: 0 12px;
}
.m-fi-row {
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
}
.m-fi-row:last-child {
  border-bottom: none;
}
.m-fi-row__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.m-fi-row__head .nm {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.m-fi-row__head .nm b {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-fi-row__head .partial {
  flex-shrink: 0;
  font-style: normal;
  font-size: 9.5px;
  color: var(--color-down);
  border: 1px solid var(--color-down);
  border-radius: 4px;
  padding: 0 3px;
}
/* 行为标签 pill：做多=红 / 做空=绿（A 股配色）/ 对冲=中性紫灰，固定色不随涨跌语义反转 */
.m-fi-tag {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
}
.m-fi-tag--long {
  color: var(--color-up);
  background: color-mix(in srgb, var(--color-up) 14%, transparent);
}
.m-fi-tag--short {
  color: var(--color-down);
  background: color-mix(in srgb, var(--color-down) 14%, transparent);
}
.m-fi-tag--hedge {
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
}
.m-fi-tag--na {
  color: var(--color-text-3);
  background: var(--color-bg-weak, rgba(128, 128, 128, 0.12));
}

/* 四格数据行：多单/空单/净持仓/净增减 */
.m-fi-row__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 7px;
}
.m-fi-row__grid span {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 10px;
  color: var(--color-text-3);
}
.m-fi-row__grid b {
  font-size: 12px;
  font-weight: 700;
}

/* 展开区：判定依据 + 多空增减明细 */
.m-fi-row__reason {
  margin-top: 7px;
  padding: 7px 9px;
  border-radius: 8px;
  background: var(--color-bg-weak, rgba(128, 128, 128, 0.08));
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-2);
}
.m-fi-row__detail {
  margin-top: 3px;
  color: var(--color-text-3);
}

/* 选中席位行高亮（联动画像/时序） */
.m-fi-row--active {
  background: var(--color-flat-weak, rgba(127, 127, 127, 0.1));
}

/* 席位画像卡（聚合口径：净增减大数字 + 四格 + 标签依据 + 规则说明） */
.m-fi-profile {
  margin: 10px 12px;
  padding: 12px 14px;
}
.m-fi-profile__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.m-fi-profile__title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-fi-profile__big {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 8px;
}
.m-fi-profile__big b {
  font-size: 26px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.m-fi-profile__big span {
  font-size: 10.5px;
  color: var(--color-text-3);
}
.m-fi-profile__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 10px;
}
.m-fi-profile__grid .cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 10px;
  border-radius: 9px;
  background: var(--color-bg-weak, rgba(128, 128, 128, 0.08));
}
.m-fi-profile__grid .cell i {
  font-style: normal;
  font-size: 10.5px;
  color: var(--color-text-3);
}
.m-fi-profile__grid .cell b {
  font-size: 14.5px;
  font-weight: 800;
}
.m-fi-profile__grid .cell em {
  font-style: normal;
  font-size: 10.5px;
  color: var(--color-text-3);
}
.m-fi-profile__reason {
  margin-top: 9px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-2);
}
.m-fi-profile__rule {
  margin-top: 5px;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--color-text-3);
}
.m-fi-profile__empty {
  padding: 26px 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--color-text-3);
}

/* 图表卡（多空柱状 / 净持仓时序） */
.m-fi-chart {
  margin: 10px 12px;
  padding: 12px 8px 6px;
}
.m-fi-chart__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 6px;
}
.m-fi-chart__t {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-1);
}
.m-fi-chart__s {
  font-size: 10.5px;
  color: var(--color-text-3);
}
.m-fi-chart__box {
  height: 230px;
}
.m-fi-chart__empty {
  min-height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 11.5px;
  color: var(--color-text-3);
  text-align: center;
  padding: 0 16px;
}
.m-fi-series-btn {
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-primary);
  font-size: 12px;
  padding: 5px 14px;
  border-radius: 999px;
}

/* 衍生榜单（折叠） */
.m-fi-rank {
  margin: 10px 12px;
}
.m-fi-rank__head {
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 11px 14px;
  border: none;
  background: none;
  color: inherit;
  text-align: left;
}
.m-fi-rank__head .van-icon {
  margin-left: auto;
  align-self: center;
  color: var(--color-text-3);
}
.m-fi-rank__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 2px 14px 12px;
}
.m-fi-rank__col {
  min-width: 0;
  border-radius: 9px;
  background: var(--color-bg-weak, rgba(128, 128, 128, 0.08));
  padding: 8px 9px;
}
.m-fi-rank__title {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--color-text-3);
  margin-bottom: 4px;
}
.m-fi-rank__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 2px 0;
  font-size: 11px;
  color: var(--color-text-2);
}
.m-fi-rank__row .nm {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-fi-rank__row b {
  flex-shrink: 0;
  font-weight: 700;
}

.retry {
  color: var(--color-primary);
  padding: 4px 8px;
  cursor: pointer;
}
</style>
