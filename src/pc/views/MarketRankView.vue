<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import MarketRankTiledBoard from '../components/business/MarketRankTiledBoard.vue';
import MarketRankTabSettingsModal from '../components/business/MarketRankTabSettingsModal.vue';
import { usePolling } from '../../common/composables/use-polling';
import { useDataCacheStore } from '../../common/stores/data-cache';
import { useSettingsStore } from '../../common/stores/settings';
import { useNotificationsStore } from '../../common/stores/notifications';
import { usePageHeaderSlot, PAGE_HEADER_ACTIONS_TARGET } from '../../common/composables/use-page-header-slot';
import { requestAgentAnalysis } from '../agent/agent-bridge';
import { buildRankAnalysisPrompt } from '../../common/utils/build-rank-analysis-prompt';
import { exportSheetsToExcel } from '../../common/utils/export-excel';
import { DATA_CACHE_KEY } from '../../common/constants/data-cache.constants.ts';
import { HOST_HEADER_ITEM } from '../../common/constants/header.constants.ts';
import { NOTIFY_TONE } from '../../common/constants/notify.constants.ts';
import { POLLING_INTERVAL } from '../../common/constants/polling.constants.ts';
import { STORAGE_NS_MARKET_RANK_TABS } from '../../common/constants/storage-key.constants.ts';
import { appStorage } from '../../common/utils/app-local-storage';
import type { FullQuote } from '../../common/types/stock-quote.types.ts';
import type { RankDataset } from '../../common/types/rank-dataset.types.ts';
import { sdk } from '../../common/api/sdk';

/**
 * 盘面雷达（原「市场榜单」，2026-10-22 更名；原「市场异动」页已并入）：
 * 2026-10-27 王总指定 —— Tab 模式已删除，页面主体 = 页签平铺看板（只读）：
 * 一个可见页签一列（375px 卡片流，参考热点新闻页样式），
 * 列顺序与显隐经「页签设置」弹窗调整（热点新闻源设置同款交互），持久化；
 * 页头保留 AI 分析 / 导出 Excel（作用于全部可见页签，多数据段 = 多工作表）。
 *
 * 报价排序榜数据源 stock-sdk `getAllAShareQuotes`（上游东方财富 push2，代理通道）：
 * 一次拉取全市场报价（约 5k+ 只），默认轮询 30 秒（与市场宽度一致）；
 * 其余页签（股池 / 异动 / 龙虎榜 / 大宗）的数据由看板组件自管
 */

  /**
   * 页签全集：三组式布局（组名仅供设置弹窗文案参考，看板列平铺不分组）——
   * 排行（同一份全 A 报价换 sortKey）｜股池事件（连板 / 盘口异动 / 板块异动）｜席位与大宗（龙虎榜 / 大宗交易）。
   * 2026-10-27 王总指定：个股主力列删除；原「异动」列的盘口 / 板块子视图拆成两个独立列
   */
const SORT_TAB_OPTIONS = [
  { label: '涨幅榜', value: 'changePercent' },
  { label: '跌幅榜', value: 'changePercentDesc' },
  { label: '成交额榜', value: 'amount' },
  { label: '换手率榜', value: 'turnoverRate' },
  { label: '连板', value: 'event' },
  { label: '盘口异动', value: 'stock-changes' },
  { label: '板块异动', value: 'board-changes' },
  { label: '龙虎榜', value: 'dragon-tiger' },
  { label: '大宗交易', value: 'block-trade' },
] as const;

const dataCache = useDataCacheStore();

/** 全 A 报价快照（报价排序类页签列消费；页面轮询写入） */
const allQuotes = ref<FullQuote[]>(
  dataCache.get<FullQuote[]>(DATA_CACHE_KEY.MARKET_RANK_QUOTES) ?? [],
);
const isLoading = ref(allQuotes.value.length === 0);
const isError = ref(false);

