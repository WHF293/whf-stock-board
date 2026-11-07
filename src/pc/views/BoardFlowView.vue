<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import HuijinEtfFlowBoard from '../components/business/HuijinEtfFlowBoard.vue';
import PanoramaMarginBoard from '../components/business/PanoramaMarginBoard.vue';
import PanoramaSectorFlowBoard from '../components/business/PanoramaSectorFlowBoard.vue';
import RealtimeTurnoverCard from '../components/business/RealtimeTurnoverCard.vue';
import MarketFundFlowTrendChart from '../components/charts/MarketFundFlowTrendChart.vue';
import TurnoverTrendChart from '../components/charts/TurnoverTrendChart.vue';
import MutualFundSidebar from '../components/business/northbound/MutualFundSidebar.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import { useRowClamp } from '../../common/composables/use-row-clamp';
import {
  PAGE_HEADER_ACTIONS_TARGET,
  usePageHeaderSlot,
} from '../../common/composables/use-page-header-slot';
import { fetchMarketFundFlow } from '../../common/api/flow.api.ts';
import { fetchMarketTurnover } from '../../common/api/turnover.api.ts';
import { TURNOVER_CHART_METRIC, TURNOVER_RANGE_DEFAULT } from '../../common/constants/turnover.constants.ts';
import { DATA_CACHE_KEY } from '../../common/constants/data-cache.constants.ts';
import { useDataCacheStore } from '../../common/stores/data-cache';
import { useMutualSidebarStore } from '../../common/stores/mutual-sidebar';
import type { MarketFundFlow } from '../../common/types/flow.types.ts';
import type { TurnoverDayItem } from '../../common/types/turnover.types.ts';

/**
 * 资金流向（原「板块资金流向」，2026-10-22 王总更名）：原「行情全景-最新板块资金」模块独立成页（2026-10-13，王总）
 *
 * 板块净流入榜单 + 行业资金曲面的渲染与数据逻辑全部在 PanoramaSectorFlowBoard
 * （自管数据 + 轮询）。2026-10-22 王总指定在其上方新增两行市场级图表（各 160px 高）：
 * - 行 1：实时成交额（RealtimeTurnoverCard compact，自管取数轮询）｜主力净流入（近 10 日，fetchMarketFundFlow）
 * - 行 2：历史成交量｜相对成交量（同一份成交额历史，TurnoverTrendChart 两种量纲口径）
 * 2026-10-30 王总指定新增沪深港通三行（stock-sdk northbound 能力）；同日王总指定：
 * 北向每日净买额经实测已无公开数据来源（日度持股披露同步停止），UI 收窄为南向口径：
 * - 行 3：南向资金汇总｜当日分时净流入（summary + minute 共用单个 60s tradingAware 轮询，
 *   一节拍 Promise.all 两请求，≤2 req/min 远低于东财红线；汇总卡只渲染南向两通道）
 * - 行 4：南向资金历史（范围切换，参数触发不轮询，自管数据）
 * - 行 5：北向持股排行（季度披露快照，进页一次；行尾「持仓」开个股持仓历史抽屉）
 * 2026-10-30 王总二次指定：①主力净流入 ↔ 当日分时净流入位置互换（分时上行 1、主力落行 3 右）；
 * ②参考市场总览指数卡片的 row-clamp 展开收起——收起只露行 1（实时成交额｜当日分时净流入），
 * 展开显示行 2~5（历史/相对成交量、南向汇总+主力净流入、资金历史、持股排行），
 * 板块分时净流入模块固定底部不参与折叠。
 * 成交额历史为日频数据，进页拉一次 + dataCache 播种（与市场总览成交额模块同 key 共享快照）。
 * 2026-11-06 王总指定：①板块资金流入模块下方新增「每日汇金持仓变化（估算）」——宽基 ETF
 * 总份额变动 × 季报机构持有比例的推算看板（自管数据，进页触发不轮询），估算口径
 * 与局限声明见 HuijinEtfFlowBoard 内的 NoticeBar / 标题问号（常量单源）；
 * ②原行情全景「融资融券」tab 迁入本页（两融本质属资金域）；市场总览两融卡标题
 * 深链 `/board-flow?focus=margin` 滚动定位到该区块；③两融「个股明细」、汇金「当日
 * 明细」与南向资金历史「每日明细」三张表默认收起。
 * 同日再指定：页面顶部「AI 分析」按钮左边新增「南北向资金」按钮，点击开合右侧
 * 可拖宽侧边栏；页面原有南北向模块全部迁入侧边栏（南向汇总 / 当日分时净流入 /
 * 南向资金历史 / 北向持股排行，汇总+分时的 60s 轮询随迁），并新增两卡：
 * - 北向资金流向估算（季度）：相邻两期季度持股快照差分 × 期末收盘价（北向净买额
 *   停披露后唯一可验证的方向性估算；口径与局限见 NorthboundEstimateCard）；
 * - 北向资金历史（成交额口径）：当日成交额柱 + 停披露前真实净买额虚线。
 * 页头按钮经 Teleport 投射到 PAGE_HEADER_ACTIONS_TARGET（order -1 确保在
 * PanoramaSectorFlowBoard 上移的「AI 分析」组左边）；侧边栏
 * 开关与宽度经 mutual-sidebar store 持久化。
 */

