<script setup lang="ts">
import { computed, ref } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import BaseCard from '../ui/BaseCard.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { pluginKernel } from '../../plugin/index';
import { useWatchlistStore } from '../../../common/stores/watchlist';
import { useNotificationsStore } from '../../../common/stores/notifications';
import {
  WATCHLIST_GROUP_DRAG_ANIMATION_MS,
  WATCHLIST_GROUP_DRAG_GROUP,
  WATCHLIST_SORT_MODE_CYCLE,
  WATCHLIST_SORT_MODE_ICON,
  WATCHLIST_SORT_MODE_TITLE,
  WATCH_PLUGIN_ID,
  WATCH_PLUGIN_MISSING_NOTIFY,
} from '../../../common/constants/watchlist.constants.ts';
import { NOTIFY_SOURCE_WATCHLIST, NOTIFY_TONE } from '../../../common/constants/notify.constants.ts';
import { getTrendByChangePercent } from '../../../common/constants/trend.constants.ts';
import type { Trend } from '../../../common/constants/trend.constants.ts';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../../../common/constants/stock-colors.constants.ts';
import { formatAmount } from '../../../common/utils/format-amount';
import { formatPercent, formatPercentUnsigned } from '../../../common/utils/format-percent';
import { formatPrice } from '../../../common/utils/format-price';
import { findQuoteBySymbol } from '../../../common/utils/find-quote-by-symbol';
import { useStockOpen } from '../../../common/composables/use-stock-open';
import type { FullQuote } from '../../../common/types/stock-quote.types.ts';
import type { WatchlistGroup, WatchlistSortMode, WatchlistStock } from '../../../common/types/watchlist.types.ts';
import type { RegisteredStockRowAction, StockRowTarget } from '../../../common/types/plugin.types.ts';

/**
 * 自选股平铺看板（2026-10-27 王总指定，Tab 模式已删除，本组件即自选股页主体）：
 * 一个分组一列（横向卡片流，参考热点新闻页样式），列顺序与显隐由页面经 props 传入
 * （分组设置弹窗拖拽排序），列内卡片只展示名称 / 现价 / 涨跌幅三项，
 * hover 原位展开其余字段并浮现操作按钮（编辑分组归属 / 从本组移除）；
 * 卡片可拖拽到别的分组列 = 修改分组归属（同组内拖拽不动作），点击卡片进右侧个股详情侧栏（与表格行点击同一交互）；
 * 列头排序 icon 三态循环（2026-10-28 王总指定）：自定义拖拽顺序 → 涨跌幅升序 → 降序 → 自定义，
 * 排序态下禁用拖拽，切回自定义后恢复组内拖拽顺序（会话内状态，不持久化）
 */
const props = defineProps<{
  /** 展示的分组列表（已按分组设置排序并过滤隐藏） */
  groups: WatchlistGroup[];
  /** 报价映射（key 为 FullQuote.code 原始形态；与分组表格共用同一份快照） */
  quotesMap: Record<string, FullQuote>;
}>();

const emit = defineEmits<{
  /** 点击编辑按钮（由宿主打开分组归属弹窗，可多选分组） */
  edit: [stock: WatchlistStock];
  /** 点击移除按钮（由宿主弹二次确认后只从该分组移除） */
  remove: [payload: { groupId: string; symbol: string }];
  /** 点击列头「添加股票」icon（由宿主打开搜索弹窗，落点 = 该分组） */
  add: [groupId: string];
  /** 点击列头「批量添加」icon（由宿主打开批量弹窗，落点 = 该分组） */
  batchAdd: [groupId: string];
}>();

const watchlistStore = useWatchlistStore();
const { openSidebar } = useStockOpen();

/**
 * 双形态兼容查找报价：watchlist 存 sh600519 完整形态，上游 `FullQuote.code`
 * 实际是裸代码（600519）——统一经 findQuoteBySymbol 兜底匹配
 * @param symbol 股票符号
 * @returns 匹配到的报价
 */
const findQuote = (symbol: string): FullQuote | undefined =>
  findQuoteBySymbol(props.quotesMap, symbol);

/**
 * 卡片涨跌方向（相对 0，驱动现价文字色与涨跌幅胶囊配色）
 * @param symbol 股票符号
 * @returns 趋势枚举
 */
const trendOf = (symbol: string): Trend =>
  getTrendByChangePercent(findQuote(symbol)?.changePercent ?? 0);

/**
 * 点击卡片 → 右侧个股详情侧栏
 * @param symbol 股票符号
 */
const openDetail = (symbol: string): void => {
  openSidebar(symbol);
};

