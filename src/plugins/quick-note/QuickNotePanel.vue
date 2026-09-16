<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseEmpty from '../../components/ui/BaseEmpty.vue';
import MenuIcon from '../../components/ui/MenuIcon.vue';
import { formatRelativeTime } from '../../utils/format-relative-time';
import { usePluginPanelHost } from '../../plugin/panel-host';
import { QUICK_NOTE_MAX_LENGTH, type QuickNoteRepo } from './service';

/**
 * 速记面板（插件 dsh-quick-note 的 drawer 面板内容）
 *
 * 侧栏里只放入口按钮（drawer 形态），内容在右侧抽屉展开 —— 编辑类内容需要宽度，
 * 这也是 `mode: 'drawer'` 存在的意义。数据来自插件自己提供的 `note:repo` 服务，
 * 面板组件与数据源由插件内部绑定，宿主完全不参与。
 */
const props = defineProps<{
  /** 速记仓储（插件在 apply 里经 props 注入自己的服务实现） */
  repo: QuickNoteRepo;
}>();

/** 面板宿主上下文（drawer 形态下用于「保存并关闭」） */
const host = usePluginPanelHost();

/** 草稿正文 */
const draft = ref('');

/** 已保存的速记（新的在前；repo.list() 返回响应式数组，增删自动跟随） */
const notes = computed(() => props.repo.list());

/** 是否还有可删除的条目 */
const hasNotes = computed(() => notes.value.length > 0);

/** 保存当前草稿（空白内容不落库） */
const onSave = (): void => {
  if (!props.repo.create(draft.value)) return;
  draft.value = '';
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
            <span class="text-xs text-text-tertiary">
              {{ formatRelativeTime(note.createdAt) }}
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
  </div>
</template>
