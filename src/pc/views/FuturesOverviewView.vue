<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseModal from '../components/ui/BaseModal.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import FuturesCapitalFlowChart from '../components/business/futures/FuturesCapitalFlowChart.vue';
import FuturesPositionRateChart from '../components/business/futures/FuturesPositionRateChart.vue';
import FuturesRankBoards from '../components/business/futures/FuturesRankBoards.vue';
import {
  fetchFuturesCapitalFlows,
  fetchFuturesLastDate,
  fetchFuturesOverviewHome,
  fetchFuturesPositionRates,
  fetchFuturesRankBoards,
} from '../../common/api/futures-overview.api.ts';
import type {
  FuturesCapitalFlowItem,
  FuturesOverviewHome,
  FuturesPositionRateItem,
  FuturesRankBoards as FuturesRankBoardsData,
} from '../../common/types/futures.types.ts';

/**
 * 期货 · 总览（期货市场总览，参考同花顺期货通首页同名模块）
 *
 * 三模块：主力流况状况（主力合约涨跌家数）/ 品种资金流向（净流入，元）/
 * 主力持仓多空比（前 20 会员多单占比）。数据全部自上游接口拉取后本地渲染
 * （非 iframe 嵌页），页面常驻标注数据来源；「查看更多」弹窗展示全量列表。
 */
const HOME_CHART_PREVIEW_COUNT = 4;
const POSITION_CHART_PREVIEW_COUNT = 3;
const PREVIEW_CHART_HEIGHT_PX = 224;
const MODAL_CHART_HEIGHT_PX = 560;

/** 首页三模块数据 */
const home = ref<FuturesOverviewHome | null>(null);
/** 品种资金流向全列表 */
const capitalList = ref<FuturesCapitalFlowItem[]>([]);
/** 多空比全列表 */
const positionList = ref<FuturesPositionRateItem[]>([]);
/** 数据交易日（来源标注） */
const lastDate = ref<string>('');
/** 主力合约四榜（涨幅 / 跌幅 / 成交额 / 日增仓） */
const rankBoards = ref<FuturesRankBoardsData | null>(null);
/** 四榜加载中（独立于页面主体加载） */
const rankLoading = ref(false);
/** 四榜是否失败（失败展示友好异常态 + 重试，原始错误进控制台） */
const rankFailed = ref(false);

const loading = ref(false);
const errorText = ref('');

/** 资金流向弹窗开关 */
const capitalModalOpen = ref(false);
/** 多空比弹窗开关 */
const positionModalOpen = ref(false);

/**
 * 拉取全部总览数据（三模块并发；四榜独立加载互不阻塞）
 * @param forceRefresh 跳过会话缓存强制回源（刷新按钮）
 */
const loadAll = async (forceRefresh = false): Promise<void> => {
  loading.value = true;
  errorText.value = '';
  try {
    const [homeData, capital, position, date] = await Promise.all([
      fetchFuturesOverviewHome(forceRefresh),
      fetchFuturesCapitalFlows(forceRefresh),
      fetchFuturesPositionRates(forceRefresh),
      fetchFuturesLastDate(forceRefresh),
    ]);
    home.value = homeData;
    capitalList.value = capital ?? [];
    positionList.value = position ?? [];
    lastDate.value = date ?? '';
  } catch (err) {
    console.warn('[futures-overview] 总览数据拉取失败:', err);
    errorText.value = '总览数据拉取失败，请检查网络后重试';
  } finally {
    loading.value = false;
  }
  // 四榜独立加载：失败只提示榜单区，不阻塞上面的三模块
  void loadRankBoards(forceRefresh);
};

/**
 * 单独加载主力合约四榜（失败可独立重试，不牵连页面其余模块）
 * @param forceRefresh 跳过会话缓存强制回源
 */
