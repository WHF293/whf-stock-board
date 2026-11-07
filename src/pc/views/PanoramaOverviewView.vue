<script setup lang="ts">
import { computed, onActivated, ref } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import PanoramaCnBoard from '../components/business/PanoramaCnBoard.vue';
import PanoramaModuleOrderModal from '../components/business/PanoramaModuleOrderModal.vue';
import {
  fetchGlobalFuturesPanorama,
  fetchGlobalIndexPanorama,
  fetchGlobalTechPanorama,
  fetchUsSectorPanorama,
} from '../../common/api/panorama.api.ts';
import { PANORAMA_CARDS, PANORAMA_MACRO_GROUPS } from '../../common/constants/panorama.constants.ts';
import { DATA_CACHE_KEY } from '../../common/constants/data-cache.constants.ts';
import type { PanoramaItem, PanoramaMacroGroup } from '../../common/types/panorama.types.ts';
import { getTrendByChangePercent } from '../../common/constants/trend.constants.ts';
import { TREND_TEXT_CLASS } from '../../common/constants/stock-colors.constants.ts';
import { formatPercent } from '../../common/utils/format-percent';
import { delay } from '../../common/utils/delay';
import { useDataCacheStore } from '../../common/stores/data-cache';
import { useSettingsStore } from '../../common/stores/settings';
import { useMarketStatusStore } from '../../common/stores/market-status';
import { usePolling } from '../../common/composables/use-polling';
import { POLLING_INTERVAL } from '../../common/constants/polling.constants.ts';
import { PAGE_HEADER_ACTIONS_TARGET, usePageHeaderSlot } from '../../common/composables/use-page-header-slot';

/**
 * 全景（原「行情全景」页 overview 页签独立成页，2026-11-06 王总指定拆分）：
 * A股 36 板块平铺 + 国外科技巨头（2026-11-02 新增美股巨头，2026-11-03 扩为美/日/韩
 * 三市场，置于美股基金卡上方）+ 美股基金（2026-11-07 替换原「美股行业 ETF」，26 个
 * 产业主题平铺、口径随美股时段自动切换）+ 全球宏观 四组卡片竖向分布
 * （原「行情全景」页的行业龙头 / 大A个股 / 港股个股页签同日分别拆为
 * /leaders 龙头、/stock-market 大A个股、/hk-stock 港股个股三个独立页；
 * 页面入口在市场总览页头「全景」按钮与「涨跌分布」卡标题）
 *
 * 美股与全球宏观只展示名称 + 涨跌幅（网格卡片）；进入页面串行错峰拉取一次
 * （不参与轮询）；数据先取内存快照秒出 UI，接口成功后写回快照并刷新；
 * A股全景由 PanoramaCnBoard 自管数据
 */

/** 各接口请求间隔（毫秒）：对同一上游串行错峰 */
const REQUEST_GAP_MS = 500;

const dataCache = useDataCacheStore();
const marketStatusStore = useMarketStatusStore();

/** 美股口径徽标文案（盘前 / 盘中 / 收盘，随 market-status 的分钟级 clockTick 重算） */
const usFlavorLabel = computed(() => {
  const flavor = marketStatusStore.usQuoteFlavor;
  return flavor === 'pre' ? '盘前' : flavor === 'open' ? '盘中' : '收盘';
});

// 快照播种：切换回本页先展示上次数据
const cachedUs = dataCache.get<PanoramaItem[]>(DATA_CACHE_KEY.PANORAMA_US_BOARDS);
const cachedGlobalTech = dataCache.get<PanoramaMacroGroup[]>(DATA_CACHE_KEY.PANORAMA_GLOBAL_TECH);
const cachedMacro = dataCache.get<PanoramaMacroGroup[]>(DATA_CACHE_KEY.PANORAMA_MACRO);

/** 美股基金主题行情（26 个产业主题，2026-11-07 替换原「美股行业 ETF」） */
const usBoards = ref<PanoramaItem[]>(cachedUs ?? []);
/** 国外科技巨头（美/日/韩分组，2026-11-02 新增、2026-11-03 扩三市场并分组） */
const globalTech = ref<PanoramaMacroGroup[]>(cachedGlobalTech ?? []);
/** 全球宏观分组 */
const macroGroups = ref<PanoramaMacroGroup[]>(cachedMacro ?? []);
/** 是否拉取中（有快照则不进骨架） */
const isLoading = ref(usBoards.value.length === 0 && macroGroups.value.length === 0);
/** 拉取是否失败（且无快照） */
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

