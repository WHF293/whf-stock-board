<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import MenuIcon from "../ui/MenuIcon.vue";
import { useStockSearch } from '../../composables/use-stock-search';
import type { SearchResult } from '../../types/stock-quote.types';

/**
 * 标的搜索弹窗（Vue 官网 DocSearch 风格）：
 * 居中大输入框 + 结果列表，↑/↓ 键切换选中项，Enter 确认，Esc 关闭；
 * 点击遮罩关闭；打开时自动聚焦输入框
 */
const props = defineProps<{
  /** 弹窗显隐 */
  open: boolean;
}>();

const emit = defineEmits<{
  /** 关闭弹窗（遮罩 / × / Esc） */
  close: [];
  /** 选中某个搜索结果 */
  select: [result: SearchResult, results: SearchResult[]];
}>();

const { keyword, results, searching } = useStockSearch();

/** 输入框引用（打开时自动聚焦） */
const inputRef = ref<HTMLInputElement | null>(null);

/** 当前键盘选中的结果下标 */
const activeIndex = ref(0);

// 打开时聚焦并重置；关闭时清空搜索状态
watch(
  () => props.open,
  (open) => {
    if (open) {
      activeIndex.value = 0;
      nextTick(() => inputRef.value?.focus());
    } else {
      keyword.value = '';
      results.value = [];
    }
  },
);

// 结果变化时选中项回到首位
watch(results, () => {
  activeIndex.value = 0;
});

/**
 * 移动键盘选中项（循环）
 * @param delta 步进（+1 下移 / -1 上移）
 */
const moveActive = (delta: number): void => {
  const total = results.value.length;
  if (total === 0) return;
  activeIndex.value = (activeIndex.value + delta + total) % total;
};

/**
 * 确认选中当前项
 * @param result 搜索结果
 */
const select = (result: SearchResult): void => {
  emit('select', result, results.value);
  emit('close');
};

/**
 * 输入框键盘处理：↑/↓ 切换、Enter 确认、Esc 关闭（阻止冒泡，
 * 避免触发 DockPanel 的 Esc 关闭面板逻辑）
 * @param event 键盘事件
 */
const onInputKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveActive(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveActive(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const result = results.value[activeIndex.value];
    if (result) {
      select(result);
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('close');
  }
};
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩：点击关闭 -->
    <div
      v-if="open"
      class="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"
      @click="emit('close')"
    >
      <!-- 弹窗卡片（阻止冒泡） -->
      <div
        class="mx-auto mt-[10vh] w-[min(92vw,560px)] overflow-hidden rounded-2xl bg-surface shadow-2xl"
        @click.stop
      >
        <!-- 输入区 -->
        <div class="flex items-center gap-3 border-b border-flat-weak px-4 py-3">
          <MenuIcon
            name="search"
            :size="18"
            class="shrink-0 text-text-tertiary"
          />
          <input
            ref="inputRef"
            v-model="keyword"
            type="text"
            placeholder="搜索代码 / 名称 / 拼音"
            class="h-8 flex-1 bg-transparent text-base text-text outline-none placeholder:text-text-tertiary"
            @keydown="onInputKeydown"
          />
          <button
            type="button"
            class="pressable rounded-md p-1 text-text-tertiary hover:bg-flat-weak hover:text-text"
            aria-label="关闭搜索"
            @click="emit('close')"
          >
            <MenuIcon name="close" :size="16" />
          </button>
        </div>

        <!-- 结果列表 -->
        <ul class="max-h-[50vh] space-y-1 overflow-auto p-2">
          <li
            v-if="keyword.trim().length > 0 && searching"
            class="px-3 py-2 text-xs text-text-tertiary"
          >
            搜索中...
          </li>
          <li
            v-else-if="results.length === 0"
            class="px-3 py-6 text-center text-xs text-text-tertiary"
          >
            {{ keyword.trim().length > 0 ? '未找到匹配标的' : '输入代码 / 名称 / 拼音开始搜索' }}
          </li>
          <li v-for="(result, index) in results" v-else :key="result.code">
            <button
              type="button"
              class="w-full rounded-xl px-3 py-2.5 text-left transition-colors"
              :class="
                index === activeIndex
                  ? 'bg-primary-weak ring-1 ring-primary'
                  : 'hover:bg-flat-weak'
              "
              @mouseenter="activeIndex = index"
              @click="select(result)"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium text-text">{{ result.name }}</span>
                <MenuIcon
                  v-if="index === activeIndex"
                  name="arrowLeft"
                  :size="14"
                  class="shrink-0 rotate-180 text-primary"
                />
              </div>
              <p class="mt-0.5 text-xs text-text-tertiary">{{ result.code }}</p>
            </button>
          </li>
        </ul>

        <!-- 底部快捷键提示 -->
        <div class="flex items-center gap-4 border-t border-flat-weak px-4 py-2 text-xs text-text-tertiary">
          <span>↑ ↓ 切换</span>
          <span>Enter 选择</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
