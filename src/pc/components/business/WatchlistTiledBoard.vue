<script setup lang="ts">
import { ref } from 'vue';
import BaseCard from '../ui/BaseCard.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { useWatchlistStore } from '../../../common/stores/watchlist';
import { getTrendByChangePercent } from '../../../common/constants/trend.constants.ts';
import type { Trend } from '../../../common/constants/trend.constants.ts';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../../../common/constants/stock-colors.constants.ts';
import { formatAmount } from '../../../common/utils/format-amount';
import { formatPercent, formatPercentUnsigned } from '../../../common/utils/format-percent';
import { formatPrice } from '../../../common/utils/format-price';
import { findQuoteBySymbol } from '../../../common/utils/find-quote-by-symbol';
import { useStockOpen } from '../../../common/composables/use-stock-open';
import type { FullQuote } from '../../../common/types/stock-quote.types.ts';
import type { WatchlistGroup, WatchlistStock } from '../../../common/types/watchlist.types.ts';

/**
 * 自选股平铺看板（2026-10-27 王总指定，Tab 模式已删除，本组件即自选股页主体）：
 * 一个分组一列（横向卡片流，参考热点新闻页样式），列顺序与显隐由页面经 props 传入
 * （分组设置弹窗拖拽排序），列内卡片只展示名称 / 现价 / 涨跌幅三项，
 * hover 原位展开其余字段并浮现操作按钮（编辑分组归属 / 从本组移除）；
 * 卡片可拖拽到别的分组列 = 修改分组归属（同组内拖拽不动作），
 * 点击卡片进右侧个股详情侧栏（与表格行点击同一交互）
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

// ---------- 拖拽改分组（HTML5 原生 DnD） ----------

/** 拖拽中的卡片（symbol + 源分组 id；拖拽结束即清空） */
const dragState = ref<{ symbol: string; fromGroupId: string } | null>(null);

/** 悬停中的目标分组 id（高亮可落列；不在任何列上方时为 null） */
const dragOverGroupId = ref<string | null>(null);

/**
 * 卡片拖起：记录符号与源分组
 *
 * ⚠️ 必须往 dataTransfer 写入数据并设 effectAllowed（2026-10-28 修复）：
 * 空数据拖拽在 Chromium / WebView2 下会被判为无效拖拽源——光标全程「禁止」、
 * drop 链路不可靠，这是「拖拽改分组不可用」的根因
 * @param symbol 股票符号
 * @param groupId 源分组 id
 * @param event 原生 dragstart 事件（写 dataTransfer 用）
 */
const onDragStart = (symbol: string, groupId: string, event: DragEvent): void => {
  event.dataTransfer?.setData("text/plain", symbol);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
  }
  dragState.value = { symbol, fromGroupId: groupId };
};

/** 拖拽结束（无论落没落下）统一清态 */
const onDragEnd = (): void => {
  dragState.value = null;
  dragOverGroupId.value = null;
};

/**
 * 落列：跨分组移动该票（同组 / 无拖拽态时为 no-op）
 * @param groupId 目标分组 id
 */
const onDropToGroup = (groupId: string): void => {
  const drag = dragState.value;
  dragState.value = null;
  dragOverGroupId.value = null;
  if (!drag || drag.fromGroupId === groupId) {
    return;
  }
  watchlistStore.moveStockToGroup(drag.fromGroupId, groupId, drag.symbol);
};
</script>

<template>
  <!-- 横向卡片流：一个分组一列，超出页面横向滚动（列内各自纵向滚动） -->
  <div class="flex h-full min-h-0 gap-4 overflow-x-auto pb-1">
    <BaseCard
      v-for="group in props.groups"
      :key="group.id"
      class="!flex !h-full !w-[300px] !shrink-0 !flex-col !overflow-hidden !p-0 transition-shadow"
      :class="dragOverGroupId === group.id ? 'ring-2 ring-primary' : ''"
      @dragover.prevent="dragOverGroupId = group.id"
      @dragleave.self="dragOverGroupId === group.id && (dragOverGroupId = null)"
      @drop.prevent="onDropToGroup(group.id)"
    >
      <!-- 列头：分组名 + 列内添加/批量添加 icon（2026-10-28 王总指定：落点 = 本分组）+ 数量 -->
      <header
        class="flex shrink-0 items-center justify-between gap-2 border-b border-flat-weak px-4 py-3"
      >
        <h2 class="min-w-0 truncate text-sm font-semibold text-text">{{ group.name }}</h2>
        <span class="flex shrink-0 items-center gap-0.5">
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
        <span class="shrink-0 text-xs tabular-nums text-text-tertiary">
          {{ group.stocks.length }} 只
        </span>
      </header>

      <!-- 列体：股票卡片（整列都是落点，空列也能落） -->
      <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
        <div
          v-for="stock in group.stocks"
          :key="stock.symbol"
          draggable="true"
          class="group cursor-grab rounded-xl border border-flat-weak bg-flat-weak/40 p-2 transition-colors hover:bg-flat-weak active:cursor-grabbing"
          :aria-label="`拖拽 ${stock.name} 到其他分组`"
          @dragstart="onDragStart(stock.symbol, group.id, $event)"
          @dragend="onDragEnd"
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
            <!-- hover 操作：编辑、删除、拖拽把手（2026-10-28 王总指定顺序；
                 把手恒在最右且 shrink-0，按钮出现时由左侧名称 truncate 吸收宽度，不顶把手） -->
            <span class="hidden shrink-0 items-center gap-0.5 group-hover:flex">
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
      </div>
    </BaseCard>
  </div>
</template>
