<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import NoticeBar from '../components/ui/NoticeBar.vue';
import { usePageHeaderSlot, PAGE_HEADER_ACTIONS_TARGET } from '../../common/composables/use-page-header-slot';
import FuturesFilterBar from '../components/business/futures/FuturesFilterBar.vue';
import FuturesStatCards from '../components/business/futures/FuturesStatCards.vue';
import type { FuturesStatCard } from '../components/business/futures/FuturesStatCards.vue';
import FuturesMemberTable from '../components/business/futures/FuturesMemberTable.vue';
import FuturesBreakdownTable from '../components/business/futures/FuturesBreakdownTable.vue';
import FuturesMemberProfile from '../components/business/futures/FuturesMemberProfile.vue';
import FuturesChartsPanel from '../components/business/futures/FuturesChartsPanel.vue';
import FuturesRankPanel from '../components/business/futures/FuturesRankPanel.vue';
import FuturesRollPanel from '../components/business/futures/FuturesRollPanel.vue';
import { fetchCcpmProductDay, fetchCcpmMemberSeries, findLatestCcpmDay } from '../../common/api/futures-ccpm.api.ts';
import {
  CCPM_EQUITY_PRODUCT_ORDER,
  FUTURES_PAGE_TEXT,
} from '../../common/constants/futures.constants.ts';
import { aggregateCcpmByMember, computeCcpmMemberStats, filterCcpmRowsByInstrument } from '../../common/utils/ccpm-compute.ts';
import type {
  CcpmAggregateRow,
  CcpmMemberSeries,
  CcpmMemberStats,
  CcpmProductDayData,
  CcpmScopeMode,
} from '../../common/types/futures.types.ts';

/**
 * 期货 · 机构行为（侧栏「期货」分组首页）
 *
 * 数据源：中金所 CCPM 成交持仓排名每日披露 CSV（GBK）。页面编排：
 * 筛选器（品种 / 三档合并口径 / 合约 / 交易日 / 席位搜索）→ 常驻数据边界提示 →
 * 概览指标卡 → 上榜会员总表（行展开 = 席位跨合约分解）+ 席位画像 →
 * 图表区（占比 / 多空柱状 / 净持仓时序）→ 衍生榜单（折叠）→ 移仓换月（折叠）→
 * 固定风险提示。
 */

/** 今天（yyyy-MM-dd，date input 初始值） */
const TODAY = dayjs().format('YYYY-MM-DD');

/** 当前品种代码 */
const product = ref<string>('IF');

/** 当前合并口径（单合约 / 同品种合并 / 全股指合并；默认全股指——对应短视频核验口径） */
const scope = ref<CcpmScopeMode>('all');

/** 当前合约（单合约口径） */
const instrument = ref<string>('');

/** date input 交易日（yyyy-MM-dd） */
const dayInput = ref<string>(TODAY);

/** 实际披露交易日（yyyyMMdd，加载成功后回填，非披露日自动回退） */
const resolvedDay = ref<string>('');

/** 席位搜索关键词 */
const search = ref<string>('');

/** 选中席位（画像 / 时序目标） */
/** 选中席位（画像卡联动；未显式点选时默认锚定中信期货） */
const selectedMember = ref<string | null>(null);
/** 用户是否显式点选过席位（点选后不再自动改选） */
const memberPicked = ref(false);
/** 画像默认席位（短视频核验口径的主力席位） */
const DEFAULT_MEMBER = '中信期货(代客)';

/** 已展开分解行的席位列表 */
const expandedMembers = ref<string[]>([]);

/** 首屏 / 切换加载中 */
const loading = ref(false);

/** 当日无披露数据（非交易日 / 上游异常） */
const noData = ref(false);

/** 单品种当日数据（contract / product 口径） */
const dayData = ref<CcpmProductDayData | null>(null);

/** 全股指口径各品种当日数据（key = 品种代码） */
const allData = ref<Record<string, CcpmProductDayData | null>>({});

/** 席位时序数据 */
const series = ref<CcpmMemberSeries | null>(null);

/** 时序加载中 */
const seriesLoading = ref(false);

/** 是否处于全股指口径 */
const isAllScope = computed(() => scope.value === 'all');

/** 当前口径下可用的品种当日数据集合 */
const activeDataList = computed<CcpmProductDayData[]>(() => {
  if (isAllScope.value) {
    // 注意用 != null 同时挡掉 null 与 undefined：allData 尚未填充时
    // allData.value[code] 是 undefined，只挡 null 会让 undefined 混进下游聚合
    return CCPM_EQUITY_PRODUCT_ORDER.map((code) => allData.value[code]).filter(
      (item): item is CcpmProductDayData => item != null,
    );
  }
  return dayData.value ? [dayData.value] : [];
});