/** 拉取美股全景（成功后写快照；供轮询与手动刷新复用） */
const fetchUsBoards = async (): Promise<void> => {
  usBoards.value = await fetchUsSectorPanorama();
  dataCache.set(DATA_CACHE_KEY.PANORAMA_US_BOARDS, usBoards.value);
};

/** 拉取国外科技巨头（成功后写快照；与美股基金主题同一 ulist 通道） */
const fetchGlobalTech = async (): Promise<void> => {
  globalTech.value = await fetchGlobalTechPanorama();
  dataCache.set(DATA_CACHE_KEY.PANORAMA_GLOBAL_TECH, globalTech.value);
};

/** 拉取全部宿主自管模块（成功后写快照；美股 → 科技巨头 → 宏观串行错峰，任一失败不清空已有快照） */
const loadAll = async (): Promise<void> => {
  isLoading.value = true;
  isError.value = false;
  try {
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
  } catch (error) {
    console.error('[panorama]', error);
    isError.value = true;
  } finally {
    isLoading.value = false;
  }
};

// 首次进入拉取一次（美股 / 宏观重接口不轮询兜底之外的部分，避免触发上游反爬）
void loadAll();

// KeepAlive 缓存页面：切走再切回不重新挂载，重拉全部模块（快照秒出后静默覆盖；
// 首次 onActivated 紧跟首屏触发，跳过避免重复请求；宏观无轮询兜底，这里是它唯一的自动刷新点）
let overviewActivatedOnce = false;
onActivated(() => {
  if (!overviewActivatedOnce) {
    overviewActivatedOnce = true;
    return;
  }
  if (!isLoading.value) {
    void loadAll();
  }
});

// 美股轮询：仅在美股轮询窗口（盘前+盘中：周一~五 16:00-24:00 与 周二~六 00:00-04:00）
// 内按间隔刷新，窗口外自动跳过；美股基金主题与科技巨头同窗口错峰刷新
usePolling({
  task: async () => {
    await fetchUsBoards();
    await delay(REQUEST_GAP_MS);
    await fetchGlobalTech();
  },
  intervalMs: POLLING_INTERVAL.US_BOARDS,
  tradingAware: true,
  market: 'US',
  immediate: false,
});

// 亚太轮询（2026-11-03 随「国外科技巨头」扩日韩引入）：仅亚太窗口（周一~五 08:00-14:30
// 北京时间）内刷新科技巨头清单——日股 176 / 韩股 177 的交易时段在 A 股盘中，美股窗口
// 盖不住；与美股窗口（16:00-04:00）不重叠，两个轮询器不会并发打同一上游
usePolling({
  task: async () => {
    await fetchGlobalTech();
  },
  intervalMs: POLLING_INTERVAL.US_BOARDS,
  tradingAware: true,
  market: 'AP',
  immediate: false,
});

/** 是否无数据（失败 / 空集且无快照） */
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

// ---------- 模块排序（2026-11-07 王总指定：页头按钮开弹窗，拖拽调整四组卡顺序，持久化） ----------

/** 模块排序弹窗显隐 */
const moduleOrderOpen = ref(false);

/**
 * 归一化已保存的模块顺序：剔除未知 id（常量演进后的残留），新卡片按声明序补末尾
 * @returns 完整卡片 id 排列（四项齐全）
 */
const normalizedModuleOrder = (): string[] => {
  const saved = settingsStore.panoramaModuleOrder.filter((id) =>
    PANORAMA_CARDS.some((card) => card.id === id),
  );
  const missing = PANORAMA_CARDS.filter((card) => !saved.includes(card.id)).map((card) => card.id);
  return [...saved, ...missing];
};

/** 页面卡片渲染顺序（settings 变化即时跟随） */
const orderedCardIds = computed(() => normalizedModuleOrder());

/** 排序弹窗条目（顺序 = 已保存顺序） */
const moduleOrderItems = computed(() =>
  normalizedModuleOrder().map((id) => ({
    id,
    label: PANORAMA_CARDS.find((card) => card.id === id)?.label ?? id,
  })),
);

/**
 * 模块排序弹窗确认：写回 settings 持久化（卡片渲染顺序即时跟随）
 * @param ids 弹窗回传的卡片 id 排列
 */
const onModuleOrderConfirm = (ids: string[]): void => {
  settingsStore.setPanoramaModuleOrder(ids);
};

// ---------- 手动刷新（沿用原行情全景页头刷新按钮，2026-11-02 王总指定） ----------

