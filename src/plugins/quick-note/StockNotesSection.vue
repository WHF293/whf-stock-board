<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseEmpty from '../../components/ui/BaseEmpty.vue';
import MenuIcon from '../../components/ui/MenuIcon.vue';
import { formatRelativeTime } from '../../utils/format-relative-time';
import { useWatchlistStore } from '../../stores/watchlist';
import { useDataCacheStore } from '../../stores/data-cache';
import { DATA_CACHE_KEY } from '../../constants/data-cache.constants';
import {
  QUICK_NOTE_MAX_LENGTH,
  type NoteStockRef,
  type QuickNote,
  type QuickNoteRepo,
} from './service';
import type { FullQuote } from '../../types/stock-quote.types';
import {
  QUICK_NOTE_REMOVE_ARIA,
  QUICK_NOTE_SECTION_EMPTY,
  QUICK_NOTE_SECTION_PLACEHOLDER,
  QUICK_NOTE_SECTION_SAVE,
} from './constants';

/**
 * 个股详情扩展区 · 该股的速记（插件 dsh-quick-note 贡献）
 *
 * 经内核的「个股详情扩展区」贡献点挂到右侧个股详情面板底部，
 * 宿主只传当前股票符号；本组件消费插件自己的 note:repo，
 * 展示关联了这只股票的速记，并支持就地追加（自动带上关联）。
 */
const props = defineProps<{
  /** 当前股票符号（宿主已归一化为完整形态，如 sh600519） */
  symbol: string;
  /** 速记仓储（插件在注册扩展区时经 props 注入自己的服务实现） */
  repo: QuickNoteRepo;
}>();

/** 就地输入的草稿 */
const draft = ref('');

const watchlistStore = useWatchlistStore();
const dataCache = useDataCacheStore();

/** 关联股票名：自选股记录 → 详情报价缓存 → 符号兜底（存进库供速记面板展示） */
const stockName = computed<string>(() => {
  for (const group of watchlistStore.groups) {
    const found = group.stocks.find((stock) => stock.symbol === props.symbol);
    if (found) return found.name;
  }
  const quote = dataCache.get<FullQuote>(DATA_CACHE_KEY.DETAIL_QUOTE_PREFIX + props.symbol);
  return quote?.name || props.symbol;
});

/** 关联了当前股票的速记（新的在前，响应式） */
const notes = computed<readonly QuickNote[]>(() => props.repo.listBySymbol(props.symbol));

/** 保存草稿：自动关联当前股票 */
const onSave = (): void => {
  const stock: NoteStockRef = { symbol: props.symbol, name: stockName.value };
  if (!props.repo.create(draft.value, stock)) return;
  draft.value = '';
};

/**
 * 编辑区快捷键：Ctrl/Cmd + Enter 保存
 * @param event 键盘事件
 */
const onKeydown = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    onSave();
  }
};

/**
 * 删除一条速记
 * @param id 速记 id
 */
const onRemove = (id: string): void => {
  props.repo.remove(id);
};
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-end gap-2">
      <textarea
        v-model="draft"
        :maxlength="QUICK_NOTE_MAX_LENGTH"
        rows="2"
        :placeholder="QUICK_NOTE_SECTION_PLACEHOLDER"
        class="w-full resize-y rounded-card border border-flat-weak bg-surface px-2.5 py-2 text-sm text-text placeholder:text-text-tertiary focus:border-primary focus:outline-none"
        @keydown="onKeydown"
      />
      <BaseButton variant="primary" :disabled="draft.trim().length === 0" @click="onSave">
        {{ QUICK_NOTE_SECTION_SAVE }}
      </BaseButton>
    </div>

    <BaseEmpty v-if="notes.length === 0" :text="QUICK_NOTE_SECTION_EMPTY" />
    <ul v-else class="space-y-2">
      <li
        v-for="note in notes"
        :key="note.id"
        class="group rounded-card border border-flat-weak px-3 py-2"
      >
        <p class="whitespace-pre-wrap break-words text-sm text-text">{{ note.text }}</p>
        <div class="mt-1 flex items-center justify-between gap-2">
          <span class="text-xs text-text-tertiary">
            {{ formatRelativeTime(note.createdAt) }}
          </span>
          <button
            type="button"
            class="pressable rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:bg-flat-weak hover:text-text group-hover:opacity-100 active:scale-90"
            :aria-label="QUICK_NOTE_REMOVE_ARIA"
            @click="onRemove(note.id)"
          >
            <MenuIcon name="trash" :size="12" />
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
