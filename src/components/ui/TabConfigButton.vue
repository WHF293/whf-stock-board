<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import BaseButton from './BaseButton.vue';
import BaseModal from './BaseModal.vue';
import MenuIcon from './MenuIcon.vue';
import { normalizeTabConfig, type TabOption } from '../../composables/use-tab-config';
import { useTabConfigStore } from '../../stores/tab-config';

/**
 * 页面顶部 tabs 配置按钮（点击弹出配置弹窗）
 *
 * 交互约定（同板块过滤器 BoardFilterModal）：
 * - **草稿模式**：勾选与拖拽只改草稿，点「确认」才提交；「取消 / 遮罩 / ESC」不落盘。
 * - 顺序与勾选分开表达：`order` 是完整排列（决定 tab 顺序），`hidden` 是未勾选项。
 * - 「恢复默认」重置草稿为全选 + 声明顺序，仍需确认落盘（可反悔）。
 * - 至少保留一个可见 tab：全部取消勾选时禁用确认并提示。
 * - 拖拽用 `handle` 限定在手柄上；`force-fallback` 是必须的（Tauri WebView 下原生 DnD 不触发 drop）。
 */
const props = defineProps<{
  /** 页面 key（配置存储分桶） */
  pageId: string;
  /** 默认 tab 项（声明顺序即默认顺序，value 全集） */
  options: readonly TabOption<string>[];
}>();

const store = useTabConfigStore();

/** 弹窗开关 */
const open = ref(false);

/** 草稿顺序（拖拽直接重排它） */
const draftOrder = ref<string[]>([]);
/** 草稿未勾选项（不可见 tab） */
const draftHidden = ref<string[]>([]);

/** value -> 选项（展示名称用） */
const optionByValue = computed(
  () => new Map(props.options.map((option) => [option.value, option])),
);

/** 已勾选（可见）数量 */
const checkedCount = computed(
  () => draftOrder.value.length - draftHidden.value.length,
);

// 每次打开都用最新已保存值重置草稿（上次取消的改动不残留）
watch(open, (isOpen) => {
  if (!isOpen) return;
  const saved = store.configs[props.pageId];
  const normalized = saved
    ? normalizeTabConfig(saved.order, saved.hidden, props.options)
    : normalizeTabConfig([], [], props.options);
  draftOrder.value = normalized.order;
  draftHidden.value = normalized.hidden;
});

/**
 * 切换单个 tab 的勾选状态（勾选 = 显示）
 * @param value tab value
 * @param event 复选框 change 事件
 */
const onToggle = (value: string, event: Event): void => {
  const checked = (event.target as HTMLInputElement).checked;
  const next = new Set(draftHidden.value);
  if (checked) {
    next.delete(value);
  } else {
    next.add(value);
  }
  draftHidden.value = draftOrder.value.filter((item) => next.has(item));
};

/** 恢复默认：草稿回到全选 + 声明顺序（仍需确认落盘） */
const onResetDefault = (): void => {
  draftOrder.value = props.options.map((option) => option.value);
  draftHidden.value = [];
};

/** 确认：提交草稿并关闭 */
const onConfirm = (): void => {
  if (checkedCount.value === 0) return;
  store.setConfig(props.pageId, { order: [...draftOrder.value], hidden: [...draftHidden.value] });
  open.value = false;
};
</script>

<template>
  <!-- 配置入口：tabs 右侧小图标按钮 -->
  <button
    type="button"
    class="pressable shrink-0 rounded-lg p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
    aria-label="配置页签"
    title="配置页签显示与顺序"
    @click="open = true"
  >
    <MenuIcon name="sliders" :size="15" />
  </button>

  <BaseModal v-model:open="open" title="页签配置" max-width-class="max-w-sm">
    <p class="mb-3 text-xs text-text-tertiary">
      勾选要显示的页签，拖拽手柄调整顺序；点击「确认」保存并记住。
    </p>

    <!-- 勾选 + 拖拽列表 -->
    <VueDraggable
      v-model="draftOrder"
      tag="ul"
      :animation="150"
      handle=".tab-config-handle"
      :force-fallback="true"
      fallback-class="sortable-fallback"
      ghost-class="opacity-40"
      chosen-class="bg-flat-weak"
      class="space-y-1"
    >
      <li
        v-for="value in draftOrder"
        :key="value"
        class="flex select-none items-center gap-2.5 rounded-lg border border-flat-weak px-2.5 py-1.5 text-sm"
      >
        <MenuIcon
          name="grip"
          :size="16"
          class="tab-config-handle shrink-0 cursor-grab text-text-tertiary active:cursor-grabbing"
        />
        <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
          <input
            :checked="!draftHidden.includes(value)"
            type="checkbox"
            class="h-4 w-4 shrink-0 cursor-pointer rounded border-flat-weak accent-primary"
            @change="onToggle(value, $event)"
          />
          <span
            class="truncate"
            :class="draftHidden.includes(value) ? 'text-text-tertiary line-through' : 'text-text'"
          >
            {{ optionByValue.get(value)?.label ?? value }}
          </span>
        </label>
      </li>
    </VueDraggable>

    <p v-if="checkedCount === 0" class="mt-3 text-xs text-down">
      至少需要保留一个页签。
    </p>

    <template #footer>
      <BaseButton variant="ghost" class="mr-auto" @click="onResetDefault">恢复默认</BaseButton>
      <BaseButton variant="ghost" @click="open = false">取消</BaseButton>
      <BaseButton :disabled="checkedCount === 0" @click="onConfirm">确认</BaseButton>
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
