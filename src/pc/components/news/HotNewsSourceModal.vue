<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import MenuIcon from '../ui/MenuIcon.vue';

/**
 * 热点新闻源设置弹窗（勾选要显示的源 + 拖拽决定卡片顺序）
 *
 * 与板块过滤器同款交互约定：
 * - **草稿模式**：勾选与拖拽只改草稿，点「确认」才提交（父组件负责落盘与补拉）；
 *   「取消 / 遮罩 / ESC」不产生任何副作用。
 * - 拖拽用 `handle` 限定在手柄上，勾选框点击不受影响；
 *   `force-fallback` 是必须的（Tauri WebView 下原生 HTML5 DnD 不触发 drop）。
 */

/** 单个源设置条目（label 仅展示用，不回传） */
interface SourceOption {
  /** 新闻源 key */
  value: string;
  /** 展示名 */
  label: string;
  /** 是否启用（勾选） */
  enabled: boolean;
}

const props = defineProps<{
  /** 已保存的源设置（顺序即卡片顺序） */
  items: SourceOption[];
}>();

const emit = defineEmits<{
  /** 确认：提交勾选与顺序（由父组件持久化并补拉新勾选的源） */
  confirm: [items: { value: string; enabled: boolean }[]];
}>();

const open = defineModel<boolean>('open', { required: true });

/** 草稿列表（拖拽直接重排；勾选直接改 enabled） */
const draftItems = ref<SourceOption[]>([]);

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
</script>

<template>
  <BaseModal v-model:open="open" title="新闻源设置" max-width-class="max-w-md">
    <p class="mb-3 text-xs text-text-tertiary">
      勾选要显示的新闻源，拖拽手柄调整卡片顺序；点击「确认」保存并记住。
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
      handle=".source-handle"
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
          class="source-handle shrink-0 cursor-grab text-text-tertiary active:cursor-grabbing"
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
      </li>
    </VueDraggable>

    <p v-if="checkedCount === 0" class="mt-3 text-xs text-down">未勾选任何新闻源，页面将显示为空。</p>

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
