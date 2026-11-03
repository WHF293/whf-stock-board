<script setup lang="ts">
import { computed, onActivated, ref } from 'vue';
import { useRoute } from 'vue-router';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import TabConfigButton from '../components/ui/TabConfigButton.vue';
import { useTabConfig } from '../../common/composables/use-tab-config';
import PanoramaCnBoard from '../components/business/PanoramaCnBoard.vue';
import PanoramaLeadersBoard from '../components/business/PanoramaLeadersBoard.vue';
import PanoramaMarginBoard from '../components/business/PanoramaMarginBoard.vue';
import StockMarketView from './StockMarketView.vue';
import HongKongMarketView from './HongKongMarketView.vue';
import {
  fetchGlobalFuturesPanorama,
  fetchGlobalIndexPanorama,
  fetchGlobalTechPanorama,
  fetchUsSectorPanorama,
} from '../../common/api/panorama.api.ts';
import { PANORAMA_MACRO_GROUPS } from '../../common/constants/panorama.constants.ts';
import { DATA_CACHE_KEY } from '../../common/constants/data-cache.constants.ts';
import type { PanoramaItem, PanoramaMacroGroup } from '../../common/types/panorama.types.ts';
import { getTrendByChangePercent } from '../../common/constants/trend.constants.ts';
import { TREND_TEXT_CLASS } from '../../common/constants/stock-colors.constants.ts';
import { formatPercent } from '../../common/utils/format-percent';
import { delay } from '../../common/utils/delay';
import { useDataCacheStore } from '../../common/stores/data-cache';
import { useSettingsStore } from '../../common/stores/settings';
import { usePolling } from '../../common/composables/use-polling';
import { POLLING_INTERVAL } from '../../common/constants/polling.constants.ts';
import { PAGE_HEADER_ACTIONS_TARGET, usePageHeaderSlot } from '../../common/composables/use-page-header-slot';

/**
 * 行情全景（2026-10-29 王总指定整合）：全景（A股 36 板块平铺 + 国外科技巨头
 * （2026-11-02 新增美股巨头，2026-11-03 扩为美/日/韩三市场，置于行业 ETF 卡上方）+
 * 美股行业 ETF + 全球宏观 四组卡片竖向分布，原三个独立 tab 合并）/
 * 行业龙头（板块 / 细分赛道静态清单卡片流）/
 * 大A个股（原侧栏「个股行情」页并入，2026-10-22 王总指定；2026-10-30 更名）/
 * 港股个股（2026-10-30 王总指定新增，同花顺港股板块）
 *
 * 注：原「最新板块资金」模块已于 2026-10-13 独立成页（/board-flow 资金流向）；
 * 原「大盘云图」tab 已于 2026-10-13 独立成页（/heatmap 大盘云图，侧栏入口 2026-10-22 移除，
 * 改由市场总览页头按钮进入）；
 * 原「新股次新股」tab 已于 2026-10-29 并入盘面雷达页签平铺看板（新股次新列）；
 * 原「历史牛熊复盘」tab 已于 2026-10-30 转插件分发（dsh-history-review，侧栏「插件」组进入）
 *
 * 美股与全球宏观只展示名称 + 涨跌幅（网格卡片）；进入页面串行错峰拉取一次
 * （不参与轮询）；数据先取内存快照秒出 UI，接口成功后写回快照并刷新；
 * A股全景 / 全部个股由各自组件自管数据
 */

/** 模块 tab 选项（margin = 融资融券，2026-11-02 王总指定新增，入口 = 市场总览两融卡标题） */
const MODULE_TABS = [
  { label: '全景', value: 'overview' },
  { label: '行业龙头', value: 'leaders' },
  { label: '大A个股', value: 'stocks' },
  { label: '港股个股', value: 'hkStocks' },
  { label: '融资融券', value: 'margin' },
] as const;

/** 各接口请求间隔（毫秒）：对同一上游串行错峰 */
const REQUEST_GAP_MS = 500;

// 页签显隐 + 顺序可配置（持久化，右上角「配置页签」按钮）；激活值被隐藏时自动回退首个可见 tab
const { visibleOptions: moduleTabOptions, activeValue: activeModule } = useTabConfig(
  'panorama',
  MODULE_TABS,
);

// 深链支持（2026-11-02）：`/panorama?tab=margin` 直开指定 tab（市场总览融资融券卡标题跳入）
const route = useRoute();
{
  const queryTab = typeof route.query.tab === 'string' ? route.query.tab : '';
  if ((MODULE_TABS as readonly { value: string }[]).some((tab) => tab.value === queryTab)) {
    activeModule.value = queryTab as typeof activeModule.value;
  }
}

