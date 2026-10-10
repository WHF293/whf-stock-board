<script setup lang="ts">
import BaseButton from '../ui/BaseButton.vue';
import BaseCard from '../ui/BaseCard.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import HotNewsChannelBar from '../news/HotNewsChannelBar.vue';
import HotBoardList from './HotBoardList.vue';
import type { BoardGroupOption, BoardSource } from '../../../common/constants/hot-board.constants.ts';
import type { HotBoardItem } from '../../../common/types/hot-board.types.ts';

/**
 * 热股平台卡片（今天炒什么页的横向卡片流单元）
 *
 * 纯展示组件：平台元信息（logo / 名称 / 分组定义）与该平台当前分组的数据状态
 * 全由父组件持有；分组 chips 复用热点新闻的 HotNewsChannelBar（同款分段控件）
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
  /** 平台（缓存 / 回调回传用） */
  source: BoardSource;
  /** 平台展示名 */
  label: string;
  /** 平台 logo 地址 */
  logo: string;
  /** 分组选项（chips 渲染顺序） */
  groups: readonly BoardGroupOption[];
  /** 当前选中分组值 */
  activeGroup: string;
  /** 该平台当前分组的数据状态 */
  state: CardState;
  /** 单卡「AI 分析」进行中（icon 转圈提示） */
  aiRunning: boolean;
}>();

const emit = defineEmits<{
  /** 切换分组 */
  selectGroup: [source: BoardSource, group: string];
  /** 强制刷新 */
  refresh: [source: BoardSource];
  /** 放大弹窗 */
  expand: [source: BoardSource];
  /** 单卡 AI 分析 */
  ai: [source: BoardSource];
  /** 行单击（打开个股详情停靠面板） */
  openStock: [item: HotBoardItem];
  /** 行双击（写来源列表后进个股详情整页） */
  openStockPage: [item: HotBoardItem];
}>();
</script>

<template>
  <BaseCard class="!flex !h-full !w-[375px] !shrink-0 !flex-col !overflow-hidden !p-0">
    <!-- 卡片 header：平台 logo + 名称 + 单卡 AI 分析 + 条数 + 放大 -->
    <header class="flex shrink-0 items-center justify-between gap-2 border-b border-flat-weak px-4 py-3">
      <div class="flex min-w-0 items-center gap-1.5">
        <h2 class="flex items-center gap-2 text-sm font-semibold text-text">
          <img :src="logo" alt="" class="h-5 w-5 rounded" loading="lazy" />
          {{ label }}
        </h2>
        <button
          type="button"
          class="pressable shrink-0 rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90 disabled:cursor-not-allowed disabled:opacity-50"
          :aria-label="`AI 分析${label}`"
          :title="`AI 分析${label}`"
          :disabled="aiRunning"
          @click="emit('ai', source)"
        >
          <MenuIcon name="agent" :size="14" />
        </button>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <span class="text-xs text-text-tertiary">{{ state.items.length }} 只</span>
        <button
          type="button"
          class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
          :aria-label="`放大查看${label}`"
          :title="`放大查看${label}`"
          @click="emit('expand', source)"
        >
          <MenuIcon name="expand" :size="14" />
        </button>
      </div>
    </header>

    <!-- 分组切换 chips（单分组平台不渲染切换条） -->
    <div v-if="groups.length > 1" class="shrink-0 border-b border-flat-weak px-3 py-2">
      <HotNewsChannelBar
        :views="groups"
        :active="activeGroup"
        @select-view="(group: string) => emit('selectGroup', source, group)"
      />
    </div>

    <!-- 列表本体（卡片与放大弹窗共用同一组件） -->
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
      <BaseButton variant="ghost" :disabled="state.loading" @click="emit('refresh', source)">
        {{ state.loading ? '刷新中...' : '强制刷新' }}
      </BaseButton>
    </footer>
  </BaseCard>
</template>