// ---------- 插件贡献的行操作（ctx.stockRow，如自选盯盘的「盯盘」开关） ----------
//
// v4.22.0 平铺看板重构时丢了旧表格的行操作渲染，2026-10-30 恢复；
// 另加宿主兜底：「自选盯盘」插件未安装 / 未启用时按钮仍显示（宿主自带），
// 点击弹浮窗引导先装插件（王总 2026-10-30 指定）

const notifyStore = useNotificationsStore();

/** 注册表中的股票行操作（内核注册表响应式：插件启停即时增删按钮） */
const rowActions = computed<RegisteredStockRowAction[]>(() => {
  // revision 纳入依赖：贡献点增删后按钮立刻跟随
  void pluginKernel.revision.value;
  return [...pluginKernel.contributions.stockRows.actions];
});

/** 自选盯盘插件贡献的「盯盘」行操作（缺席 = 插件未安装或未启用） */
const watchAction = computed<RegisteredStockRowAction | null>(
  () => rowActions.value.find((action) => action.pluginId === WATCH_PLUGIN_ID) ?? null,
);

/**
 * 行操作目标（只把「哪只票」交给插件，不暴露看板卡片对象）
 * @param stock 自选股条目
 * @returns 行操作目标
 */
const toRowTarget = (stock: WatchlistStock): StockRowTarget => ({
  symbol: stock.symbol,
  name: stock.name,
});

/**
 * 「盯盘」按钮的提示文案（激活态切换到插件声明的「取消盯盘」）
 * @param stock 自选股条目
 * @returns 形如「盯盘 贵州茅台」的文案
 */
const watchButtonTitle = (stock: WatchlistStock): string =>
  `${watchAction.value?.isActive(toRowTarget(stock)) ? watchAction.value.activeTitle : '盯盘'} ${stock.name}`;

/**
 * 点击「盯盘」：插件在 → 委托插件切换候选；缺席 → 浮窗引导先安装
 * @param stock 自选股条目
 */
const onWatchClick = (stock: WatchlistStock): void => {
  const action = watchAction.value;
  if (!action) {
    notifyStore.push({
      title: WATCH_PLUGIN_MISSING_NOTIFY.title,
      body: WATCH_PLUGIN_MISSING_NOTIFY.body,
      tone: NOTIFY_TONE.PRIMARY,
      source: NOTIFY_SOURCE_WATCHLIST,
    });
    return;
  }
  action.run(toRowTarget(stock));
};


// ---------- 拖拽改分组（vue-draggable-plus / Sortable，跨列 = 修改归属） ----------
//
// 2026-10-28 起弃用 HTML5 原生 DnD：Tauri 的文件拖入处理器（dragDropEnabled 默认开启）
// 在 WebView2 下劫持页面内 HTML5 拖拽，dragover / drop 全部失效（光标恒为「禁止」）。
// Sortable 走指针事件模拟，不依赖原生 DnD 事件链，两端均可用。

/** 跨列拖拽的放行校验入参（只取用到的字段，避免直接依赖 sortablejs 类型） */
interface DragMovePayload {
  /** 拖入目标容器（挂了 data-group-id） */
  to: HTMLElement;
  /** 被拖拽的卡片元素（挂了 data-symbol） */
  dragged: HTMLElement;
}

/**
 * 跨列拖拽的放行校验（Sortable move 钩子）：同一只票允许同时属于多个分组，
 * 但组内不允许重复 —— 目标列已存在该符号时拦截本次拖入
 * @param event Sortable move 事件（结构化子集）
 * @returns true = 放行落列
 */
const onDragMoveCheck = (event: DragMovePayload): boolean => {
  const symbol = event.dragged?.dataset.symbol ?? '';
  const targetGroupId = event.to?.dataset.groupId ?? '';
  const target = props.groups.find((group) => group.id === targetGroupId);
  return !target?.stocks.some((stock) => stock.symbol === symbol);
};

/** v-model 直接改了 store 里的分组数组（组内排序 / 跨列移动后）统一回写持久化 */
const persistGroups = (): void => {
  watchlistStore.$persist();
};

// ---------- 分组内涨跌幅排序（2026-10-28 王总指定：自定义 → 升序 → 降序 → 自定义 三态循环） ----------

/** 各分组当前排序模式（会话内状态，不持久化；缺省 = custom 自定义拖拽顺序） */
const sortModes = ref<Record<string, WatchlistSortMode>>({});

/**
 * 读某分组当前排序模式
 * @param groupId 分组 id
 * @returns 排序模式（未切换过 = custom）
 */
const sortModeOf = (groupId: string): WatchlistSortMode => sortModes.value[groupId] ?? 'custom';

