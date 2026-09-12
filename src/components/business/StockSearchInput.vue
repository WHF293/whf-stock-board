<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseInput from '../ui/BaseInput.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { useStockSearch } from '../../composables/use-stock-search';
import { SEARCH_MIN_KEYWORD_LENGTH } from '../../constants/search.constants';
import type { SearchResult } from '../../types/stock-quote.types';

/**
 * 标的搜索输入框：防抖搜索 + 下拉建议，选中后 emit select 并清空
 */
const props = withDefaults(
  defineProps<{
    /** 挂载后自动聚焦（头部搜索面板展开时使用） */
    autoFocus?: boolean;
  }>(),
  { autoFocus: false },
);

const emit = defineEmits<{
  /** 选中某个搜索结果 */
  select: [result: SearchResult];
}>();

const { keyword, results, searching } = useStockSearch();

/** 输入框引用（自动聚焦用；BaseInput 根元素即 input） */
const inputRef = ref<{ $el: HTMLInputElement } | null>(null);

onMounted(() => {
  if (props.autoFocus) {
    inputRef.value?.$el?.focus();
  }
});

/** 是否聚焦（focusin/focusout 控制下拉显隐） */
const isFocused = ref(false);

/** 下拉是否可见：聚焦 + 关键词达标 + 有结果或请求中 */
const showDropdown = computed(
  () =>
    isFocused.value &&
    keyword.value.trim().length >= SEARCH_MIN_KEYWORD_LENGTH &&
    (results.value.length > 0 || searching.value),
);

/**
 * 选中某个结果：上报并重置搜索状态
 * @param result 搜索结果
 */
const onSelect = (result: SearchResult): void => {
  emit('select', result);
  keyword.value = '';
  results.value = [];
  isFocused.value = false;
};

defineExpose({
  /** 清空搜索状态（外部关闭面板时调用） */
  reset: (): void => {
    keyword.value = '';
    results.value = [];
    isFocused.value = false;
  },
});
</script>

<template>
  <div class="relative" @focusin="isFocused = true" @focusout="isFocused = false">
    <div class="relative">
      <MenuIcon
        name="search"
        :size="14"
        class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
      />
      <BaseInput ref="inputRef" v-model="keyword" placeholder="搜索代码 / 名称 / 拼音" class="pl-8" />
    </div>
    <ul
      v-if="showDropdown"
      class="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-card bg-surface py-1 shadow-card"
    >
      <li v-if="searching" class="px-3 py-2 text-xs text-text-tertiary">搜索中...</li>
      <li v-for="result in results" v-else :key="result.code">
        <button
          type="button"
          class="pressable flex w-full items-baseline gap-2 px-3 py-2 text-left active:scale-[0.98]"
          @mousedown.prevent="onSelect(result)"
        >
          <span class="text-sm text-text">{{ result.name }}</span>
          <span class="text-xs text-text-tertiary">{{ result.code }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