/** 是否处于组件自管数据的模块（行业龙头 / 大A个股 / 港股个股 / 融资融券：宿主不拉数据） */
const isSelfManagedModule = computed(
  () =>
    activeModule.value === 'leaders' ||
    activeModule.value === 'stocks' ||
    activeModule.value === 'hkStocks' ||
    activeModule.value === 'margin',
);

const dataCache = useDataCacheStore();

// 快照播种：切换回本页先展示上次数据
const cachedUs = dataCache.get<PanoramaItem[]>(DATA_CACHE_KEY.PANORAMA_US_BOARDS);
const cachedGlobalTech = dataCache.get<PanoramaMacroGroup[]>(DATA_CACHE_KEY.PANORAMA_GLOBAL_TECH);
const cachedMacro = dataCache.get<PanoramaMacroGroup[]>(DATA_CACHE_KEY.PANORAMA_MACRO);

/** 美股行业 ETF 全景 */
const usBoards = ref<PanoramaItem[]>(cachedUs ?? []);
/** 国外科技巨头（美/日/韩分组，2026-11-02 新增、2026-11-03 扩三市场并分组） */
const globalTech = ref<PanoramaMacroGroup[]>(cachedGlobalTech ?? []);
/** 全球宏观分组 */
const macroGroups = ref<PanoramaMacroGroup[]>(cachedMacro ?? []);
/** 当前模块是否拉取中（有快照则不进骨架） */
const isLoading = ref(
  activeModule.value === 'overview' && usBoards.value.length === 0 && macroGroups.value.length === 0,
);
/** 当前模块拉取是否失败（且无快照） */
const isError = ref(false);

/**
 * 按配置关键词顺序在数据池内逐项匹配（名称包含即命中）：
 * 优先名称与关键词完全一致的条目（指数 / 主力连续合约），否则取最后一个命中
 * （外盘合约按到期月升序排列，最后一个为最新主力）；
 * 未命中的关键词也保留占位（名称仍显示、涨跌幅 `--`，2026-11-03 王总指定）
 * @param items 上游条目
 * @param keywords 展示关键词
 * @returns 匹配到的条目（顺序与 keywords 一致；缺行条目 changePercent = null）
 */
const matchKeywords = (items: PanoramaItem[], keywords: readonly string[]): PanoramaItem[] =>
  keywords.map((keyword) => {
    const hits = items.filter((item) => item.name.includes(keyword));
    const exact = hits.find((item) => item.name === keyword);
    const hit = exact ?? hits.at(-1);
    return hit ?? { name: keyword, changePercent: null };
  });

/**
 * 拉取全球宏观（全球指数 → 外盘商品串行错峰，再按配置分组匹配）
 * @returns 分组后的宏观条目（配置的分组全量返回，缺行条目数值 `--`）
 */
const fetchMacro = async (): Promise<PanoramaMacroGroup[]> => {
  const indexItems = await fetchGlobalIndexPanorama();
  await delay(REQUEST_GAP_MS);
  const futuresItems = await fetchGlobalFuturesPanorama();
  return PANORAMA_MACRO_GROUPS.map((group) => {
    const pool = group.source === 'index' ? indexItems : futuresItems;
    return { label: group.label, items: matchKeywords(pool, group.keywords) };
  });
};

/** 拉取美股全景（成功后写快照；供轮询与模块切换复用） */
const fetchUsBoards = async (): Promise<void> => {
  usBoards.value = await fetchUsSectorPanorama();
  dataCache.set(DATA_CACHE_KEY.PANORAMA_US_BOARDS, usBoards.value);
};

/** 拉取国外科技巨头（成功后写快照；与行业 ETF 同一 ulist 通道） */
const fetchGlobalTech = async (): Promise<void> => {
  globalTech.value = await fetchGlobalTechPanorama();
  dataCache.set(DATA_CACHE_KEY.PANORAMA_GLOBAL_TECH, globalTech.value);
};

/** 拉取当前模块数据（成功后写快照；全景 tab = 美股 + 科技巨头 + 宏观串行错峰，其余由组件自管） */
const loadActiveModule = async (): Promise<void> => {
  if (isSelfManagedModule.value) return;
  isLoading.value = true;
  isError.value = false;
  try {
    if (activeModule.value === 'overview') {
      // 美股 → 科技巨头 → 宏观串行错峰（同一 push2delay 上游），任一失败不清空已有快照
      try {
        await fetchUsBoards();
      } catch (error) {
        console.error('[panorama] us', error);
      }
      await delay(REQUEST_GAP_MS);
      try {
        await fetchGlobalTech();
      } catch (error) {
        console.error('[panorama] global tech', error);
      }
      await delay(REQUEST_GAP_MS);
      macroGroups.value = await fetchMacro();
      dataCache.set(DATA_CACHE_KEY.PANORAMA_MACRO, macroGroups.value);
    }
  } catch (error) {
    console.error('[panorama]', error);
    isError.value = true;
  } finally {
    isLoading.value = false;
  }
};