/**
 * 点击排序 icon：按「自定义 → 升序 → 降序 → 自定义」循环切换
 * @param groupId 分组 id
 */
const cycleSortMode = (groupId: string): void => {
  const current = sortModeOf(groupId);
  const index = WATCHLIST_SORT_MODE_CYCLE.indexOf(current);
  sortModes.value[groupId] = WATCHLIST_SORT_MODE_CYCLE[(index + 1) % WATCHLIST_SORT_MODE_CYCLE.length];
};

/**
 * 分组内展示顺序：custom 原样（保持拖拽顺序，可拖拽）；
 * asc / desc 按涨跌幅排（取不到行情的排在最后），返回副本、不改 store 数组
 * @param group 分组
 * @returns 展示用条目列表
 */
const displayStocks = (group: WatchlistGroup): WatchlistStock[] => {
  const mode = sortModeOf(group.id);
  if (mode === 'custom') {
    return group.stocks;
  }
  const percentOf = (stock: WatchlistStock): number =>
    findQuote(stock.symbol)?.changePercent ?? Number.NEGATIVE_INFINITY;
  const sorted = [...group.stocks].sort((a, b) => percentOf(a) - percentOf(b));
  return mode === 'asc' ? sorted : sorted.reverse();
};

/**
 * 自定义模式下拖拽落定（含跨列换分组）：把新顺序写回分组并持久化
 * @param group 分组
 * @param stocks 拖拽后的组内条目列表
 */
const onStocksReorder = (group: WatchlistGroup, stocks: WatchlistStock[]): void => {
  group.stocks = stocks;
  persistGroups();
};
</script>

