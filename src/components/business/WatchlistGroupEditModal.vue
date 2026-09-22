<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseConfirmModal from '../ui/BaseConfirmModal.vue';
import { useWatchlistStore } from '../../stores/watchlist';
import type { WatchlistStock } from '../../types/watchlist.types';

/**
 * 自选股「分组归属」编辑弹窗（自选股表格操作列的编辑按钮触发）
 *
 * 列出**全部分组**并勾选该票当前所在的分组：
 * - 勾上 = 确认后加入该分组；取消勾选 = 确认后从该分组移除（全不勾 = 从全部分组移除）；
 * - 底部操作栏左侧两个快捷按钮（全选 / 全不选）只作用于**草稿**，同样要点「确认」才落库；
 * - 归属读 `useWatchlistStore().groups`，写入交给宿主（本组件是纯受控组件，
 *   只 emit `confirm(groupIds)`，不直接改 store）。
 *
 * 与「删除」按钮的分工：删除 icon 只把票从**当前分组**摘掉，本弹窗负责跨分组的整体归属。
 */
const props = defineProps<{
  /** 待编辑的自选股条目（null = 无内容，只会在关闭态出现） */
  stock: WatchlistStock | null;
}>();

const open = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{
  /** 用户点确认后的勾选结果（分组 id 列表，空数组 = 不属于任何分组） */
  confirm: [groupIds: string[]];
}>();

const watchlistStore = useWatchlistStore();

/** 勾选草稿（打开时按当前归属播种，「确认」前不影响 store） */
const checkedIds = ref<string[]>([]);

// 打开 / 换票时重新播种草稿：immediate 兜底「挂载时就是打开态」；
// 关闭时不动草稿，避免关闭动画期间列表出现勾选跳变
watch(
  [open, () => props.stock?.symbol],
  ([isOpen]) => {
    if (!isOpen) {
      return;
    }
    checkedIds.value = props.stock ? watchlistStore.groupIdsOfSymbol(props.stock.symbol) : [];
  },
  { immediate: true },
);

/** 全选：勾上所有分组（默认分组也在内，它同样是可编辑的归属） */
const onSelectAll = (): void => {
  checkedIds.value = watchlistStore.groups.map((group) => group.id);
};

/** 全不选：清空勾选（确认后即从全部分组移除） */
const onSelectNone = (): void => {
  checkedIds.value = [];
};

/** 确认：把草稿交给宿主落库（弹窗自身由 BaseConfirmModal 关闭） */
const onConfirm = (): void => {
  emit('confirm', [...checkedIds.value]);
};
</script>

<template>
  <BaseConfirmModal
    v-model:open="open"
    :title="stock ? `编辑分组 · ${stock.name}` : '编辑分组'"
    ok-text="确认"
    cancel-text="取消"
    max-width-class="max-w-sm"
    @ok="onConfirm"
  >
    <p class="mb-2 text-xs text-text-tertiary">
      勾选后该股票会显示在对应分组中，取消勾选则从该分组移除
    </p>
    <div class="space-y-1">
      <label
        v-for="group in watchlistStore.groups"
        :key="group.id"
        class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-flat-weak"
      >
        <input
          v-model="checkedIds"
          type="checkbox"
          :value="group.id"
          class="accent-primary"
          :aria-label="`${group.name}分组`"
        />
        <span class="text-sm text-text">{{ group.name }}</span>
        <span class="text-xs text-text-tertiary">{{ group.stocks.length }} 只</span>
      </label>
    </div>
    <!-- 快捷按钮放在操作栏左侧，与「取消 / 确认」分离（复用编排弹窗的 #footer-extra 约定） -->
    <template #footer-extra>
      <BaseButton variant="ghost" @click="onSelectAll">全选</BaseButton>
      <BaseButton variant="ghost" @click="onSelectNone">全不选</BaseButton>
    </template>
  </BaseConfirmModal>
</template>