// 首次进入全景 tab 时拉取一次（重接口不轮询，避免触发上游反爬；其余 tab 组件自管）
if (activeModule.value === 'overview') {
  void loadActiveModule();
}

// KeepAlive 缓存页面：切走再切回不重新挂载，重拉当前非自管模块（快照秒出后静默覆盖；
// 首次 onActivated 紧跟首屏触发，跳过避免重复请求；宏观无轮询兜底，这里是它唯一的自动刷新点）
let panoramaActivatedOnce = false;
onActivated(() => {
  if (!panoramaActivatedOnce) {
    panoramaActivatedOnce = true;
    return;
  }
  if (!isSelfManagedModule.value && !isLoading.value) {
    void loadActiveModule();
  }
});

// 美股全景轮询：仅在美股轮询窗口（21:30-24:00 与 00:00-04:00）内按间隔刷新，
// 窗口外与非全景 tab 自动跳过；科技巨头与行业 ETF 同窗口错峰刷新
usePolling({
  task: async () => {
    if (activeModule.value === 'overview') {
      await fetchUsBoards();
      await delay(REQUEST_GAP_MS);
      await fetchGlobalTech();
    }
  },
  intervalMs: POLLING_INTERVAL.US_BOARDS,
  tradingAware: true,
  market: 'US',
  immediate: false,
});

// 亚太轮询（2026-11-03 随「国外科技巨头」扩日韩引入）：仅亚太窗口（周一~五 08:00-14:30
// 北京时间）内刷新科技巨头清单——日股 176 / 韩股 177 的交易时段在 A 股盘中，美股窗口
// 盖不住；与美股窗口（21:30-04:00）不重叠，两个轮询器不会并发打同一上游
usePolling({
  task: async () => {
    if (activeModule.value === 'overview') {
      await fetchGlobalTech();
    }
  },
  intervalMs: POLLING_INTERVAL.US_BOARDS,
  tradingAware: true,
  market: 'AP',
  immediate: false,
});

/**
 * 切换模块：自管组件面板直接展示；全景 tab 有快照直接展示，无快照则拉取
 */
const onSelectModule = (): void => {
  isError.value = false;
  if (isSelfManagedModule.value) {
    isLoading.value = false;
    return;
  }
  if (usBoards.value.length > 0 || globalTech.value.length > 0 || macroGroups.value.length > 0) {
    isLoading.value = false;
    return;
  }
  void loadActiveModule();
};

/** 全景 tab 是否无数据（失败 / 空集且无快照） */
const isEmpty = computed(
  () =>
    !isLoading.value &&
    usBoards.value.length === 0 &&
    globalTech.value.length === 0 &&
    macroGroups.value.length === 0,
);

// ---------- 卡片展开收起（2026-11-03 王总指定：四组卡可折叠，默认展开，持久化） ----------

const settingsStore = useSettingsStore();

/**
 * 卡片是否收起（settings.panoramaCollapsedCards 持久化，默认全部展开）
 * @param cardId 卡片 id（`cn` / `globalTech` / `usBoards` / `macro`）
 * @returns true 表示该卡当前收起
 */
const isCardCollapsed = (cardId: string): boolean =>
  settingsStore.panoramaCollapsedCards.includes(cardId);

/**
 * 切换卡片收起状态（写回 settings 持久化）
 * @param cardId 卡片 id（`cn` / `globalTech` / `usBoards` / `macro`）
 * @returns void
 */
const toggleCard = (cardId: string): void => {
  settingsStore.togglePanoramaCardCollapsed(cardId);
};

// ---------- 手动刷新（2026-11-02 王总指定：各 tab 补刷新按钮） ----------

/** 行业龙头面板实例（调用其暴露的 refresh / loading） */
const leadersRef = ref<InstanceType<typeof PanoramaLeadersBoard> | null>(null);
/** 大A个股面板实例 */
const stocksRef = ref<InstanceType<typeof StockMarketView> | null>(null);
/** 港股个股面板实例 */
const hkStocksRef = ref<InstanceType<typeof HongKongMarketView> | null>(null);
/** 融资融券面板实例 */
const marginRef = ref<InstanceType<typeof PanoramaMarginBoard> | null>(null);