<template>
  <!-- 横向卡片流：一个分组一列，超出页面横向滚动（列内各自纵向滚动） -->
  <div class="flex h-full min-h-0 gap-4 overflow-x-auto pb-1">
    <BaseCard
      v-for="group in props.groups"
      :key="group.id"
      class="!flex !h-full !w-[300px] !shrink-0 !flex-col !overflow-hidden !p-0"
    >
      <!-- 列头：分组名（数量）+ 添加/批量添加 icon（2026-10-28 王总指定：名称（数量）在左，icon 靠右） -->
      <header
        class="flex shrink-0 items-center justify-between gap-2 border-b border-flat-weak px-4 py-3"
      >
        <h2 class="min-w-0 truncate text-sm font-semibold text-text">
          {{ group.name }}（{{ group.stocks.length }}）
        </h2>
        <span class="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            data-track="WATCHLIST_GROUP_SORT"
            class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
            :class="{ 'bg-flat-weak text-text': sortModeOf(group.id) !== 'custom' }"
            :title="WATCHLIST_SORT_MODE_TITLE[sortModeOf(group.id)]"
            :aria-label="WATCHLIST_SORT_MODE_TITLE[sortModeOf(group.id)]"
            @click="cycleSortMode(group.id)"
          >
            <MenuIcon :name="WATCHLIST_SORT_MODE_ICON[sortModeOf(group.id)]" :size="14" />
          </button>
          <button
            type="button"
            data-track="WATCHLIST_GROUP_ADD"
            class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
            :title="`添加股票到「${group.name}」`"
            :aria-label="`添加股票到「${group.name}」`"
            @click="emit('add', group.id)"
          >
            <MenuIcon name="plus" :size="14" />
          </button>
          <button
            type="button"
            data-track="WATCHLIST_GROUP_BATCH_ADD"
            class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
            :title="`批量添加到「${group.name}」`"
            :aria-label="`批量添加到「${group.name}」`"
            @click="emit('batchAdd', group.id)"
          >
            <MenuIcon name="tradeImport" :size="14" />
          </button>
        </span>
      </header>

      <!-- 列体：股票卡片（整列都是落点，空列也能落；拖拽走 Sortable，跨列 = 换分组；
           升 / 降序态下禁拖并按涨跌幅展示，恢复自定义后回到拖拽顺序） -->
      <VueDraggable
        :model-value="displayStocks(group)"
        :disabled="sortModeOf(group.id) !== 'custom'"
        tag="div"
        :group="WATCHLIST_GROUP_DRAG_GROUP"
        :animation="WATCHLIST_GROUP_DRAG_ANIMATION_MS"
        :move="onDragMoveCheck"
        :force-fallback="true"
        :data-group-id="group.id"
        ghost-class="opacity-40"
        class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2"
        @update:model-value="onStocksReorder(group, $event)"
      >
        <div
          v-for="stock in displayStocks(group)"
          :key="stock.symbol"
          :data-symbol="stock.symbol"
          class="group cursor-grab rounded-xl border border-flat-weak bg-flat-weak/40 p-2 transition-colors hover:bg-flat-weak active:cursor-grabbing"
          :aria-label="`拖拽 ${stock.name} 到其他分组`"
          @click="openDetail(stock.symbol)"
        >
          <!-- 默认三列：名称 / 现价 / 涨跌幅 -->
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-text">
              {{ findQuote(stock.symbol)?.name ?? stock.name }}
            </span>
            <span class="shrink-0 text-sm font-medium" :class="TREND_TEXT_CLASS[trendOf(stock.symbol)]">
              {{ formatPrice(findQuote(stock.symbol)?.price) }}
            </span>
            <span
              class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="TREND_PILL_CLASS[trendOf(stock.symbol)]"
            >
              {{ formatPercent(findQuote(stock.symbol)?.changePercent) }}
            </span>
            <!-- hover 操作：盯盘、编辑、删除、拖拽把手（把手恒在最右且 shrink-0，
                 按钮出现时由左侧名称 truncate 吸收宽度，不顶把手） -->
            <span class="hidden shrink-0 items-center gap-0.5 group-hover:flex">
              <!-- 其他插件贡献的行操作：宿主只按注册表渲染（自选盯盘在位时也走这里渲染「盯盘」开关） -->
              <button
                v-for="action in rowActions"
                :key="action.key"
                type="button"
                class="pressable rounded p-1 active:scale-90"
                :class="
                  action.isActive(toRowTarget(stock))
                    ? 'bg-primary-weak text-primary'
                    : 'text-text-tertiary hover:bg-flat-weak hover:text-text'
                "
                :title="`${action.isActive(toRowTarget(stock)) ? action.activeTitle : action.title} ${stock.name}`"
                :aria-label="`${action.isActive(toRowTarget(stock)) ? action.activeTitle : action.title} ${stock.name}`"
                @click.stop="action.run(toRowTarget(stock))"
              >
                <MenuIcon :name="action.icon" :size="13" />
              </button>
              <!-- 宿主兜底「盯盘」按钮：插件缺席时常显，点击引导先安装（避免功能入口凭空消失） -->
              <button
                v-if="!watchAction"
                type="button"
                class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
                :title="watchButtonTitle(stock)"
                :aria-label="watchButtonTitle(stock)"
                @click.stop="onWatchClick(stock)"
              >
                <MenuIcon name="eye" :size="13" />
              </button>
              <button
                type="button"
                data-track="WATCHLIST_EDIT_GROUPS"
                class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
                :title="`编辑 ${stock.name} 的分组归属`"
                :aria-label="`编辑 ${stock.name} 的分组归属`"
                @click.stop="emit('edit', stock)"
              >
                <MenuIcon name="pencil" :size="13" />
              </button>
              <button
                type="button"
                data-track="WATCHLIST_REMOVE"
                class="pressable rounded p-1 text-text-tertiary hover:bg-up-weak hover:text-up active:scale-90"
                :title="`从「${group.name}」移除 ${stock.name}`"
                :aria-label="`从当前分组移除 ${stock.name}`"
                @click.stop="emit('remove', { groupId: group.id, symbol: stock.symbol })"
              >
                <MenuIcon name="trash" :size="13" />
              </button>
            </span>
            <MenuIcon
              name="grip"
              :size="12"
              class="shrink-0 text-text-tertiary opacity-40 group-hover:opacity-100"
            />
          </div>
          <!-- hover 展开：补齐表格里被省略的字段（代码 / 成交额 / 换手率） -->
          <div class="hidden flex-col gap-0.5 border-t border-flat-weak pt-1.5 text-xs text-text-secondary group-hover:flex">
            <div class="flex items-center justify-between gap-2">
              <span class="text-text-tertiary">代码</span>
              <span class="font-mono">{{ stock.symbol }}</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-text-tertiary">成交额</span>
              <span>{{ formatAmount(findQuote(stock.symbol)?.amount) }}</span>
            </div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-text-tertiary">换手率</span>
              <span>{{ formatPercentUnsigned(findQuote(stock.symbol)?.turnoverRate) }}</span>
            </div>
          </div>
        </div>

        <!-- 空分组引导（参考博主分组看板） -->
        <p
          v-if="group.stocks.length === 0"
          class="rounded-xl border border-dashed border-flat-weak px-2 py-6 text-center text-xs leading-5 text-text-tertiary"
        >
          空分组
          <br />
          拖拽股票卡片到这里
        </p>
      </VueDraggable>
    </BaseCard>
  </div>
</template>