/** 主力净流入图表窗口（交易日数）：与市场总览「主力净流入（近10日）」同口径 */
const MARKET_FLOW_WINDOW_DAYS = 10;

/** 新增两行图表的画布高度（px，王总指定） */
const FLOW_CHART_HEIGHT_PX = 160;

const dataCache = useDataCacheStore();

/** 南北向资金侧边栏开关（页头按钮触发，mutual-sidebar store 持久化） */
const mutualSidebar = useMutualSidebarStore();

/** 页级动作挂载守卫（KeepAlive 下切走页面时撤离 Teleport 内容，见 use-page-header-slot） */
const { active: headerSlotActive } = usePageHeaderSlot();

// ---------- 顶部资金图表展开/收起（2026-10-30 王总指定，参考市场总览指数卡片） ----------
// 行 1~5 收进同一 row-clamp 裁剪容器：收起只露行 1（DOM 不卸载，数据/轮询不受影响）；
// 板块分时净流入模块在容器外固定底部，不随展开收起变化
const {
  setGridRef: setFlowRowsRef,
  isExpanded: isFlowExpanded,
  hasOverflow: hasFlowOverflow,
  clampStyle: flowClampStyle,
  toggle: toggleFlowExpanded,
} = useRowClamp();

/** 主力净流入日频历史（升序；取数口径与市场总览一致） */
const marketFlowHistory = ref<MarketFundFlow[]>([]);
/** 成交额日频历史（升序；历史成交量 / 相对成交量两图共用） */
const turnoverHistory = ref<TurnoverDayItem[]>([]);
/** 主力净流入取数失败 */
const isFlowError = ref(false);
/** 成交额历史取数失败 */
const isTurnoverError = ref(false);

/** 历史成交量图数据窗口（近 10 日，与市场总览默认档一致） */
const amountDays = computed<TurnoverDayItem[]>(() =>
  turnoverHistory.value.slice(-TURNOVER_RANGE_DEFAULT),
);

/** 相对成交量图数据窗口（多取 1 天：首日无前值，图表内部 slice(1) 后恰为近 10 日） */
const relativeDays = computed<TurnoverDayItem[]>(() =>
  turnoverHistory.value.slice(-(TURNOVER_RANGE_DEFAULT + 1)),
);

/** 主力净流入图数据窗口（近 10 日） */
const marketFlowDays = computed<MarketFundFlow[]>(() =>
  marketFlowHistory.value.slice(-MARKET_FLOW_WINDOW_DAYS),
);

/** 拉取主力净流入历史（失败置错误态，图表卡内兜底空态） */
const loadMarketFlow = async (): Promise<void> => {
  try {
    const flows = await fetchMarketFundFlow();
    marketFlowHistory.value = flows;
    isFlowError.value = flows.length === 0;
  } catch (error) {
    console.error('[board-flow] 主力净流入取数失败', error);
    isFlowError.value = marketFlowHistory.value.length === 0;
  }
};

