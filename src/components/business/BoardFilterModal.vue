<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { SW_LEVEL1_BOARDS } from '../../constants/board-calendar.constants';
import {
  BOARD_DEFAULT_ORDER,
  normalizeBoardHidden,
  normalizeBoardOrder,
} from '../../utils/board-order';
import type { BoardColumnSelection } from '../../types/board-calendar.types';

/**
 * 板块过滤器（勾选要显示的板块 + 拖拽决定行序）
 *
 * 交互约定：
 * - **草稿模式**：勾选与拖拽只改草稿，点「确认」才提交；「取消 / 遮罩 / ESC」不落盘。
 * - 顺序与勾选分开表达：`order` 是完整排列（决定行序），`hidden` 是未勾选项，
 *   这样才能区分「用户主动取消勾选」与「新版本新增的板块」。
 * - 拖拽用 `handle` 限定在手柄上，勾选框点击不受影响；
 *   `force-fallback` 是必须的（Tauri WebView 下原生 HTML5 DnD 不触发 drop）。
 */

const props = defineProps<{
  /** 已保存的列顺序（完整排列） */
  order: string[];
  /** 已保存的未勾选板块代码 */
  hidden: string[];
  /** 当前热门口径下各板块的热门值（code → 值），用于「按热门重排」 */
  heatValues: Record<string, number>;
  /** 热门值展示名（如「近5日涨停」） */
  heatLabel: string;
}>();

const emit = defineEmits<{
  /** 确认：提交勾选与顺序（由父组件负责持久化） */
  confirm: [selection: BoardColumnSelection];
}>();

const open = defineModel<boolean>('open', { required: true });

/** 草稿顺序（拖拽直接重排它） */
const draftOrder = ref<string[]>([]);
/** 草稿未勾选项（与 checkbox 的 v-model 直接绑定） */
const draftHidden = ref<string[]>([]);

/** 代码 → 板块（展示名称用） */
const boardByCode = computed(
  () => new Map(SW_LEVEL1_BOARDS.map((board) => [board.code, board])),
);

/** 已勾选数量 */
const checkedCount = computed(
  () => draftOrder.value.length - draftHidden.value.length,
);

// 每次打开都用最新已保存值重置草稿（上次取消的改动不残留）
watch(open, (isOpen) => {
  if (!isOpen) return;
  draftOrder.value = normalizeBoardOrder(props.order);
  draftHidden.value = normalizeBoardHidden(props.hidden);
});

/** 全选 */
const onSelectAll = (): void => {
  draftHidden.value = [];
};

/**
 * 切换单个板块的勾选状态
 *
 * 勾选 = 显示（与直觉一致）；内部仍以「未勾选集合」表达，
 * 便于区分「用户主动取消勾选」与「新版本新增的板块」。
 * @param code 板块代码
 * @param event 复选框 change 事件
 */
const onToggle = (code: string, event: Event): void => {
  const checked = (event.target as HTMLInputElement).checked;
  const next = new Set(draftHidden.value);
  if (checked) {
    next.delete(code);
  } else {
    next.add(code);
  }
  draftHidden.value = draftOrder.value.filter((item) => next.has(item));
};

/** 全不选（表格会显示为空，确认前会给出提示） */
const onClearAll = (): void => {
  draftHidden.value = [...draftOrder.value];
};

/** 反选 */
const onInvert = (): void => {
  const hidden = new Set(draftHidden.value);
  draftHidden.value = draftOrder.value.filter((code) => !hidden.has(code));
};

/** 按当前热门口径重排（未勾选的板块自然沉到末尾，仍保持热门序） */
const onSortByHeat = (): void => {
  draftOrder.value = [...draftOrder.value].sort(
    (a, b) => (props.heatValues[b] ?? 0) - (props.heatValues[a] ?? 0),
  );
};

/** 恢复默认（全部勾选 + 申万一级标准顺序 = 回到按热门口径自动排序） */
const onResetDefault = (): void => {
  draftOrder.value = [...BOARD_DEFAULT_ORDER];
  draftHidden.value = [];
};

/** 确认：回传草稿并关闭 */
const onConfirm = (): void => {
  emit('confirm', { order: [...draftOrder.value], hidden: [...draftHidden.value] });
  open.value = false;
};

/** 工具条小按钮样式 */
const TOOL_BTN_CLASS =
  'pressable rounded-lg border border-flat-weak px-2 py-1 text-xs text-text-secondary hover:bg-flat-weak hover:text-text active:scale-95';
</script>

<template>
  <BaseModal v-model:open="open" title="板块过滤器" max-width-class="max-w-md">
    <p class="mb-3 text-xs text-text-tertiary">
      勾选要在表格中显示的板块，拖拽手柄调整行序（拖拽后表格按此顺序渲染）；点击「确认」保存并记住。
    </p>

    <!-- 工具条 -->
    <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div class="flex items-center gap-1">
        <button type="button" :class="TOOL_BTN_CLASS" @click="onSelectAll">全选</button>
        <button type="button" :class="TOOL_BTN_CLASS" @click="onClearAll">全不选</button>
        <button type="button" :class="TOOL_BTN_CLASS" @click="onInvert">反选</button>
      </div>
      <span class="text-xs text-text-tertiary">已选 {{ checkedCount }} / {{ draftOrder.length }}</span>
      <div class="ml-auto flex items-center gap-1">
        <button type="button" :class="TOOL_BTN_CLASS" @click="onSortByHeat">
          按{{ heatLabel }}重排
        </button>
        <button type="button" :class="TOOL_BTN_CLASS" @click="onResetDefault">恢复默认</button>
      </div>
    </div>

    <!-- 列表表头（给右侧数值一个标签，避免只看到裸数字） -->
    <div class="mb-1 flex items-center justify-between px-2.5 text-[10px] text-text-tertiary">
      <span>拖拽手柄调整行序 · 勾选框控制是否显示</span>
      <span>{{ heatLabel }}</span>
    </div>

    <!-- 勾选 + 拖拽列表 -->
    <VueDraggable
      v-model="draftOrder"
      tag="ul"
      :animation="150"
      handle=".filter-handle"
      :force-fallback="true"
      fallback-class="sortable-fallback"
      ghost-class="opacity-40"
      chosen-class="bg-flat-weak"
      class="space-y-1"
    >
      <li
        v-for="code in draftOrder"
        :key="code"
        class="flex select-none items-center gap-2.5 rounded-lg border border-flat-weak px-2.5 py-1.5 text-sm"
      >
        <MenuIcon
          name="grip"
          :size="16"
          class="filter-handle shrink-0 cursor-grab text-text-tertiary active:cursor-grabbing"
        />
        <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
          <input
            :checked="!draftHidden.includes(code)"
            type="checkbox"
            class="h-4 w-4 shrink-0 cursor-pointer rounded border-flat-weak accent-primary"
            @change="onToggle(code, $event)"
          />
          <span
            class="truncate"
            :class="draftHidden.includes(code) ? 'text-text-tertiary line-through' : 'text-text'"
          >
            {{ boardByCode.get(code)?.name ?? code }}
          </span>
          <span class="shrink-0 text-[10px] text-text-tertiary">{{ code }}</span>
        </label>
        <span class="shrink-0 text-[10px] tabular-nums text-text-tertiary">
          {{ heatValues[code] ?? 0 }}
        </span>
      </li>
    </VueDraggable>

    <p v-if="checkedCount === 0" class="mt-3 text-xs text-down">
      未勾选任何板块，表格将显示为空。
    </p>

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