const loadRankBoards = async (forceRefresh = false): Promise<void> => {
  rankLoading.value = true;
  rankFailed.value = false;
  try {
    rankBoards.value = await fetchFuturesRankBoards(forceRefresh);
  } catch (err) {
    console.warn('[futures-overview] 主力合约榜单拉取失败:', err);
    rankFailed.value = true;
  } finally {
    rankLoading.value = false;
  }
};

void loadAll();

/* -------------------- 资金流向：预览与全量（升序，流入在上流出在下） -------------------- */

const capitalSorted = computed(() =>
  [...capitalList.value].filter((item) => item.capital !== 0).sort((a, b) => a.capital - b.capital),
);
const capitalPreview = computed(() => [
  ...capitalSorted.value.slice(0, HOME_CHART_PREVIEW_COUNT),
  ...capitalSorted.value.slice(-HOME_CHART_PREVIEW_COUNT),
]);

/* -------------------- 多空比：预览与全量（降序，偏多在上） -------------------- */

const positionSorted = computed(() =>
  [...positionList.value].sort((a, b) => b.longRate - a.longRate),
);
const positionPreview = computed(() => [
  ...positionSorted.value.slice(0, POSITION_CHART_PREVIEW_COUNT),
  ...positionSorted.value.slice(-POSITION_CHART_PREVIEW_COUNT),
]);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-text">期货市场总览</h2>
      <div class="flex items-center gap-2">
        <span class="text-xs text-text-tertiary">数据来源：同花顺期货通（10jqka）<template v-if="lastDate"> · 交易日 {{ lastDate }}</template></span>
        <BaseButton variant="ghost" :disabled="loading" @click="void loadAll(true)">
          {{ loading ? '加载中…' : '刷新' }}
        </BaseButton>
      </div>
    </div>

    <div v-if="loading" class="grid grid-cols-1 gap-3 xl:grid-cols-3">
      <BaseCard v-for="i in 3" :key="i"><BaseSkeleton class="h-56" /></BaseCard>
    </div>

    <BaseCard v-else-if="errorText">
      <BaseEmpty text="总览数据拉取失败，请检查网络后重试">
        <template #extra>
          <BaseButton variant="ghost" @click="void loadAll(true)">重试</BaseButton>
        </template>
      </BaseEmpty>
    </BaseCard>

    <template v-else>
      <div class="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <!-- ① 主力流况状况（涨跌家数） -->
        <BaseCard title="主力流况状况" fill>
          <template #extra>
            <span class="text-xs text-text-tertiary">单位：合约个数（主力合约）</span>
          </template>
          <div class="grid flex-1 grid-cols-3 items-center gap-2 px-2">
            <div class="text-center">
              <div class="text-3xl font-bold text-up tabular-nums">{{ home?.mainContractOverview.rise ?? '--' }}</div>
              <div class="mt-1 text-xs text-text-tertiary">上涨</div>
            </div>
            <div class="text-center">
              <div class="text-3xl font-bold text-text-tertiary tabular-nums">{{ home?.mainContractOverview.flat ?? '--' }}</div>
              <div class="mt-1 text-xs text-text-tertiary">平盘</div>
            </div>
            <div class="text-center">
              <div class="text-3xl font-bold text-down tabular-nums">{{ home?.mainContractOverview.fall ?? '--' }}</div>
              <div class="mt-1 text-xs text-text-tertiary">下跌</div>
            </div>
          </div>
          <div class="mt-3 flex justify-center gap-4 text-xs text-text-tertiary">
            <span>涨停 <span class="font-semibold text-up">{{ home?.mainContractOverview.riseLimit ?? 0 }}</span></span>
            <span>跌停 <span class="font-semibold text-down">{{ home?.mainContractOverview.fallLimit ?? 0 }}</span></span>
          </div>
        </BaseCard>

        <!-- ② 品种资金流向 -->
        <BaseCard title="品种资金流向" fill>
          <template #extra>
            <button
              type="button"
              class="pressable text-xs text-primary hover:underline"
              @click="capitalModalOpen = true"
            >
              查看更多
            </button>
          </template>
          <div class="min-h-0 flex-1">
            <FuturesCapitalFlowChart :items="capitalPreview" :height-px="PREVIEW_CHART_HEIGHT_PX" />
          </div>
          <div class="mt-2 text-right text-xs text-text-tertiary">单位：元（当日主力合约资金净流向）</div>
        </BaseCard>

        <!-- ③ 主力持仓多空比 -->
        <BaseCard title="主力持仓多空比" fill>
          <template #extra>
            <button
              type="button"
              class="pressable text-xs text-primary hover:underline"
              @click="positionModalOpen = true"
            >
              查看更多
            </button>
          </template>
          <div class="min-h-0 flex-1">
            <FuturesPositionRateChart :items="positionPreview" :height-px="PREVIEW_CHART_HEIGHT_PX" />
          </div>
          <div class="mt-2 text-right text-xs text-text-tertiary">前 20 会员持仓统计（主力合约）</div>
        </BaseCard>
      </div>

      <!-- ④ 主力合约四榜（涨幅 / 跌幅 / 成交额 / 日增仓）：失败独立重试，不阻塞其余模块 -->
      <BaseCard title="主力合约榜单" fill>
        <template #extra>
          <span class="text-xs text-text-tertiary">合约榜单来源：同花顺期货通 · 行情快照来源：东方财富</span>
        </template>
        <FuturesRankBoards v-if="rankBoards" :boards="rankBoards" />
        <BaseSkeleton v-else-if="rankLoading" class="h-40" />
        <BaseEmpty
          v-else-if="rankFailed"
          text="主力合约榜单暂时拉取失败，行情快照源可能被限流或网络受限"
        >
          <template #extra>
            <div class="flex items-center gap-2">
              <BaseButton variant="ghost" :disabled="rankLoading" @click="void loadRankBoards(true)">
                {{ rankLoading ? '重试中…' : '重试' }}
              </BaseButton>
            </div>
          </template>
        </BaseEmpty>
        <BaseEmpty v-else text="暂无榜单数据" />
      </BaseCard>

      <div class="rounded-card bg-flat-weak px-4 py-2.5 text-xs leading-relaxed text-text-secondary">
        <span class="font-semibold text-text">数据说明：</span>本页数据由本地拉取渲染，非官方页面；主力流况 / 资金净流向 / 多空比来自同花顺期货通行情网关（futgwapi），主力合约四榜的合约清单来自同花顺期货通、行情快照来自东方财富（盘中实时口径），仅供观测参考，不构成投资建议。
      </div>

      <!-- 品种资金流向全量弹窗 -->
      <BaseModal
        v-model:open="capitalModalOpen"
        title="品种资金流向（全品种）"
        max-width-class="max-w-3xl"
        height-class="h-[80dvh]"
      >
        <template #filters>
          <span class="text-xs text-text-tertiary">
            共 {{ capitalSorted.length }} 个品种 · 单位：元 · 交易日 {{ lastDate || '--' }} · 来源：同花顺期货通
          </span>
        </template>
        <FuturesCapitalFlowChart :items="capitalSorted" :height-px="MODAL_CHART_HEIGHT_PX" />
      </BaseModal>

      <!-- 主力持仓多空比全量弹窗 -->
      <BaseModal
        v-model:open="positionModalOpen"
        title="主力持仓多空比（全品种）"
        max-width-class="max-w-3xl"
        height-class="h-[80dvh]"
      >
        <template #filters>
          <span class="text-xs text-text-tertiary">
            共 {{ positionSorted.length }} 个品种 · 前 20 会员持仓统计 · 交易日 {{ lastDate || '--' }} · 来源：同花顺期货通
          </span>
        </template>
        <FuturesPositionRateChart :items="positionSorted" :height-px="MODAL_CHART_HEIGHT_PX" />
      </BaseModal>
    </template>
  </div>
</template>
