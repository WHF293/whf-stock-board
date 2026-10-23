<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseModal from '../components/ui/BaseModal.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import BaseTextTip from '../components/ui/BaseTextTip.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import TabConfigButton from '../components/ui/TabConfigButton.vue';
import BreadthIndicatorChart from '../components/charts/BreadthIndicatorChart.vue';
import {
  BREADTH_ACTIVE_TURNOVER_THRESHOLD,
  BREADTH_ADL_MA_PERIOD,
  BREADTH_ARMS_MA_PERIOD,
  BREADTH_INDICATOR_INFO,
  BREADTH_INDICATOR_KIND,
  BREADTH_INDICATOR_VIEW,
  BREADTH_INDICATOR_VIEW_OPTIONS,
  type BreadthIndicatorKind,
  type BreadthIndicatorViewKey,
} from '../../common/constants/market-breadth.constants.ts';
import { POLLING_INTERVAL } from '../../common/constants/polling.constants.ts';
import type { BreadthDayBar, BreadthPoint } from '../../common/types/market-breadth.types.ts';
import { fetchAllMarketQuotes } from '../../common/api/quotes.api.ts';
import { ingestBreadthSnapshot, readBreadthBars, readBreadthDay } from '../../common/api/market-breadth-db.api';
import { computeBreadthIndicatorSeries } from '../../common/utils/compute-breadth-indicators';
import { classifyArms, type ArmsStateResult } from '../../common/utils/classify-arms';
import { interpretBreadthValue } from '../../common/utils/interpret-breadth';
import { toDayKey } from '../../common/utils/to-day-key';
import { usePolling } from '../../common/composables/use-polling';
import { usePageHeaderSlot, PAGE_HEADER_ACTIONS_TARGET } from '../../common/composables/use-page-header-slot';
import { useTabConfig, type TabOption } from '../../common/composables/use-tab-config';

/**
 * 市场宽度页（PC，2026-10-22 由「市场广度指标」改名）
 *
 * 五大经典市场广度指标副图组（ADL / ADR / OBOS / ARMS / MCO）+ 活跃占比副图
 * （换手率 > 5% 家数占比，2026-10-23 王总指定新增），基于本地积累的
 * 日 bar（readBreadthBars）经 computeBreadthIndicatorSeries 离线计算。
 * 数据生产：本页自带一路与市场总览同规格的全市场快照轮询（tradingAware，
 * 挂载必跑一次）——页面切走时总览轮询因 KeepAlive 暂停，若本页只读不产，
 * 停留本页期间快照就无人 ingest（收盘后打开更是永远定稿不了当日 bar），
 * 因此本页活跃时由本页负责 ingest，同一时刻只有活跃页在轮询，总请求量不变。
 */
/** MCO 趋稳所需参考积累天数（EMA39 + 信号线预热） */
const MCO_READY_DAYS = 50;

/** 页头动作挂载守卫（「当日总结」按钮 Teleport 到 MainLayout 页头，本页激活时才挂载） */
const { active: headerSlotActive } = usePageHeaderSlot();

/** 「当日总结」弹窗开关（2026-10-22 王总指定） */
const summaryOpen = ref(false);

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
    console.warn('[market-breadth] snapshot ingest failed', error);
  }
};