/** 口径合约总数（完整性的分母） */
const totalCount = computed(() =>
  activeDataList.value.reduce((sum, item) => sum + item.instruments.length, 0),
);

/** 当前品种披露的合约列表 */
const instruments = computed<string[]>(() =>
  isAllScope.value ? [] : (dayData.value?.instruments ?? []),
);

/**
 * 加载某个自然日的数据（scope 决定单品种还是四股指）
 * @param day yyyy-MM-dd 或 yyyyMMdd
 * @param autoFallback 无数据时是否自动回退到最近披露日（首屏 true）
 * @param forceRefresh 跳过两级缓存强制回源（「刷新」按钮用）
 */
const loadDay = async (day: string, autoFallback = false, forceRefresh = false): Promise<void> => {
  const dayKey = day.replaceAll('-', '');
  if (!/^\d{8}$/.test(dayKey)) {
    return;
  }
  loading.value = true;
  noData.value = false;
  series.value = null;
  try {
    if (isAllScope.value) {
      const results = await Promise.all(
        CCPM_EQUITY_PRODUCT_ORDER.map((code) => fetchCcpmProductDay(code, dayKey, forceRefresh)),
      );
      const next: Record<string, CcpmProductDayData | null> = {};
      CCPM_EQUITY_PRODUCT_ORDER.forEach((code, index) => {
        next[code] = results[index];
      });
      allData.value = next;
      const hit = results.find((item) => item !== null);
      if (hit) {
        resolvedDay.value = hit.tradingDay;
      } else if (autoFallback) {
        await fallbackToLatest();
        return;
      } else {
        noData.value = true;
      }
    } else {
      const data = await fetchCcpmProductDay(product.value, dayKey, forceRefresh);
      if (data) {
        dayData.value = data;
        resolvedDay.value = data.tradingDay;
      } else if (autoFallback) {
        await fallbackToLatest();
        return;
      } else {
        dayData.value = null;
        noData.value = true;
      }
    }
  } finally {
    loading.value = false;
  }
};

/**
 * 回退到最近披露日（探测上游，同时刷新筛选器日期）
 */
const fallbackToLatest = async (): Promise<void> => {
  const anchorProduct = isAllScope.value ? 'IF' : product.value;
  const latest = await findLatestCcpmDay(anchorProduct, dayInput.value.replaceAll('-', ''));
  if (latest) {
    resolvedDay.value = latest.data.tradingDay;
    dayInput.value = dayjs(latest.data.tradingDay, 'YYYYMMDD').format('YYYY-MM-DD');
    noData.value = false;
    if (isAllScope.value) {
      await loadDay(dayInput.value);
    } else {
      dayData.value = latest.data;
    }
  } else {
    noData.value = true;
    resolvedDay.value = '';
  }
};

/** 首屏加载：直接走自动回退 */
void loadDay(TODAY, true);

// 品种 / 口径 / 交易日变化 → 重新加载（合约与选中席位复位）
watch([product, scope, dayInput], () => {
  instrument.value = '';
  selectedMember.value = null;
  memberPicked.value = false;
  expandedMembers.value = [];
  void loadDay(dayInput.value);
});

// 合约列表就绪后默认选第一个合约
watch(instruments, (list) => {
  if (!instrument.value && list.length > 0) {
    instrument.value = list[0] ?? '';
  }
});

/**
 * 搜索过滤（席位名包含关键词，大小写不敏感）
 * @param memberName 席位名
 * @returns 是否命中搜索关键词（关键词为空时恒命中）
 */
const matchSearch = (memberName: string): boolean =>
  search.value.trim() === '' || memberName.toLowerCase().includes(search.value.trim().toLowerCase());

/** 单合约口径：指标计算后的行（当前合约） */
const stats = computed<CcpmMemberStats[]>(() => {
  const data = dayData.value;
  if (scope.value !== 'contract' || !data) {
    return [];
  }
  const target = instrument.value || data.instruments[0] || '';
  const rows = filterCcpmRowsByInstrument(data, target);
  const totals = data.totals[target];
  if (!totals) {
    return [];
  }
  return computeCcpmMemberStats(rows, totals);
});