/** 点刷新按钮：重拉美股 + 科技巨头 + 全球宏观（A股板块由 PanoramaCnBoard 自管轮询） */
const onManualRefresh = (): void => {
  void loadAll();
};

/** 页头挂载守卫（KeepAlive 缓存页：激活才投射，防按钮残留）——刷新按钮上移页头用 */
const { active: headerSlotActive } = usePageHeaderSlot();
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <!-- 提示为辅助信息：容器过窄（抽屉打开挤主区）时整体隐藏，避免被挤成一字一行竖排 -->
    <div class="flex shrink-0 items-center justify-end">
      <span class="hidden shrink-0 text-xs text-text-tertiary @4xl:block">未开盘时展示最近交易日收盘数据</span>
    </div>

    <!-- 页头动作上移 MainLayout 页头（「插件设置」左侧）：模块排序（2026-11-07 王总指定）
         + 手动刷新（原行情全景 2026-11-02 王总指定）——重拉美股 + 科技巨头 + 全球宏观，
         拉取中图标旋转 -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <div class="flex items-center gap-2">
        <BaseButton variant="ghost" data-track="PANORAMA_MODULE_ORDER" @click="moduleOrderOpen = true">
          <MenuIcon name="sortCustom" :size="14" />
          模块排序
        </BaseButton>
        <BaseButton
          variant="ghost"
          :disabled="isLoading"
          @click="onManualRefresh"
        >
          <MenuIcon name="refresh" :size="14" :class="{ 'animate-spin': isLoading }" />
          {{ isLoading ? '刷新中…' : '刷新' }}
        </BaseButton>
      </div>
    </Teleport>

    <!-- 模块排序弹窗（拖拽调整四组卡片顺序，草稿模式 + 恢复默认） -->
    <PanoramaModuleOrderModal
      v-model:open="moduleOrderOpen"
      :items="moduleOrderItems"
      @confirm="onModuleOrderConfirm"
    />

    <!-- 模块内容统一滚动容器：四组卡片在此滚动 -->
    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <!-- 加载骨架（美股 / 宏观首载） -->
      <BaseCard v-if="isLoading">
        <div class="grid grid-cols-4 gap-2" aria-hidden="true">
          <div v-for="i in 12" :key="i" class="h-11 animate-pulse rounded-lg bg-flat-weak" />
        </div>
      </BaseCard>

      <!-- 失败 / 空态 -->
      <BaseCard v-else-if="isEmpty">
        <BaseEmpty text="数据加载失败或暂无数据，请稍后重试（上游可能限频）" />
      </BaseCard>

      <!-- 四组卡片竖向分布（A股 36 板块平铺 / 国外科技巨头 / 美股基金 / 全球宏观），
           渲染顺序 = settings.panoramaModuleOrder（页头「模块排序」弹窗编排，2026-11-07 王总指定），
           均支持展开收起（默认展开，折叠态持久化） -->
      <template v-else>
        <template v-for="cardId in orderedCardIds" :key="cardId">
          <PanoramaCnBoard
            v-if="cardId === 'cn'"
            class="shrink-0"
            collapsible
            :collapsed="isCardCollapsed('cn')"
            @update:collapsed="toggleCard('cn')"
          />

          <!-- 国外科技巨头（2026-11-02 新增美股巨头，2026-11-03 王总指定扩日韩、按市场分组并置顶）：
             组顺序 = 美国 → 日本 → 韩国，组内 = 配置顺序不重排；缺行标的名称仍显示、数值 `--` -->
          <BaseCard
            v-else-if="cardId === 'globalTech'"
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

          <!-- 美股基金（2026-11-07 王总指定替换「美股行业 ETF」）：26 个产业主题平铺
             （成分标的平均涨跌幅，分类对标美基星图「全球产业数据」），卡头徽标标注
             当前口径（盘前 / 盘中 / 收盘）；缺行主题仍显示、数值 `--` -->
          <BaseCard
            v-else-if="cardId === 'usBoards'"
            title="美股基金"
            class="shrink-0"
            collapsible
            :collapsed="isCardCollapsed('usBoards')"
            @update:collapsed="toggleCard('usBoards')"
          >
            <template #extra>
              <span
                class="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold"
                style="color: var(--color-primary); background: var(--color-primary-weak)"
                title="盘前 / 盘中时段自动切换口径；数值为主题成分标的的平均涨跌幅"
              >
                {{ usFlavorLabel }}
              </span>
            </template>
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
            v-else
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
      </template>
    </div>
  </div>
</template>