/** 全市场快照轮询（与市场总览同频；tradingAware 收盘后仅挂载跑一次） */
usePolling({
  task: fetchAndIngest,
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

onMounted(refreshFromLocal);

/** 五指标序列（随 bars 全量重算，250 bar 量级毫秒级完成） */
const series = computed(() => computeBreadthIndicatorSeries(bars.value));

/** 已积累交易日数 */
const accumDays = computed(() => bars.value.length);

/** 当日概览（当日最后一个分钟点；无采样为 null） */
const todayPoint = computed<BreadthPoint | null>(() => todaySeries.value.at(-1) ?? null);

/** 当日活跃占比（%，当日末点活跃家数 ÷ 有效家数；旧点无字段或分母为 0 为 null） */
const todayActiveRatio = computed<number | null>(() => {
  const point = todayPoint.value;
  if (point?.activeCount === undefined || !point.activeTotal) return null;
  return (point.activeCount / point.activeTotal) * 100;
});

/** ARMS 现值五档状态（null 显「--」） */
const armsState = computed<ArmsStateResult | null>(() =>
  classifyArms(todayPoint.value?.arms ?? null),
);

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
  active: lastValue(series.value.activeRatio),
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

/** 「当日总结」弹窗条目：指标名 / 最新值 / 白话解读（与副图 hover 同一解读口径） */
const summaryItems = computed(() => {
  const s = series.value;
  /**
   * 序列末位取值（最新交易日；空序列 null）
   * @param values 指标序列
   * @returns 末位值；全空为 null
   */
  const at = (values: ReadonlyArray<number | null>): number | null =>
    s.dates.length === 0 ? null : (values[s.dates.length - 1] ?? null);
  const build = (
    kind: BreadthIndicatorKind,
    label: string,
    value: number | null,
    digits: number,
    ma?: number | null,
  ) => ({
    kind,
    label,
    display: value === null ? '--' : Math.abs(value) >= 1000 ? value.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : value.toFixed(digits),
    interpret: interpretBreadthValue(kind, value, ma),
  });
  return [
    build('adl', 'ADL 腾落线', at(s.adl), 0, at(s.adlMa)),
    build('adr', 'ADR 涨跌比率', at(s.adr), 2),
    build('obos', 'OBOS 超买超卖', at(s.obos), 0),
    build('arms', 'TRIN 阿姆氏（ARMS）', at(s.armsMa), 2),
    build('mco', '麦克莱伦震荡（MCO）', at(s.mco), 1),
    build('active', `活跃占比（换手率＞${BREADTH_ACTIVE_TURNOVER_THRESHOLD}%）`, at(s.activeRatio), 1),
  ];
});

/** 总结弹窗副标题：最新交易日（MM-DD） */
const summaryDateLabel = computed(() => series.value.dates.at(-1)?.slice(5) ?? '--');

/**
 * 解读行语义色（跟随涨跌配色主题的 CSS 变量类）
 * @param tone 语义档位
 * @returns Tailwind 文字色类
 */
const toneClass = (tone: 'up' | 'down' | 'flat'): string =>
  tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-text';

/** ADR/OBOS 是否达标准口径周期 */
const adrReady = computed(() => accumDays.value >= 10);

/** ARMS 平滑均线是否达惯例周期 */
const armsMaReady = computed(() => accumDays.value >= BREADTH_ARMS_MA_PERIOD);

/** MCO 是否过预热期（约 50 日，参考值） */
const mcoReady = computed(() => accumDays.value >= MCO_READY_DAYS);

/** 窗口内是否无任何数据（整页空态判定） */
const isPageEmpty = computed(() => series.value.dates.length === 0);

/**
 * 指标说明气泡文本（公式 + 空行 + 意义，\n 分行由气泡 pre-line 渲染）
 * @param kind 指标 kind
 * @returns 气泡完整文本
 */
const infoText = (kind: BreadthIndicatorKind): string => {
  const info = BREADTH_INDICATOR_INFO[kind];
  return `${info.formula}\n\n${info.meaning}`;
};

/** 副图卡标题行右侧的就绪徽标文案 */
const readinessBadges = computed(() => [
  { label: `ADR/OBOS N=10 ${adrReady.value ? '已就绪' : `积累中 ${accumDays.value}/10`}`, ok: adrReady.value },
  { label: `ARMS MA${BREADTH_ARMS_MA_PERIOD} ${armsMaReady.value ? '已就绪' : `积累中 ${accumDays.value}/${BREADTH_ARMS_MA_PERIOD}`}`, ok: armsMaReady.value },
  { label: `MCO ${mcoReady.value ? '已趋稳' : `预热中 ${accumDays.value}/${MCO_READY_DAYS}`}`, ok: mcoReady.value },
]);

/**
 * 五指标副图卡配置（声明顺序 = 默认展示顺序）
 *
 * 2026-10-22 王总指定：参考盘面雷达加排序入口（TabConfigButton），显隐与
 * 顺序经 useTabConfig 持久化（pageId = market-breadth）。
 */
const INDICATOR_CARDS: readonly {
  /** 指标 kind（同时也是页签 value 与 BreadthIndicatorChart 的 kind） */
  key: BreadthIndicatorKind;
  /** 最新值在 latest computed 里的键（ARMS 用平滑均线值，键名不同） */
  latestKey: 'adl' | 'adr' | 'obos' | 'armsMa' | 'mco' | 'active';
  /** 卡标题 */
  label: string;
  /** 标题行右侧口径说明 */
  subtitle: string;
  /** 最新值小数位 */
  digits: number;
}[] = [
  {
    key: BREADTH_INDICATOR_KIND.ADL,
    latestKey: 'adl',
    label: 'ADL 腾落线',
    digits: 0,
    subtitle: `Σ(上涨−下跌家数)，起点为本地首条 bar（相对意义）；虚线为 MA${BREADTH_ADL_MA_PERIOD}`,
  },
  {
    key: BREADTH_INDICATOR_KIND.ADR,
    latestKey: 'adr',
    label: 'ADR 涨跌比率',
    digits: 2,
    subtitle: 'N=10；＞1.5 超买，＜0.5 超卖',
  },
  {
    key: BREADTH_INDICATOR_KIND.OBOS,
    latestKey: 'obos',
    label: 'OBOS 超买超卖',
    digits: 0,
    subtitle: 'N=10 净差（家）；正值多头占优',
  },
  {
    key: BREADTH_INDICATOR_KIND.ARMS,
    latestKey: 'armsMa',
    label: 'TRIN 阿姆氏（ARMS）',
    digits: 2,
    subtitle: `日线 + MA${BREADTH_ARMS_MA_PERIOD}；＜1 多头强，＞1 空头强`,
  },
  {
    key: BREADTH_INDICATOR_KIND.MCO,
    latestKey: 'mco',
    label: '麦克莱伦震荡（MCO）',
    digits: 1,
    subtitle: 'EMA19−EMA39；±25~35 为超买超卖区',
  },
  {
    key: BREADTH_INDICATOR_KIND.ACTIVE,
    latestKey: 'active',
    label: '活跃占比',
    digits: 1,
    subtitle: `换手率＞${BREADTH_ACTIVE_TURNOVER_THRESHOLD}% 家数占比（%）；越高交投越热`,
  },
];

/** 排序弹窗页签项（value = 指标 kind） */
const INDICATOR_CARD_TABS: readonly TabOption<BreadthIndicatorKind>[] = INDICATOR_CARDS.map(
  (card) => ({ label: card.label, value: card.key }),
);

/** kind → 卡配置（渲染按 useTabConfig 归一化后的顺序查这张表） */
const cardMetaByKey = new Map(INDICATOR_CARDS.map((card) => [card.key, card]));

/** 指标卡显隐 + 顺序（持久化；全部隐藏时兜底默认全显，激活值概念不适用故只取 visibleOptions） */
const { visibleOptions: indicatorCardOptions } = useTabConfig<BreadthIndicatorKind>(
  'market-breadth',
  INDICATOR_CARD_TABS,
);
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 「当日总结」按钮上移 MainLayout 页头（Teleport 投射，本页激活时才挂载） -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <BaseButton variant="ghost" data-track="MARKET_BREADTH_SUMMARY" @click="summaryOpen = true">
        当日总结
      </BaseButton>
    </Teleport>

    <BaseCard title="市场宽度 · 当日概览">
      <template #extra>
        <span
          class="rounded-full px-2.5 py-1 text-xs font-bold"
          style="color: var(--color-primary); background: var(--color-primary-weak)"
        >
          已积累 {{ accumDays }} 个交易日
        </span>
      </template>

      <div class="flex flex-wrap items-stretch gap-3">
        <div
          class="min-w-[180px] flex-1 rounded-lg bg-flat-weak px-3 py-2"
        >
          <div class="text-xs text-text-secondary">上涨 / 平盘 / 下跌</div>
          <div class="mt-0.5 text-lg font-bold tabular-nums">
            <span class="text-up">{{ todayPoint ? todayPoint.upCount.toLocaleString() : '--' }}</span>
            <span class="text-text-secondary"> / </span>
            <span class="text-text">{{ todayPoint ? todayPoint.flatCount.toLocaleString() : '--' }}</span>
            <span class="text-text-secondary"> / </span>
            <span class="text-down">{{ todayPoint ? todayPoint.downCount.toLocaleString() : '--' }}</span>
          </div>
        </div>
        <div class="min-w-[180px] flex-1 rounded-lg bg-flat-weak px-3 py-2">
          <div class="text-xs text-text-secondary">上涨量 / 下跌量（手）</div>
          <div class="mt-0.5 text-lg font-bold tabular-nums">
            <span class="text-up">{{ todayPoint ? todayPoint.upVol.toLocaleString() : '--' }}</span>
            <span class="text-text-secondary"> / </span>
            <span class="text-down">{{ todayPoint ? todayPoint.downVol.toLocaleString() : '--' }}</span>
          </div>
        </div>
        <div class="min-w-[140px] flex-1 rounded-lg bg-flat-weak px-3 py-2">
          <div class="text-xs text-text-secondary">ARMS 现值</div>
          <div class="mt-0.5 flex items-baseline gap-2">
            <span class="text-lg font-bold tabular-nums">{{ fmt(todayPoint?.arms ?? null) }}</span>
            <span
              v-if="armsState"
              class="rounded-full px-2 py-0.5 text-xs font-bold"
              :style="{
                color:
                  armsState.tone === 'up'
                    ? 'var(--color-up-strong)'
                    : armsState.tone === 'down'
                      ? 'var(--color-down-strong)'
                      : 'var(--color-flat)',
                background:
                  armsState.tone === 'up'
                    ? 'var(--color-up-weak)'
                    : armsState.tone === 'down'
                      ? 'var(--color-down-weak)'
                      : 'var(--color-flat-weak)',
              }"
            >
              {{ armsState.label }}
            </span>
          </div>
        </div>
        <div class="min-w-[180px] flex-1 rounded-lg bg-flat-weak px-3 py-2">
          <div class="text-xs text-text-secondary">活跃股（换手率＞{{ BREADTH_ACTIVE_TURNOVER_THRESHOLD }}%）</div>
          <div class="mt-0.5 text-lg font-bold tabular-nums">
            {{ todayPoint?.activeCount !== undefined ? todayPoint.activeCount.toLocaleString() : '--' }}
            <span class="text-sm text-text-secondary">家 / {{ fmt(todayActiveRatio, 1) }}%</span>
          </div>
        </div>
      </div>
      <div v-if="todayPoint === null" class="mt-2 text-xs text-text-tertiary">
        今日暂无采样（交易日盘中本页自动拉取全市场快照积累，收盘后定稿为当日日 bar）
      </div>
    </BaseCard>

    <BaseEmpty
      v-if="isPageEmpty"
      text="历史广度数据按本地逐日积累（收盘后落库，无法回填）；本页已自动拉取快照，收盘后首个交易日即出图"
    />

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <BaseTabs v-model="view" :options="BREADTH_INDICATOR_VIEW_OPTIONS" />
        <span
          v-for="badge in readinessBadges"
          :key="badge.label"
          class="rounded-full px-2.5 py-1 text-xs font-bold"
          :style="
            badge.ok
              ? 'color: var(--color-up-strong); background: var(--color-up-weak)'
              : 'color: var(--color-flat); background: var(--color-flat-weak)'
          "
        >
          {{ badge.label }}
        </span>
        <!-- 指标卡显隐 + 排序入口（同盘面雷达 TabConfigButton 交互，2026-10-22 王总指定） -->
        <TabConfigButton class="ml-auto" page-id="market-breadth" :options="INDICATOR_CARD_TABS" />
      </div>

      <!-- 指标副图：顺序与显隐按 useTabConfig 配置渲染；宽容器一行两列、窄容器单列
           （主区已开 @container，侧栏折叠 / 详情停靠面板开合都会实时响应） -->
      <div class="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
        <BaseCard v-for="option in indicatorCardOptions" :key="option.value">
          <div class="mb-2 flex items-center gap-1.5">
            <h2 class="text-sm font-semibold text-text">{{ cardMetaByKey.get(option.value)?.label }}</h2>
            <BaseTextTip as="span" class="cursor-help" :text="infoText(option.value)" placement="top">
              <MenuIcon name="help" :size="14" class="text-text-tertiary transition-colors hover:text-primary" />
            </BaseTextTip>
            <span class="text-sm font-bold tabular-nums">
              {{ fmt(latest[cardMetaByKey.get(option.value)!.latestKey], cardMetaByKey.get(option.value)!.digits) }}
            </span>
            <span class="ml-auto truncate pl-3 text-xs text-text-tertiary">
              {{ cardMetaByKey.get(option.value)?.subtitle }}
            </span>
          </div>
          <BreadthIndicatorChart :kind="option.value" :view="view" :bars="bars" :series="series" />
        </BaseCard>
      </div>
    </template>

    <!-- 当日总结弹窗：五指标最新日期的值 + 白话解读（与副图 tooltip hover 同一解读口径，
         2026-10-22 王总指定；解读函数单源 common/utils/interpret-breadth.ts） -->
    <BaseModal v-model:open="summaryOpen" title="当日总结" max-width-class="max-w-lg">
      <p class="mb-3 text-xs text-text-tertiary">
        六大指标截至 {{ summaryDateLabel }} 的最新解读，按指标逐条罗列
      </p>
      <ul class="space-y-2">
        <li
          v-for="item in summaryItems"
          :key="item.kind"
          class="rounded-lg bg-flat-weak px-3 py-2"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="text-xs font-medium text-text-secondary">{{ item.label }}</span>
            <b class="text-sm tabular-nums text-text">{{ item.display }}</b>
          </div>
          <p
            class="mt-0.5 text-xs"
            :class="item.interpret ? toneClass(item.interpret.tone) : 'text-text-tertiary'"
          >
            {{ item.interpret ? `▸ ${item.interpret.text}` : '暂无数据（指标积累中）' }}
          </p>
        </li>
      </ul>
    </BaseModal>
  </div>
</template>
