<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import MenuIcon from '../ui/MenuIcon.vue';

/**
 * 自选股分组设置弹窗（热点新闻「新闻源设置」同款交互）：
 * 拖拽手柄调整分组列顺序 + 勾选控制分组是否显示；
 * 草稿模式 —— 确认才提交，取消 / 遮罩 / ESC 不产生任何副作用；
 * 自定义分组行内附「删除分组」入口（默认组受 store 保护不可删）
 */

/** 单个分组设置条目 */
interface GroupOption {
  /** 分组 id */
  value: string;
  /** 分组名 */
  label: string;
  /** 是否显示（勾选） */
  enabled: boolean;
  /** 是否可删除（默认组不可删） */
  deletable: boolean;
}

const props = defineProps<{
  /** 已保存的分组设置（顺序即看板列顺序） */
  items: GroupOption[];
}>();

const emit = defineEmits<{
  /** 确认：提交勾选与顺序（由父组件落 store 与 appStorage） */
  confirm: [items: { value: string; enabled: boolean }[]];
  /** 删除分组（默认组不出现该入口；父级弹二次确认） */
  remove: [groupId: string];
}>();

const open = defineModel<boolean>('open', { required: true });

/** 草稿列表（拖拽直接重排；勾选直接改 enabled） */
const draftItems = ref<GroupOption[]>([]);

// 每次打开都用最新已保存值重置草稿（上次取消的改动不残留）
watch(open, (isOpen) => {
  if (!isOpen) return;
  draftItems.value = props.items.map((item) => ({ ...item }));
});

/** 已勾选数量 */
const checkedCount = computed(() => draftItems.value.filter((item) => item.enabled).length);

/** 确认：回传草稿并关闭 */
const onConfirm = (): void => {
  emit(
    'confirm',
    draftItems.value.map(({ value, enabled }) => ({ value, enabled })),
  );
  open.value = false;
};

/**
 * 请求删除分组（行内删除按钮 → 父级二次确认）
 * @param groupId 分组 id
 */
const onRemove = (groupId: string): void => {
  emit('remove', groupId);
};
</script>

<template>
  <BaseModal v-model:open="open" title="分组设置" max-width-class="max-w-md">
    <p class="mb-3 text-xs text-text-tertiary">
      勾选要显示的分组，拖拽手柄调整看板列顺序；点击「确认」保存并记住。
    </p>

    <div class="mb-1 flex items-center justify-between px-2.5 text-[10px] text-text-tertiary">
      <span>拖拽手柄调整顺序 · 勾选框控制是否显示</span>
      <span>已选 {{ checkedCount }} / {{ draftItems.length }}</span>
    </div>

    <!-- 勾选 + 拖拽列表 -->
    <VueDraggable
      v-model="draftItems"
      tag="ul"
      :animation="150"
      handle=".group-handle"
      :force-fallback="true"
      fallback-class="sortable-fallback"
      ghost-class="opacity-40"
      chosen-class="bg-flat-weak"
      class="space-y-1"
    >
      <li
        v-for="item in draftItems"
        :key="item.value"
        class="flex select-none items-center gap-2.5 rounded-lg border border-flat-weak px-2.5 py-1.5 text-sm"
      >
        <MenuIcon
          name="grip"
          :size="16"
          class="group-handle shrink-0 cursor-grab text-text-tertiary active:cursor-grabbing"
        />
        <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
          <input
            v-model="item.enabled"
            type="checkbox"
            class="h-4 w-4 shrink-0 cursor-pointer rounded border-flat-weak accent-primary"
          />
          <span :class="item.enabled ? 'text-text' : 'text-text-tertiary line-through'">
            {{ item.label }}
          </span>
        </label>
        <button
          v-if="item.deletable"
          type="button"
          class="pressable shrink-0 rounded p-1 text-text-tertiary hover:bg-up-weak hover:text-up active:scale-90"
          :aria-label="`删除分组 ${item.label}`"
          :title="`删除分组「${item.label}」`"
          @click="onRemove(item.value)"
        >
          <MenuIcon name="trash" :size="14" />
        </button>
      </li>
    </VueDraggable>

    <p v-if="checkedCount === 0" class="mt-3 text-xs text-down">未勾选任何分组，看板将显示为空。</p>

    <template #footer>
      <BaseButton variant="ghost" @click="open = false">取消</BaseButton>
      <BaseButton @click="onConfirm">确认</BaseButton>
    </template>
  </BaseModal>
</template>

<style scoped>
/*
 * 拖拽跟随元素（force-fallback 模式的克隆体，被挂到 body 上）
 *
 * ⚠️ `fallback-class` 只能传**单个** class 名：SortableJS 用 classList.add 添加，
 * 含空格的多 class 字符串会直接抛 DOMTokenList 错误（拖拽跟随元素就完全没样式）。
 * 外观必须写在这里的 :global 里（scoped 选择器命不中 body 上的元素）。
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
