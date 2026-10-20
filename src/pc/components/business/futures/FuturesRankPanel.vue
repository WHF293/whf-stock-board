<script setup lang="ts">
import { computed, ref } from 'vue';
import MenuIcon from '../../ui/MenuIcon.vue';

/** 衍生榜单条目 */
export interface FuturesRankItem {
  /** 席位名 */
  name: string;
  /** 数值（手） */
  value: number;
  /** 语义类（text-up / text-down） */
  cls: string;
}

/** 单个榜单（迷你排行） */
export interface FuturesRankList {
  /** 榜单名 */
  title: string;
  /** 条目（已按值排好序，取前 5） */
  items: readonly FuturesRankItem[];
}

/**
 * 机构行为页 · 衍生榜单（折叠面板）
 *
 * 单合约口径六榜（净多 / 净空 / 多增减 / 多减 / 空增 / 空减），聚合口径三榜
 * （合并净多 / 净空 / 净增减）。榜单数据由父级组装，本组件只负责折叠与渲染；
 * 刻意做成按需展开，避免用户只看衍生榜丢失完整上下文。
 */
const props = defineProps<{
  /** 榜单列表 */
  lists: readonly FuturesRankList[];
}>();

/** 是否展开（默认收起） */
const expanded = ref(false);

/** 每榜展示条数 */
const TOP_N = 5;

/** 展示用榜单（截取前 N 条） */
const visibleLists = computed(() =>
  props.lists.map((list) => ({ ...list, items: list.items.slice(0, TOP_N) })),
);
</script>

<template>
  <section class="rounded-card bg-surface shadow-card">
    <button
      type="button"
      class="pressable flex w-full items-center gap-2 rounded-card px-4 py-3 text-left"
      @click="expanded = !expanded"
    >
      <span class="text-sm font-semibold text-text">衍生榜单</span>
      <span class="text-xs text-text-tertiary">净多 / 净空 / 增减仓 TOP，按需展开</span>
      <MenuIcon :name="expanded ? 'chevronDown' : 'chevronRight'" :size="14" class="ml-auto text-text-tertiary" />
    </button>
    <div v-if="expanded" class="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="list in visibleLists" :key="list.title" class="rounded-lg bg-bg p-3">
        <h3 class="mb-1.5 text-xs font-bold text-text-tertiary">{{ list.title }}</h3>
        <div
          v-for="item in list.items"
          :key="item.name"
          class="flex items-center justify-between py-0.5 text-xs text-text-secondary"
        >
          <span class="truncate">{{ item.name }}</span>
          <span class="ml-2 font-semibold tabular-nums" :class="item.cls">{{ item.value.toLocaleString('en-US') }}</span>
        </div>
        <div v-if="list.items.length === 0" class="py-1 text-xs text-text-tertiary">--</div>
      </div>
    </div>
  </section>
</template>