/** 拉取成交额历史（dataCache 快照播种秒出，成功后写回；与市场总览成交额模块同 key） */
const loadTurnover = async (): Promise<void> => {
  const cached = dataCache.get<TurnoverDayItem[]>(DATA_CACHE_KEY.DASHBOARD_TURNOVER);
  if (cached && cached.length > 0) {
    turnoverHistory.value = cached;
  }
  try {
    turnoverHistory.value = await fetchMarketTurnover();
    dataCache.set(DATA_CACHE_KEY.DASHBOARD_TURNOVER, turnoverHistory.value);
    isTurnoverError.value = turnoverHistory.value.length === 0;
  } catch (error) {
    console.error('[board-flow] 成交额历史取数失败', error);
    isTurnoverError.value = turnoverHistory.value.length === 0;
  }
};

const route = useRoute();

/**
 * 深链定位：市场总览两融卡标题 → `/board-flow?focus=margin` 滚动到两融区块。
 * 进页各模块数据陆续到达、页面内容高度逐段撑开（row-clamp 图表区的骨架→图表
 * 收紧与下方内容撑高还会分帧交错），单次定位必然被后续布局变化推偏——
 * 故用「三次延迟兜底 × 每次逐帧对齐约 0.3s」：对齐幂等，布局稳定后重复滚动
 * 无害，任何数据时序下最终都停准。用 auto 瞬时定位：webview 实测
 * scrollIntoView 的 smooth 模式可能静默不滚（2026-11-06），直达场景瞬时跳位亦可接受
 */
const alignMarginBoard = (): void => {
  const el = document.getElementById('margin-board');
  if (!el?.isConnected) return;
  /**
   * 逐帧对齐（rAF 循环）
   * @param frames 剩余帧数，递减到 0 即停
   */
  const alignFrame = (frames: number): void => {
    if (frames <= 0 || !el.isConnected) return;
    el.scrollIntoView({ behavior: 'auto', block: 'start' });
    requestAnimationFrame(() => alignFrame(frames - 1));
  };
  alignFrame(20);
};

onMounted(() => {
  void loadMarketFlow();
  void loadTurnover();
  if (route.query.focus === 'margin') {
    window.setTimeout(() => alignMarginBoard(), 600);
    window.setTimeout(() => alignMarginBoard(), 2000);
    window.setTimeout(() => alignMarginBoard(), 4000);
  }
});
</script>