/** 聚合口径：按会员聚合行（同品种 / 全股指共用） */
const aggregates = computed<CcpmAggregateRow[]>(() => {
  if (scope.value === 'contract' || activeDataList.value.length === 0) {
    return [];
  }
  return aggregateCcpmByMember(activeDataList.value);
});

// 数据就绪且用户未显式点选时，画像默认锚定中信期货（缺席则取榜首）
watch([stats, aggregates], ([s, a]) => {
  if (memberPicked.value) {
    return;
  }
  const list = s.length > 0 ? s : a;
  if (list.length === 0) {
    selectedMember.value = null;
    return;
  }
  selectedMember.value = list.some((row) => row.memberName === DEFAULT_MEMBER)
    ? DEFAULT_MEMBER
    : (list[0]?.memberName ?? null);
});

/** 总表行（搜索过滤后） */
const visibleStats = computed(() => stats.value.filter((row) => matchSearch(row.memberName)));
/** 总表行（聚合口径，搜索过滤后） */
const visibleAggregates = computed(() =>
  aggregates.value.filter((row) => matchSearch(row.memberName)),
);

/** 选中席位的单合约画像 */
const selectedStats = computed<CcpmMemberStats | null>(
  () => stats.value.find((row) => row.memberName === selectedMember.value) ?? null,
);
/** 选中席位的聚合画像 */
const selectedAggregate = computed<CcpmAggregateRow | null>(
  () => aggregates.value.find((row) => row.memberName === selectedMember.value) ?? null,
);

/** 选中席位在当前口径下的全部上榜原始行（分解表数据源） */
const selectedBreakdownRows = computed(() => {
  if (!selectedMember.value) {
    return [];
  }
  return activeDataList.value
    .flatMap((item) => item.rows)
    .filter((row) => row.memberName === selectedMember.value);
});

/**
 * 汇总各品种合约合计（指标卡数据源）
 * @returns 合并的总量
 */
const grandTotals = computed(() => {
  let volume = 0;
  let buy = 0;
  let sell = 0;
  for (const data of activeDataList.value) {
    for (const total of Object.values(data.totals)) {
      volume += total.volume;
      buy += total.buy;
      sell += total.sell;
    }
  }
  return { volume, buy, sell, net: buy - sell };
});

/** 概览指标卡（三口径各自组装） */
const statCards = computed<readonly FuturesStatCard[]>(() => {
  if (scope.value === 'contract') {
    const data = dayData.value;
    const target = instrument.value || data?.instruments[0] || '';
    const totals = data?.totals[target];
    if (!totals) {
      return [];
    }
    return [
      { label: '上榜总多单', value: totals.buy.toLocaleString('en-US'), valueClass: 'text-up', sub: '手' },
      { label: '上榜总空单', value: totals.sell.toLocaleString('en-US'), valueClass: 'text-down', sub: '手' },
      { label: '上榜总成交量', value: totals.volume.toLocaleString('en-US'), sub: '手' },
      {
        label: '上榜多空净差',
        value: (totals.buy - totals.sell).toLocaleString('en-US'),
        valueClass: totals.buy - totals.sell >= 0 ? 'text-up' : 'text-down',
        sub: '多 − 空',
      },
      { label: '上榜席位数', value: String(stats.value.length), sub: '三榜并集' },
    ];
  }
  const memberCount = isAllScope.value
    ? aggregates.value.length
    : new Set(dayData.value?.rows.map((row) => row.memberName)).size;
  const cards: FuturesStatCard[] = [
    { label: '合并总多单', value: grandTotals.value.buy.toLocaleString('en-US'), valueClass: 'text-up', sub: '手' },
    { label: '合并总空单', value: grandTotals.value.sell.toLocaleString('en-US'), valueClass: 'text-down', sub: '手' },
  ];
  if (scope.value === 'product') {
    cards.push({ label: '总成交量', value: grandTotals.value.volume.toLocaleString('en-US'), sub: '手' });
  }
  cards.push(
    {
      label: '合并净差',
      value: grandTotals.value.net.toLocaleString('en-US'),
      valueClass: grandTotals.value.net >= 0 ? 'text-up' : 'text-down',
      sub: '多 − 空',
    },
    { label: '上榜席位数', value: String(memberCount), sub: isAllScope.value ? '四品种去重' : '三榜并集' },
  );
  return cards;
});

/**
 * 语义色类（正 up / 负 down）
 * @param value 数值
 * @returns 类名
 */
