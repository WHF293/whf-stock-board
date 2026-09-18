<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseEmpty from '../../components/ui/BaseEmpty.vue';
import MenuIcon from '../../components/ui/MenuIcon.vue';
import StockSearchModal from '../../components/business/StockSearchModal.vue';
import { formatRelativeTime } from '../../utils/format-relative-time';
import { toBareCode } from '../../utils/to-bare-code';
import { usePluginPanelHost } from '../../plugin/panel-host';
import { useDockPanelStore } from '../../stores/dock-panel';
import type { SearchResult } from '../../types/stock-quote.types';
import {
  QUICK_NOTE_ASSOCIATE_BUTTON,
  QUICK_NOTE_ASSOCIATE_CLEAR_ARIA,
  QUICK_NOTE_ASSOCIATED_TITLE,
} from './constants';
import { QUICK_NOTE_MAX_LENGTH, type NoteStockRef, type QuickNoteRepo } from './service';

/**
 * 速记面板（插件 dsh-quick-note 的 drawer 面板内容）
 *
 * 侧栏里只放入口按钮（drawer 形态），内容在右侧抽屉展开 —— 编辑类内容需要宽度，
 * 这也是 `mode: 'drawer'` 存在的意义。数据来自插件自己提供的 `note:repo` 服务，
 * 面板组件与数据源由插件内部绑定，宿主完全不参与。
 *
 * v1.1.0：保存时可关联一只股票 —— 打开全站统一的标的搜索弹窗（顶栏搜索同款）挑一只，
 * 关联后的速记会出现在该股的个股详情面板（扩展区）里。
 */
const props = defineProps<{
  /** 速记仓储（插件在 apply 里经 props 注入自己的服务实现） */
  repo: QuickNoteRepo;
}>();

const dockPanel = useDockPanelStore();

/** 面板宿主上下文（drawer 形态下用于「保存并关闭」） */
const host = usePluginPanelHost();

/** 草稿正文 */
const draft = ref('');

/** 已保存的速记（新的在前；repo.list() 返回响应式数组，增删自动跟随） */
const notes = computed(() => props.repo.list());

/** 是否还有可删除的条目 */
const hasNotes = computed(() => notes.value.length > 0);

// ---------- 股票关联选择器 ----------
/** 关联弹窗是否展开（复用全站统一的标的搜索弹窗，样式与顶栏搜索一致） */
const associateModalOpen = ref(false);

/** 当前选中的关联股票（null = 不关联） */
const pickedStock = ref<NoteStockRef | null>(null);

/**
 * 在搜索弹窗里确认一只股票作为关联（并收起弹窗）
 * @param result 搜索结果
 */
const onPickStock = (result: SearchResult): void => {
  pickedStock.value = { symbol: result.code, name: result.name };
  associateModalOpen.value = false;
};

/** 清除当前关联 */
const onClearPicked = (): void => {
  pickedStock.value = null;
};

/** 保存当前草稿（空白内容不落库；关联随笔记一并写入） */
const onSave = (): void => {
  if (!props.repo.create(draft.value, pickedStock.value ?? undefined)) return;
  draft.value = '';
  pickedStock.value = null;
};

/** 保存并关闭抽屉（drawer 形态下的快捷动作） */
const onSaveAndClose = (): void => {
  onSave();
  host?.close();
};

/**
 * 删除一条速记
 * @param id 速记 id
 */
const onRemove = (id: string): void => {
  props.repo.remove(id);
};

/**
 * 点速记上的关联标签：打开该股的个股详情（停靠面板）
 * @param symbol 完整符号
 */
const onOpenStock = (symbol: string): void => {
  dockPanel.openStock(symbol);
};

/**
 * 编辑区内快捷键：Ctrl/Cmd + Enter 保存
 * @param event 键盘事件
 */
const onKeydown = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    onSave();
  }
};
</script>