/** 自管 tab 当前的拉取中状态（无实例时 false，按钮旋转动画用） */
const selfManagedLoading = computed(() => {
  if (activeModule.value === 'leaders') return leadersRef.value?.loading ?? false;
  if (activeModule.value === 'stocks') return stocksRef.value?.loading ?? false;
  if (activeModule.value === 'hkStocks') return hkStocksRef.value?.loading ?? false;
  if (activeModule.value === 'margin') return marginRef.value?.loading ?? false;
  return false;
});

/** 刷新按钮是否旋转中（全景 tab 复用 isLoading；自管 tab 读组件暴露的 loading） */
const isRefreshing = computed(() =>
  activeModule.value === 'overview' ? isLoading.value : selfManagedLoading.value,
);

/**
 * 点刷新按钮：重拉当前 tab 全部模块数据
 * （全景 = A股板块 + 美股 ETF + 科技巨头 + 全球宏观；其余 tab 调组件暴露的 refresh）
 */
const onManualRefresh = (): void => {
  if (activeModule.value === 'overview') {
    void loadActiveModule();
    return;
  }
  if (activeModule.value === 'leaders') leadersRef.value?.refresh();
  else if (activeModule.value === 'stocks') stocksRef.value?.refresh();
  else if (activeModule.value === 'hkStocks') hkStocksRef.value?.refresh();
  else if (activeModule.value === 'margin') void marginRef.value?.refresh();
};

