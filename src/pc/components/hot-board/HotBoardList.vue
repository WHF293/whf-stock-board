<script setup lang="ts">
import { ref } from 'vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import type { HotBoardItem } from '../../../common/types/hot-board.types.ts';

/**
 * 热股榜单列表（今天炒什么页卡片与放大弹窗共用的列表本体）
 *
 * 纯展示组件：条目、加载与错误状态全由父组件持有；
 * 行交互采用「单击 / 双击合并窗口」（与 BaseTable 的 enableDblclickNav 同语义）：
 * 单击延迟派发（打开个股详情侧栏），窗口内收到双击则取消单击、直接派发双击
 * （打开个股详情整页）
 */

defineProps<{
  /** 归一化榜单条目（按名次升序） */
  items: HotBoardItem[];
  /** 是否加载中 */
  loading: boolean;
  /** 是否出错 */
  error: boolean;
  /** 是否已完成首次加载（首屏骨架 / 错误态只在未初始化时展示） */
  initialized: boolean;
  /** 列数（卡片单列 / 放大弹窗双列，默认单列） */
  columns?: 1 | 2;
}>();

const emit = defineEmits<{
  /** 行单击（延迟合并后派发；父组件打开个股详情停靠面板） */
  open: [item: HotBoardItem];
  /** 行双击（取消待派发的单击；父组件写来源列表后进详情整页） */
  openPage: [item: HotBoardItem];
}>();

/** 排名徽标前三名以内的高亮（bg-up 圆标，其余灰底） */
const RANK_HIGHLIGHT_COUNT = 3;

/** 单击/双击合并窗口（毫秒，与 BaseTable 同口径） */
const DBLCLICK_MERGE_MS = 250;

/** 待派发的单击（timer + 行；null = 无待派发单击） */
const pendingClick = ref<{ timer: number; item: HotBoardItem } | null>(null);

/**
 * 行单击：延迟派发，合并窗口内收到双击则取消
 * @param item 行条目
 */
const onRowClick = (item: HotBoardItem): void => {
  if (pendingClick.value) {
    window.clearTimeout(pendingClick.value.timer);
  }
  const timer = window.setTimeout(() => {
    pendingClick.value = null;
    emit('open', item);
  }, DBLCLICK_MERGE_MS);
  pendingClick.value = { timer, item };
};

/**
 * 行双击：取消未派发的单击，直接派发
 * @param item 行条目
 */
const onRowDblclick = (item: HotBoardItem): void => {
  if (pendingClick.value) {
    window.clearTimeout(pendingClick.value.timer);
    pendingClick.value = null;
  }
  emit('openPage', item);
};
</script>

<template>
  <div>
    <div v-if="loading && !initialized" class="p-4">
      <BaseSkeleton />
    </div>
    <div v-else-if="error && !initialized" class="py-10">
      <BaseEmpty text="榜单加载失败，请刷新重试" />
    </div>
    <ul
      v-else-if="items.length > 0"
      :class="columns === 2 ? 'grid gap-x-6 gap-y-1 md:grid-cols-2' : 'flex flex-col'"
    >
      <li v-for="item in items" :key="item.symbol" class="flex">
        <button
          type="button"
          class="pressable block w-full rounded-md px-3 py-2.5 text-left odd:bg-flat-weak/30 hover:bg-flat-weak/50"
          @click="onRowClick(item)"
          @dblclick="onRowDblclick(item)"
        >
          <div class="flex items-center gap-2">
            <span
              class="h-[18px] w-[18px] shrink-0 rounded-full text-center text-[10px] leading-[18px] font-semibold"
              :class="item.rank <= RANK_HIGHLIGHT_COUNT ? 'bg-up text-white' : 'bg-flat-weak text-text-tertiary'"
            >
              {{ item.rank }}
            </span>
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-text">
              {{ item.name }}
            </span>
            <span class="shrink-0 text-sm text-text">
              {{ item.price === null ? '--' : item.price.toFixed(2) }}
            </span>
            <span
              class="w-16 shrink-0 text-right text-sm font-medium"
              :class="item.changePct === null ? 'text-text-tertiary' : item.changePct >= 0 ? 'text-up' : 'text-down'"
            >
              <template v-if="item.changePct === null">--</template>
              <template v-else>{{ item.changePct >= 0 ? '+' : '' }}{{ item.changePct.toFixed(2) }}%</template>
            </span>
          </div>
          <div class="mt-1 flex items-center gap-1.5 pl-[26px] text-[11px] text-text-tertiary">
            <span class="shrink-0">{{ item.code }}</span>
            <span v-if="item.heatLabel" class="shrink-0">{{ item.heatLabel }}</span>
            <span
              v-if="item.rankChange !== null && item.rankChange !== 0"
              class="shrink-0"
              :class="item.rankChange > 0 ? 'text-up' : 'text-down'"
            >
              {{ item.rankChange > 0 ? '↑' : '↓' }}{{ Math.abs(item.rankChange) }}
            </span>
            <span v-if="item.tags.length > 0" class="min-w-0 truncate">
              {{ item.tags.join(' · ') }}
            </span>
          </div>
        </button>
      </li>
    </ul>
    <BaseEmpty v-else text="暂无榜单数据" />
  </div>
</template>
