<script setup lang="ts">
import { ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { PANORAMA_CARD_DEFAULT_ORDER, PANORAMA_CARDS } from '../../../common/constants/panorama.constants.ts';

/**
 * 全景页模块排序弹窗（2026-11-07 王总指定；盘面雷达「页签设置」同款草稿交互）：
 * 拖拽手柄调整四组卡片（A股板块平铺 / 国外科技巨头 / 美股基金 / 全球宏观）顺序；
 * 草稿模式 —— 确认才提交，取消 / 遮罩 / ESC 不产生任何副作用；
 * 「恢复默认」把草稿回退为声明顺序（仍需点确认生效）
 */

/** 单个模块条目（label 仅展示用，不回传） */
interface ModuleOption {
  /** 卡片 id（cn / globalTech / usBoards / macro） */
  id: string;
  /** 展示名 */
  label: string;
}

const props = defineProps<{
  /** 已保存的模块顺序（顺序即页面卡片顺序） */
  items: ModuleOption[];
}>();

const emit = defineEmits<{
  /** 确认：提交顺序（由父组件持久化到 settings） */
  confirm: [ids: string[]];
}>();

const open = defineModel<boolean>('open', { required: true });

/** 草稿列表（拖拽直接重排） */
const draftItems = ref<ModuleOption[]>([]);

// 每次打开都用最新已保存值重置草稿（上次取消的改动不残留）
watch(open, (isOpen) => {
  if (!isOpen) return;
  draftItems.value = props.items.map((item) => ({ ...item }));
});

/** 恢复默认：草稿回退为卡片声明顺序（仍需点确认生效） */
const onReset = (): void => {
  const byId = new Map(draftItems.value.map((item) => [item.id, item]));
  draftItems.value = PANORAMA_CARD_DEFAULT_ORDER.map(
    (id) => byId.get(id) ?? { id, label: PANORAMA_CARDS.find((card) => card.id === id)?.label ?? id },
  );
};

/** 确认：回传草稿顺序并关闭 */
const onConfirm = (): void => {
  emit('confirm', draftItems.value.map((item) => item.id));
  open.value = false;
};
</script>

<template>
  <BaseModal v-model:open="open" title="模块排序" max-width-class="max-w-md">
    <p class="mb-3 text-xs text-text-tertiary">
      拖拽手柄调整四组卡片的上下顺序；点击「确认」保存并记住，页面卡片顺序即时跟随。
    </p>

    <VueDraggable
      v-model="draftItems"
      tag="ul"
      :animation="150"
      handle=".panorama-module-handle"
      :force-fallback="true"
      fallback-class="sortable-fallback"
      ghost-class="opacity-40"
      chosen-class="bg-flat-weak"
      class="space-y-1"
    >
      <li
        v-for="item in draftItems"
        :key="item.id"
        class="flex select-none items-center gap-2.5 rounded-lg border border-flat-weak px-2.5 py-1.5 text-sm"
      >
        <MenuIcon
          name="grip"
          :size="16"
          class="panorama-module-handle shrink-0 cursor-grab text-text-tertiary active:cursor-grabbing"
        />
        <span class="min-w-0 flex-1 truncate text-text">{{ item.label }}</span>
      </li>
    </VueDraggable>

    <template #footer>
      <BaseButton variant="ghost" @click="onReset">恢复默认</BaseButton>
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
 * 外观必须写在这里的 :global 里（scoped 选择器命不中 body 上的元素）；
 * 与页签设置弹窗同款规则，重复声明无副作用
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