/** 拉取全市场行情（轮询调用） */
const fetchAll = async (): Promise<void> => {
  try {
    const quotes = await sdk.batch.cn();
    allQuotes.value = quotes;
    dataCache.set(DATA_CACHE_KEY.MARKET_RANK_QUOTES, quotes);
    isError.value = false;
  } catch (error) {
    isError.value = allQuotes.value.length === 0;
    console.error('[market-rank]', error);
  } finally {
    isLoading.value = false;
  }
};

void fetchAll();

usePolling({
  task: fetchAll,
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

// ---------- 页签列顺序与显隐（页签设置弹窗，热点新闻源设置同款交互） ----------

/** 页签设置（顺序 + 显隐；appStorage 持久化） */
interface RankTabSettings {
  /** 页签值顺序（缺失的页签按默认顺序补在末尾） */
  order: string[];
  /** 隐藏的页签值 */
  hidden: string[];
}

/**
 * 归一化页签设置：剔除已不存在的页签值，补齐新出现的页签（按默认顺序排末尾）
 * @param settings 持久化读出的设置
 * @returns 归一化后的设置
 */
const normalizeTabSettings = (settings: RankTabSettings): RankTabSettings => {
  const known = new Set<string>(SORT_TAB_OPTIONS.map((option) => option.value));
  const order = [
    ...settings.order.filter((value) => known.has(value)),
    ...SORT_TAB_OPTIONS.map((option) => option.value).filter(
      (value) => !settings.order.includes(value),
    ),
  ];
  return { order, hidden: settings.hidden.filter((value) => known.has(value)) };
};

/** 页签设置（appStorage 持久化，进页归一化一次；损坏数据回退默认全显） */
const tabSettings = ref<RankTabSettings>(
  normalizeTabSettings(
    (() => {
      try {
        return JSON.parse(appStorage.getItem(STORAGE_NS_MARKET_RANK_TABS) ?? 'null') as
          | RankTabSettings
          | null;
      } catch {
        return null;
      }
    })() ?? { order: SORT_TAB_OPTIONS.map((option) => option.value), hidden: [] },
  ),
);

// 设置整包持久化（下次进页恢复上次的列顺序与显隐）
watch(
  tabSettings,
  (value) => {
    appStorage.setItem(STORAGE_NS_MARKET_RANK_TABS, JSON.stringify(value));
  },
  { deep: true },
);

/** 可见页签列（顺序 = 设置顺序；看板 props 直接消费） */
const visibleTabs = computed(() =>
  tabSettings.value.order
    .filter((value) => !tabSettings.value.hidden.includes(value))
    .map((value) => SORT_TAB_OPTIONS.find((option) => option.value === value))
    .filter((option): option is (typeof SORT_TAB_OPTIONS)[number] => option !== undefined),
);

/** 页签设置弹窗条目（勾选 + 拖拽草稿的数据源） */
const tabSettingsItems = computed(() =>
  tabSettings.value.order.map((value) => {
    const option = SORT_TAB_OPTIONS.find((item) => item.value === value);
    return {
      value,
      label: option?.label ?? value,
      enabled: !tabSettings.value.hidden.includes(value),
    };
  }),
);

/** 页签设置弹窗开关 */
const tabSettingsOpen = ref(false);

/**
 * 页签设置确认：按拖拽结果更新顺序，勾选结果更新显隐（watch 自动持久化）
 * @param items 弹窗回传的页签设置（顺序即展示顺序）
 */
const onTabSettingsConfirm = (items: { value: string; enabled: boolean }[]): void => {
  tabSettings.value = {
    order: items.map((item) => item.value),
    hidden: items.filter((item) => !item.enabled).map((item) => item.value),
  };
};

// ---------- 榜单工具条：AI 分析 + 导出 Excel（页头 Teleport；作用于全部可见页签） ----------

const settingsStore = useSettingsStore();
const notifications = useNotificationsStore();

/** 页头动作挂载守卫：只有本页激活时按钮才出现在页头（KeepAlive 缓存页切走不残留） */
const { active: headerSlotActive } = usePageHeaderSlot();

/** 看板组件引用（榜单数据出口在其 expose 上） */
const boardRef = ref<InstanceType<typeof MarketRankTiledBoard> | null>(null);

/** 「AI 分析」入口跟随顶栏「Agent 分析」条目的显隐开关（设置 → 布局编排 → 右上角工具编排） */
const agentEntryVisible = computed(
  () => !settingsStore.hiddenHeaderItems.includes(HOST_HEADER_ITEM.AGENT),
);

/**
 * 导出文件名时间戳
 * @returns YYYYMMDD-HHmm 格式时间戳
 */
const exportStamp = (): string => {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  );
};

/**
 * 汇总全部可见页签的榜单数据段（AI 分析与导出 Excel 共用的数据出口）
 * @returns 数据段列表；看板未挂载 / 数据未加载时为空数组
 */
const collectRankDatasets = (): RankDataset[] => boardRef.value?.getRankDatasets() ?? [];

/** 「AI 分析」：把全部可见页签的榜单数据交给 Agent 分析 */
const onRankAiAnalysis = (): void => {
  const prompt = buildRankAnalysisPrompt('盘面雷达', collectRankDatasets());
  if (prompt === '') {
    notifications.push({
      title: '暂无可分析的榜单数据',
      body: '请等待榜单数据加载完成后再发起 AI 分析',
      tone: NOTIFY_TONE.FLAT,
    });
    return;
  }
  void requestAgentAnalysis(prompt);
};

/** 「导出 Excel」：把全部可见页签的榜单数据导出为 .xlsx（多数据段 = 多工作表） */
const onRankExport = async (): Promise<void> => {
  const datasets = collectRankDatasets();
  if (datasets.every((dataset) => dataset.rows.length === 0)) {
    notifications.push({
      title: '暂无可导出的榜单数据',
      body: '请等待榜单数据加载完成后再导出',
      tone: NOTIFY_TONE.FLAT,
    });
    return;
  }
  try {
    await exportSheetsToExcel(
      datasets.map((dataset) => ({
        name: dataset.title,
        rows: dataset.rows,
        columns: dataset.columns,
      })),
      `盘面雷达-${exportStamp()}`,
    );
  } catch (error) {
    console.error('[market-rank] export', error);
    notifications.push({
      title: '导出失败',
      body: '榜单数据导出 Excel 失败，请稍后重试',
      tone: NOTIFY_TONE.FLAT,
    });
  }
};
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <!-- 榜单工具条上移页头：页签设置 + AI 分析 + 导出 Excel（Teleport 投射，本页激活时才挂载） -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <div class="flex items-center gap-2">
        <BaseButton variant="ghost" data-track="MARKET_RANK_TAB_SETTINGS" @click="tabSettingsOpen = true">
          <MenuIcon name="settings" :size="14" />
          页签设置
        </BaseButton>
        <BaseButton v-if="agentEntryVisible" variant="ghost" @click="onRankAiAnalysis">
          <MenuIcon name="agent" :size="14" />
          AI 分析
        </BaseButton>
        <BaseButton variant="ghost" @click="onRankExport">
          <MenuIcon name="export" :size="14" />
          导出 Excel
        </BaseButton>
      </div>
    </Teleport>

    <!-- 页签平铺看板：一个可见页签一列（只读，不支持拖拽；列头内嵌子筛选，
         参考热点新闻卡片内部分组策略；列顺序/显隐 = 页签设置） -->
    <MarketRankTiledBoard
      ref="boardRef"
      class="min-h-0 flex-1"
      :tabs="visibleTabs"
      :quotes="allQuotes"
      :quotes-loading="isLoading"
    />

    <!-- 报价榜加载失败的兜底提示（上游可能限频或封禁；其余页签的失败态在看板列内） -->
    <p v-if="isError" class="shrink-0 text-xs text-down" role="alert">
      报价榜加载失败，请稍后重试（上游可能限频或封禁）
    </p>

    <!-- 页头「页签设置」弹窗（拖拽排序 + 勾选显隐） -->
    <MarketRankTabSettingsModal
      v-model:open="tabSettingsOpen"
      :items="tabSettingsItems"
      @confirm="onTabSettingsConfirm"
    />
  </div>
</template>