const signClass = (value: number): string => (value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-flat');

/**
 * 衍生榜单（contract 六榜 / aggregate 三榜，父级组装数值与语义色）
 */
const rankLists = computed(() => {
  if (scope.value === 'contract') {
    const pickTop = (
      rows: readonly CcpmMemberStats[],
      value: (row: CcpmMemberStats) => number | null,
      dir: 'desc' | 'asc',
    ): { name: string; value: number; cls: string }[] =>
      rows
        .map((row) => ({ name: row.memberName, value: value(row) }))
        .filter((item): item is { name: string; value: number } => item.value !== null && item.value !== 0)
        .sort((a, b) => (dir === 'desc' ? b.value - a.value : a.value - b.value))
        .slice(0, 5)
        .map((item) => ({ ...item, cls: item.value > 0 ? 'text-up' : 'text-down' }));
    return [
      { title: '净多 TOP', items: pickTop(stats.value, (row) => row.netPos, 'desc') },
      { title: '净空 TOP', items: pickTop(stats.value, (row) => row.netPos, 'asc') },
      { title: '多单增仓 TOP', items: pickTop(stats.value, (row) => row.buyChg, 'desc') },
      { title: '多单减仓 TOP', items: pickTop(stats.value, (row) => row.buyChg, 'asc') },
      { title: '空单增仓 TOP', items: pickTop(stats.value, (row) => row.sellChg, 'desc') },
      { title: '空单减仓 TOP', items: pickTop(stats.value, (row) => row.sellChg, 'asc') },
    ];
  }
  const pickAgg = (
    rows: readonly CcpmAggregateRow[],
    value: (row: CcpmAggregateRow) => number,
    dir: 'desc' | 'asc',
  ): { name: string; value: number; cls: string }[] =>
    rows
      .map((row) => ({ name: row.memberName, value: value(row) }))
      .filter((item) => item.value !== 0)
      .sort((a, b) => (dir === 'desc' ? b.value - a.value : a.value - b.value))
      .slice(0, 5)
      .map((item) => ({ ...item, cls: signClass(item.value) }));
  return [
    { title: '合并净多 TOP', items: pickAgg(aggregates.value, (row) => row.totalNet, 'desc') },
    { title: '合并净空 TOP', items: pickAgg(aggregates.value, (row) => row.totalNet, 'asc') },
    { title: '净增减 TOP', items: pickAgg(aggregates.value, (row) => row.totalNetChg, 'desc') },
  ];
});

/**
 * 选中 / 展开席位（总表行点击）
 * @param memberName 席位名
 */
const onSelectMember = (memberName: string): void => {
  memberPicked.value = true;
  selectedMember.value = selectedMember.value === memberName ? null : memberName;
};

/**
 * 展开 / 收起席位分解行
 * @param memberName 席位名
 */
const onToggleExpand = (memberName: string): void => {
  expandedMembers.value = expandedMembers.value.includes(memberName)
    ? expandedMembers.value.filter((item) => item !== memberName)
    : [...expandedMembers.value, memberName];
};

/** 加载席位时序（近 N 个披露日，逐日拉取） */
const loadSeries = async (): Promise<void> => {
  if (!selectedMember.value) {
    return;
  }
  seriesLoading.value = true;
  try {
    series.value = await fetchCcpmMemberSeries(
      selectedMember.value,
      isAllScope.value ? CCPM_EQUITY_PRODUCT_ORDER : [product.value],
      resolvedDay.value,
    );
  } finally {
    seriesLoading.value = false;
  }
};

/** 选中席位切换时清空旧时序 */
watch(selectedMember, () => {
  series.value = null;
});

/** 是否含部分头寸（聚合口径选中席位 / 时序提示） */
const selectedPartial = computed(
  () => selectedAggregate.value?.isPartial ?? false,
);

/* -------------------- 页头刷新与来源公告条（2026-10-22 王总指定，对齐期货总览页） -------------------- */

/** 页级动作挂载守卫：本页激活时才向 MainLayout 页头投射刷新按钮（KeepAlive 守卫） */
const { active: headerSlotActive } = usePageHeaderSlot();

/** 披露交易日（yyyy-MM-dd，数据未就绪为空串） */
const resolvedDayText = computed(() =>
  resolvedDay.value ? resolvedDay.value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '',
);

/** 数据来源公告条文案（NoticeBar 纯文本 prop，披露交易日随数据就绪拼接） */
const sourceNoticeText = computed(() =>
  resolvedDayText.value
    ? `数据来源：中金所 CCPM · 披露交易日 ${resolvedDayText.value}`
    : '数据来源：中金所 CCPM',
);
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 刷新按钮上移 MainLayout 页头（Teleport 投射，本页激活时才挂载） -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <BaseButton variant="ghost" :disabled="loading" data-track="FUTURES_INSTITUTIONAL_REFRESH" @click="void loadDay(dayInput, false, true)">
        <MenuIcon name="refresh" :size="14" />
        {{ loading ? '刷新中…' : '刷新' }}
      </BaseButton>
    </Teleport>

    <!-- 数据来源公告条（原底部披露行移除：来源改 NoticeBar、刷新上移页头） -->
    <NoticeBar :text="sourceNoticeText" />

    <FuturesFilterBar
      v-model:product="product"
      v-model:scope="scope"
      v-model:instrument="instrument"
      v-model:day="dayInput"
      v-model:search="search"
      :instruments="instruments"
    />

    <div class="rounded-card bg-flat-weak px-4 py-2.5 text-xs leading-relaxed text-text-secondary">
      <span class="font-semibold text-text">数据边界：</span>{{ FUTURES_PAGE_TEXT.dataBoundary }}
    </div>

    <div
      v-if="isAllScope"
      class="rounded-card bg-up-weak px-4 py-2.5 text-xs leading-relaxed text-up-strong"
    >
      <span class="font-semibold">⚠ 全股指合并口径提醒</span>
      <ul class="mt-1 list-inside list-disc space-y-0.5">
        <li v-for="line in FUTURES_PAGE_TEXT.allScopeWarn" :key="line">{{ line }}</li>
      </ul>
    </div>

    <div v-if="loading" class="flex flex-col gap-3">
      <BaseCard><BaseSkeleton /></BaseCard>
      <BaseCard><BaseSkeleton /></BaseCard>
    </div>

    <template v-else-if="noData || activeDataList.length === 0">
      <BaseCard>
        <BaseEmpty :text="`${dayInput} 无披露数据（非交易日或尚未披露）`" />
        <div class="flex justify-center pb-4">
          <BaseButton variant="ghost" @click="void fallbackToLatest()">切换到最近披露日</BaseButton>
        </div>
      </BaseCard>
    </template>

    <template v-else>
      <FuturesStatCards :cards="statCards" />

      <div v-if="selectedPartial" class="rounded-card bg-up-weak px-4 py-2 text-xs text-up-strong">
        {{ FUTURES_PAGE_TEXT.partialWarn }}
      </div>

      <div class="grid grid-cols-1 gap-3 min-[1200px]:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]">
        <BaseCard
          :title="scope === 'contract' ? `上榜会员总表 · ${instrument || instruments[0] || ''}` : '上榜会员总表（聚合口径）'"
          fill
          class="min-w-0"
        >
          <template #extra>
            <span class="text-xs text-text-tertiary">点击行选中画像，点击行首箭头展开分解</span>
          </template>
          <div class="flex min-h-0 flex-1 flex-col">
            <FuturesMemberTable
              :mode="scope === 'contract' ? 'contract' : 'aggregate'"
              :stats="visibleStats"
              :aggregates="visibleAggregates"
              :show-volume="scope === 'product'"
              :selected-member="selectedMember"
              :expanded-members="expandedMembers"
              @select="onSelectMember"
              @toggle-expand="onToggleExpand"
            >
              <template #expanded="{ row }">
                <FuturesBreakdownTable
                  :member-name="(row as { memberName: string }).memberName"
                  :rows="selectedBreakdownRows"
                  :total-count="totalCount"
                />
              </template>
            </FuturesMemberTable>
          </div>
        </BaseCard>

        <FuturesMemberProfile
          :scope="scope"
          :stats="selectedStats"
          :aggregate="selectedAggregate"
        />
      </div>

      <FuturesChartsPanel
        :scope="scope"
        :stats="stats"
        :aggregates="aggregates"
        :selected-member="selectedMember"
        :series="series"
        :series-loading="seriesLoading"
        :series-partial="selectedPartial"
        @load-series="void loadSeries()"
      />

      <FuturesRankPanel :lists="rankLists" />

      <FuturesRollPanel
        v-if="!isAllScope && dayData && dayData.instruments.length >= 2"
        :rows="dayData.rows"
        :instruments="dayData.instruments"
      />

      <BaseCard title="数据局限性（常驻提示）">
        <ol class="list-inside list-decimal space-y-1 text-xs leading-relaxed text-text-secondary">
          <li v-for="line in FUTURES_PAGE_TEXT.risks" :key="line">{{ line }}</li>
        </ol>
      </BaseCard>
    </template>
  </div>
</template>
