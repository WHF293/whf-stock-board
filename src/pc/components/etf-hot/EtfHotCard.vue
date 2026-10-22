<script setup lang="ts">
import BaseButton from '../ui/BaseButton.vue';
import BaseCard from '../ui/BaseCard.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import HotBoardList from '../hot-board/HotBoardList.vue';
import type { EtfBoardOption } from '../../../common/constants/etf-hot.constants.ts';
import type { HotBoardItem } from '../../../common/types/hot-board.types.ts';

/**
 * ETF 榜单卡片（ETF 热榜页的横向卡片流单元）
 *
 * 与「今天炒什么」的 HotBoardCard 同构，但一个榜单即一个卡片（无分组 chips）；
 * 列表本体复用 HotBoardList（rank 徽标 / 单击双击合并窗口 / 空态骨架全套继承）
 */

/** 卡片数据状态（与父组件的 BoardState 同构） */
interface CardState {
  /** 榜单条目 */
  items: HotBoardItem[];
  /** 是否加载中 */
  loading: boolean;
  /** 是否出错 */
  error: boolean;
  /** 是否已完成首次加载 */
  initialized: boolean;
  /** 快照抓取时间（毫秒） */
  fetchedAt: number;
}

defineProps<{
  /** 榜单定义（key / 标题 / 口径说明） */
  board: EtfBoardOption;
  /** 该榜单的数据状态 */
  state: CardState;
}>();

const emit = defineEmits<{
  /** 强制刷新 */
  refresh: [key: EtfBoardOption['key']];
  /** 放大弹窗 */
  expand: [key: EtfBoardOption['key']];
  /** 行单击（打开详情停靠面板） */
  openStock: [item: HotBoardItem];
  /** 行双击（写来源列表后进详情整页） */
  openStockPage: [item: HotBoardItem];
}>();
</script>

<template>
  <BaseCard class="!flex !h-full !w-[375px] !shrink-0 !flex-col !overflow-hidden !p-0">
    <!-- 卡片 header：标题 + 口径说明 + 条数 -->
    <header class="shrink-0 border-b border-flat-weak px-4 py-3">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold text-text">{{ board.label }}</h2>
        <div class="flex shrink-0 items-center gap-1">
          <span class="text-xs text-text-tertiary">{{ state.items.length }} 只</span>
          <button
            type="button"
            class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
            :aria-label="`放大查看${board.label}`"
            :title="`放大查看${board.label}`"
            @click="emit('expand', board.key)"
          >
            <MenuIcon name="expand" :size="14" />
          </button>
        </div>
      </div>
      <p class="mt-0.5 truncate text-xs text-text-tertiary" :title="board.desc">
        {{ board.desc }}
      </p>
    </header>

    <!-- 列表本体（与今天炒什么共用同一列表组件） -->
    <div class="flex-1 overflow-y-auto">
      <HotBoardList
        :items="state.items"
        :loading="state.loading"
        :error="state.error"
        :initialized="state.initialized"
        @open="(item) => emit('openStock', item)"
        @open-page="(item) => emit('openStockPage', item)"
      />
    </div>

    <!-- footer：抓取时间 + 强制刷新 -->
    <footer class="flex shrink-0 items-center justify-between gap-2 border-t border-flat-weak px-4 py-2">
      <span class="text-xs text-text-tertiary">
        {{
          state.fetchedAt > 0
            ? `更新于 ${new Date(state.fetchedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
            : '未加载'
        }}
      </span>
      <BaseButton variant="ghost" :disabled="state.loading" @click="emit('refresh', board.key)">
        {{ state.loading ? '刷新中...' : '强制刷新' }}
      </BaseButton>
    </footer>
  </BaseCard>
</template>
