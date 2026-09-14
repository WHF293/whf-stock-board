<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { useStockAccountStore } from '../../stores/stock-account';

/**
 * 账户管理弹窗（tab 条右侧 ☰ 按钮打开）：
 *
 * checkbox 勾选 = 该账户在 tab 条显示；拖拽手柄调整 tab 顺序。
 * 草稿模式：改动仅入草稿，点「确认」才写 store 持久化。
 * 拖拽 force-fallback 为必须（Tauri WebView 下原生 DnD 不触发 drop）。
 */

const emit = defineEmits<{
  /** 确认：提交顺序与显隐（由父组件负责调用 store） */
  confirm: [];
}>();

const open = defineModel<boolean>('open', { required: true });

const accountStore = useStockAccountStore();

/** 草稿顺序（完整排列） */
const draftOrder = ref<string[]>([]);
/** 草稿未勾选项 */
const draftHidden = ref<string[]>([]);

/** 账户 id -> 账户（展示名称用） */
const accountById = computed(
  () => new Map(accountStore.accounts.map((account) => [account.id, account])),
);

/** 已勾选数量 */
const checkedCount = computed(
  () => draftOrder.value.length - draftHidden.value.length,
);

// 每次打开用最新已保存值重置草稿
watch(open, (isOpen) => {
  if (!isOpen) return;
  const savedOrder = accountStore.accountOrder.length > 0
    ? accountStore.accountOrder
    : accountStore.accounts.map((account) => account.id);
  const known = new Set(accountStore.accounts.map((account) => account.id));
  // 归一化：丢弃已删除的、补齐未入排序的新账户到末尾
  draftOrder.value = [
    ...savedOrder.filter((id) => known.has(id)),
    ...accountStore.accounts.map((account) => account.id).filter((id) => !savedOrder.includes(id)),
  ];
  draftHidden.value = accountStore.accountHidden.filter((id) => known.has(id));
});

/**
 * 切换单个账户的勾选（勾选 = 显示在 tab 条）
 * @param id 账户 id
 * @param event 复选框 change 事件
 */
const onToggle = (id: string, event: Event): void => {
  const checked = (event.target as HTMLInputElement).checked;
  const next = new Set(draftHidden.value);
  if (checked) {
    next.delete(id);
  } else {
    next.add(id);
  }
  draftHidden.value = draftOrder.value.filter((item) => next.has(item));
};

/** 确认：写 store 并关闭 */
const onConfirm = (): void => {
  accountStore.setAccountConfig([...draftOrder.value], [...draftHidden.value]);
  emit('confirm');
  open.value = false;
};
</script>

<template>
  <BaseModal v-model:open="open" title="账户管理" max-width-class="max-w-sm">
    <p class="mb-3 text-xs text-text-tertiary">
      勾选要在 tab 条显示的账户，拖拽手柄调整顺序；点击「确认」保存并记住。
    </p>

    <VueDraggable
      v-model="draftOrder"
      tag="ul"
      :animation="150"
      handle=".account-handle"
      :force-fallback="true"
      fallback-class="sortable-fallback"
      ghost-class="opacity-40"
      chosen-class="bg-flat-weak"
      class="space-y-1"
    >
      <li
        v-for="id in draftOrder"
        :key="id"
        class="flex select-none items-center gap-2.5 rounded-lg border border-flat-weak px-2.5 py-1.5 text-sm"
      >
        <MenuIcon
          name="grip"
          :size="16"
          class="account-handle shrink-0 cursor-grab text-text-tertiary active:cursor-grabbing"
        />
        <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
          <input
            :checked="!draftHidden.includes(id)"
            type="checkbox"
            class="h-4 w-4 shrink-0 cursor-pointer rounded border-flat-weak accent-primary"
            @change="onToggle(id, $event)"
          />
          <span
            class="truncate"
            :class="draftHidden.includes(id) ? 'text-text-tertiary line-through' : 'text-text'"
          >
            {{ accountById.get(id)?.name ?? id }}
          </span>
        </label>
      </li>
    </VueDraggable>

    <p v-if="checkedCount === 0" class="mt-3 text-xs text-down">
      至少需要保留一个账户。
    </p>

    <template #footer>
      <BaseButton variant="ghost" @click="open = false">取消</BaseButton>
      <BaseButton :disabled="checkedCount === 0" @click="onConfirm">确认</BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
/*
 * 拖拽跟随元素（force-fallback 模式的克隆体，被挂到 body 上）
 * fallback-class 只能传单个 class 名；外观写在 :global（scoped 命不中 body 上的元素）
 */
:global(.sortable-fallback) {
  z-index: 60;
  cursor: grabbing;
  border-radius: 0.5rem;
  border: 1px solid var(--color-flat-weak, rgba(148, 163, 184, 0.25));
  background: var(--color-surface);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
</style>