<template>
  <div class="space-y-4">
    <div>
      <textarea
        v-model="draft"
        :maxlength="QUICK_NOTE_MAX_LENGTH"
        rows="5"
        placeholder="记点什么…（Ctrl + Enter 保存）"
        class="w-full resize-y rounded-card border border-flat-weak bg-surface px-3 py-2 text-sm text-text placeholder:text-text-tertiary focus:border-primary focus:outline-none"
        @keydown="onKeydown"
      />

      <!-- 股票关联：打开全站统一的标的搜索弹窗（与顶栏搜索同一组件，含「上次搜索」） -->
      <div class="mt-2">
        <div v-if="pickedStock" class="flex items-center gap-2">
          <button
            type="button"
            class="pressable flex items-center gap-1.5 rounded-full bg-primary-weak px-2.5 py-1 text-xs text-primary active:scale-95"
            :title="QUICK_NOTE_ASSOCIATED_TITLE"
            @click="associateModalOpen = true"
          >
            <MenuIcon name="pencil" :size="12" />
            <span class="max-w-[180px] truncate">
              {{ pickedStock.name }} {{ toBareCode(pickedStock.symbol) }}
            </span>
          </button>
          <button
            type="button"
            class="pressable rounded p-0.5 text-text-tertiary hover:text-text active:scale-90"
            :aria-label="QUICK_NOTE_ASSOCIATE_CLEAR_ARIA"
            @click="onClearPicked"
          >
            <MenuIcon name="close" :size="12" />
          </button>
        </div>
        <button
          v-else
          type="button"
          class="pressable flex items-center gap-1.5 rounded-full border border-flat-weak px-2.5 py-1 text-xs text-text-tertiary hover:border-primary hover:text-primary active:scale-95"
          @click="associateModalOpen = true"
        >
          <MenuIcon name="plus" :size="12" />
          {{ QUICK_NOTE_ASSOCIATE_BUTTON }}
        </button>
      </div>

      <div class="mt-2 flex items-center justify-between gap-3">
        <span class="text-xs text-text-tertiary">
          {{ draft.length }} / {{ QUICK_NOTE_MAX_LENGTH }}
        </span>
        <div class="flex items-center gap-2">
          <BaseButton
            v-if="host?.mode === 'drawer'"
            variant="ghost"
            :disabled="draft.trim().length === 0"
            @click="onSaveAndClose"
          >
            保存并关闭
          </BaseButton>
          <BaseButton
            :disabled="draft.trim().length === 0"
            @click="onSave"
          >
            保存
          </BaseButton>
        </div>
      </div>
    </div>

    <div class="border-t border-flat-weak pt-3">
      <p class="mb-2 text-xs font-medium text-text-secondary">已保存（{{ notes.length }}）</p>
      <BaseEmpty v-if="!hasNotes" text="还没有速记" />
      <ul v-else class="space-y-2">
        <li
          v-for="note in notes"
          :key="note.id"
          class="group rounded-card border border-flat-weak px-3 py-2"
        >
          <p class="whitespace-pre-wrap break-words text-sm text-text">{{ note.text }}</p>
          <div class="mt-1 flex items-center justify-between gap-2">
            <span class="flex min-w-0 items-center gap-2">
              <span class="text-xs text-text-tertiary">
                {{ formatRelativeTime(note.createdAt) }}
              </span>
              <!-- 关联标签：点了直达该股详情（停靠面板） -->
              <button
                v-if="note.symbol"
                type="button"
                class="pressable min-w-0 rounded-full bg-flat-weak px-2 py-0.5 text-xs text-text-secondary hover:text-primary active:scale-95"
                :title="`打开 ${note.stockName || note.symbol} 详情`"
                @click="onOpenStock(note.symbol)"
              >
                <span class="max-w-[140px] truncate">
                  {{ note.stockName || toBareCode(note.symbol) }}
                </span>
              </button>
            </span>
            <button
              type="button"
              class="pressable rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:bg-flat-weak hover:text-text group-hover:opacity-100 active:scale-90"
              aria-label="删除这条速记"
              @click="onRemove(note.id)"
            >
              <MenuIcon name="trash" :size="12" />
            </button>
          </div>
        </li>
      </ul>
    </div>

    <!-- 关联股票搜索弹窗（全站统一组件，确认后落为 pickedStock） -->
    <StockSearchModal
      :open="associateModalOpen"
      @close="associateModalOpen = false"
      @select="onPickStock"
    />
  </div>
</template>