/** 页头挂载守卫（KeepAlive 缓存页：激活才投射，防按钮残留）——刷新按钮上移页头用 */
const { active: headerSlotActive } = usePageHeaderSlot();
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <div class="flex shrink-0 items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <BaseTabs
          v-model="activeModule"
          :options="moduleTabOptions"
          variant="underline"
          @update:model-value="onSelectModule"
        />
        <TabConfigButton page-id="panorama" :options="MODULE_TABS" />
      </div>
      <!-- 提示为辅助信息：容器过窄（抽屉打开挤主区）时整体隐藏，避免被挤成一字一行竖排 -->
      <span class="hidden shrink-0 text-xs text-text-tertiary @4xl:block">未开盘时展示最近交易日收盘数据</span>
    </div>

    <!-- 手动刷新上移 MainLayout 页头（2026-11-02 王总指定，「插件设置」左侧）：
         重拉当前 tab 全部模块数据，拉取中图标旋转 -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <BaseButton
        variant="ghost"
        :disabled="isRefreshing"
        @click="onManualRefresh"
      >
        <MenuIcon name="refresh" :size="14" :class="{ 'animate-spin': isRefreshing }" />
        {{ isRefreshing ? '刷新中…' : '刷新' }}
      </BaseButton>
    </Teleport>

    <!-- 模块内容统一滚动容器：页签行固定不动（2026-10-26 王总指定），
         全景三卡等多内容模块在此滚动，不再把整页撑出去带动页签滚走 -->
    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <!-- 行业龙头：板块 / 细分赛道静态清单卡片流（数据自管，ref 供刷新按钮调用） -->
      <PanoramaLeadersBoard ref="leadersRef" v-if="activeModule === 'leaders'" class="min-h-0 flex-1" />

      <!-- 大A个股：原侧栏「个股行情」页整卡并入（数据 / 轮询 / 翻页自管，v-if 挂载即启停轮询）；
           卡片吃满高度、仅表格内滚（.table-scroll-fill，2026-11-03 王总指定去外层滚动条） -->
      <div v-else-if="activeModule === 'stocks'" class="flex min-h-0 flex-1 flex-col">
        <StockMarketView ref="stocksRef" />
      </div>

      <!-- 港股个股：同花顺港股板块分页表（数据 / 轮询 / 翻页自管，挂载结构与大A个股同款） -->
      <div v-else-if="activeModule === 'hkStocks'" class="flex min-h-0 flex-1 flex-col">
        <HongKongMarketView ref="hkStocksRef" />
      </div>

      <!-- 融资融券：两融标的明细表（数据自管，日期切换；2026-11-02 王总指定新增 tab） -->
      <div v-else-if="activeModule === 'margin'" class="min-h-0 flex-1 overflow-y-auto">
        <PanoramaMarginBoard ref="marginRef" />
      </div>

      <!-- 加载骨架（全景：美股 / 宏观首载） -->
      <BaseCard v-else-if="isLoading">
        <div class="grid grid-cols-4 gap-2" aria-hidden="true">
          <div v-for="i in 12" :key="i" class="h-11 animate-pulse rounded-lg bg-flat-weak" />
        </div>
      </BaseCard>

      <!-- 失败 / 空态（全景） -->
      <BaseCard v-else-if="isEmpty">
        <BaseEmpty text="数据加载失败或暂无数据，请稍后重试（上游可能限频）" />
      </BaseCard>

      <!-- 全景：四组卡片竖向分布（A股 36 板块平铺 / 国外科技巨头 / 美股行业 ETF / 全球宏观），
           均支持展开收起（默认展开，折叠态持久化） -->
      <template v-else-if="activeModule === 'overview'">
        <PanoramaCnBoard
          class="shrink-0"
          collapsible
          :collapsed="isCardCollapsed('cn')"
          @update:collapsed="toggleCard('cn')"
        />

        <!-- 国外科技巨头（2026-11-02 新增美股巨头，2026-11-03 王总指定扩日韩、按市场分组并置顶）：
             组顺序 = 美国 → 日本 → 韩国，组内 = 配置顺序不重排；缺行标的名称仍显示、数值 `--` -->
        <BaseCard
          title="国外科技巨头"
          class="shrink-0"
          collapsible
          :collapsed="isCardCollapsed('globalTech')"
          @update:collapsed="toggleCard('globalTech')"
        >
          <div class="flex flex-col gap-4">
            <section v-for="group in globalTech" :key="group.label">
              <p class="mb-1.5 flex items-baseline gap-2">
                <span class="text-sm font-medium text-text">{{ group.label }}</span>
                <span class="text-xs text-text-tertiary">{{ group.items.length }} 项</span>
              </p>
              <div class="grid grid-cols-4 gap-2">
                <div
                  v-for="item in group.items"
                  :key="item.name"
                  class="flex items-center justify-between gap-2 rounded-lg bg-flat-weak px-3 py-2.5"
                >
                  <span class="truncate text-sm text-text" :title="item.name">{{ item.name }}</span>
                  <span
                    class="shrink-0 text-sm font-semibold tabular-nums"
                    :class="TREND_TEXT_CLASS[getTrendByChangePercent(item.changePercent ?? 0)]"
                  >
                    {{ formatPercent(item.changePercent) }}
                  </span>
                </div>
              </div>
            </section>
          </div>
        </BaseCard>

        <!-- 美股行业 ETF：扁平网格（缺行 ETF 名称仍显示、数值 `--`） -->
        <BaseCard
          title="美股行业 ETF"
          class="shrink-0"
          collapsible
          :collapsed="isCardCollapsed('usBoards')"
          @update:collapsed="toggleCard('usBoards')"
        >
          <div class="grid grid-cols-4 gap-2">
            <div
              v-for="item in usBoards"
              :key="item.name"
              class="flex items-center justify-between gap-2 rounded-lg bg-flat-weak px-3 py-2.5"
            >
              <span class="truncate text-sm text-text" :title="item.name">{{ item.name }}</span>
              <span
                class="shrink-0 text-sm font-semibold tabular-nums"
                :class="TREND_TEXT_CLASS[getTrendByChangePercent(item.changePercent ?? 0)]"
              >
                {{ formatPercent(item.changePercent) }}
              </span>
            </div>
          </div>
        </BaseCard>

        <!-- 全球宏观：单卡内分组网格（缺行条目名称仍显示、数值 `--`） -->
        <BaseCard
          title="全球宏观"
          class="shrink-0"
          collapsible
          :collapsed="isCardCollapsed('macro')"
          @update:collapsed="toggleCard('macro')"
        >
          <div class="flex flex-col gap-4">
            <section v-for="group in macroGroups" :key="group.label">
              <p class="mb-1.5 flex items-baseline gap-2">
                <span class="text-sm font-medium text-text">{{ group.label }}</span>
                <span class="text-xs text-text-tertiary">{{ group.items.length }} 项</span>
              </p>
              <div class="grid grid-cols-4 gap-2">
                <div
                  v-for="item in group.items"
                  :key="item.name"
                  class="flex items-center justify-between gap-2 rounded-lg bg-flat-weak px-3 py-2.5"
                >
                  <span class="truncate text-sm text-text">{{ item.name }}</span>
                  <span
                    class="shrink-0 text-sm font-semibold tabular-nums"
                    :class="TREND_TEXT_CLASS[getTrendByChangePercent(item.changePercent ?? 0)]"
                  >
                    {{ formatPercent(item.changePercent) }}
                  </span>
                </div>
              </div>
            </section>
          </div>
        </BaseCard>
      </template>
    </div>
  </div>
</template>