<template>
  <!-- 根为横向两列：内容列（原页面滚动区）+ 南北向资金侧边栏（可拖宽，2026-11-06 王总指定） -->
  <div class="flex h-full min-h-0 gap-2.5">
    <!-- 页头动作：南北向资金开合按钮（Teleport 投射，本页激活时才挂载）。
         order -1：#page-header-actions 内排在 PanoramaSectorFlowBoard 上移的
         「AI 分析」组左边（王总指定位置） -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <div class="flex items-center gap-2" style="order: -1">
        <BaseButton
          variant="ghost"
          :class="mutualSidebar.open ? 'text-primary' : ''"
          @click="mutualSidebar.toggle()"
        >
          <MenuIcon name="funds" :size="14" />
          南北向资金
        </BaseButton>
      </div>
    </Teleport>

    <!-- 内容列：原页面滚动区（南北向模块已迁入右侧侧边栏） -->
    <div class="flex h-full min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
      <!--
      顶部图表区（行 1~3）：收起只露行 1（实时成交额），展开显示全部
      （2026-10-30 王总指定，参考市场总览指数卡片）。DOM 始终完整——收起不卸载，
      各卡数据与轮询不受折叠影响；「首行 = 行 1」由内层 flex-col 的确定性顺序保证。
      原行 1 右分时 / 行 3 左汇总 / 行 4 / 行 5 已迁入南北向侧边栏（2026-11-06）
    -->
      <div class="row-clamp shrink-0" :style="flowClampStyle">
        <div :ref="setFlowRowsRef" class="flex flex-col gap-4">
          <!-- 行 1：实时成交额（compact 隐藏均值行；分时净流入已迁侧边栏，本行占满整行） -->
          <BaseCard title="实时成交额">
            <div class="h-[160px]">
              <RealtimeTurnoverCard compact />
            </div>
          </BaseCard>

          <!-- 行 2：历史成交量｜相对成交量（同一份成交额历史，两种量纲口径；2026-10-22 王总指定新增） -->
          <div class="flex flex-wrap gap-4">
            <BaseCard title="历史成交量" class="min-w-[360px] flex-1">
              <BaseEmpty v-if="isTurnoverError" text="成交额数据加载失败，请稍后重试" />
              <BaseSkeleton v-else-if="amountDays.length === 0" />
              <TurnoverTrendChart
                v-else
                :days="amountDays"
                :metric="TURNOVER_CHART_METRIC.AMOUNT"
                :height="FLOW_CHART_HEIGHT_PX"
              />
            </BaseCard>
            <BaseCard title="相对成交量" class="min-w-[360px] flex-1">
              <BaseEmpty v-if="isTurnoverError" text="成交额数据加载失败，请稍后重试" />
              <BaseSkeleton v-else-if="relativeDays.length === 0" />
              <TurnoverTrendChart
                v-else
                :days="relativeDays"
                :metric="TURNOVER_CHART_METRIC.RELATIVE"
                :height="FLOW_CHART_HEIGHT_PX"
              />
            </BaseCard>
          </div>

          <!-- 行 3：主力净流入（南向汇总已迁侧边栏，本卡占满整行） -->
          <BaseCard title="主力净流入（近10日）">
            <BaseEmpty v-if="isFlowError" text="资金数据加载失败，请稍后重试" />
            <BaseSkeleton v-else-if="marketFlowDays.length === 0" />
            <MarketFundFlowTrendChart
              v-else
              :days="marketFlowDays"
              :height="FLOW_CHART_HEIGHT_PX"
            />
          </BaseCard>
        </div>
      </div>

      <!-- 展开/收起开关：首行之外还有内容才显示（-mt-3 收掉裁剪容器 12px 阴影呼吸位，与市场总览一致） -->
      <div v-if="hasFlowOverflow" class="-mt-3 flex shrink-0 justify-center">
        <button
          type="button"
          class="pressable rounded-full p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
          :aria-expanded="isFlowExpanded"
          aria-label="资金图表"
          :title="isFlowExpanded ? '收起图表' : '展开全部图表'"
          @click="toggleFlowExpanded"
        >
          <MenuIcon
            name="chevronDown"
            :size="16"
            class="transition-transform"
            :class="isFlowExpanded ? 'rotate-180' : ''"
          />
        </button>
      </div>

      <!-- 融资融券区块（2026-11-06 王总指定自行情全景 tab 迁入：明细表 + 余额走势，
         数据自管不轮询；?focus=margin 深链滚动定位，入口 = 市场总览两融卡标题） -->
      <div id="margin-board" class="shrink-0">
        <PanoramaMarginBoard />
      </div>

      <!-- 板块资金流入模块（页面主体，自管数据 + 轮询；固定底部不参与上方折叠；上方各行挤占时保底 480px 高） -->
      <PanoramaSectorFlowBoard class="min-h-[480px] flex-1" />

      <!-- 每日汇金持仓变化（估算）：宽基 ETF 份额变动 × 季报机构占比推算看板（2026-11-06 王总指定） -->
      <HuijinEtfFlowBoard class="shrink-0" />
    </div>

    <!-- 南北向资金侧边栏（可拖宽；关闭即 v-if 卸载，模块数据 / 轮询随之停止） -->
    <Transition name="mutual-slide">
      <MutualFundSidebar v-if="mutualSidebar.open" />
    </Transition>
  </div>
</template>

<style scoped>
/* 南北向侧边栏开合动画：入场右侧滑入 + 淡入，离场反向（无离场状态机，仅过渡类） */
.mutual-slide-enter-active,
.mutual-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.mutual-slide-enter-from,
.mutual-slide-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
</style>
