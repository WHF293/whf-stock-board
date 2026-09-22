<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import { fetchFullQuotes } from '../../api/quotes.api';
import {
  BATCH_ADD_FAILED_TEXT,
  BATCH_ADD_MAX_COUNT,
} from '../../constants/watchlist.constants';
import { handleSdkError } from '../../utils/handle-sdk-error';
import { matchBatchQuotes } from '../../utils/match-batch-quotes';
import { parseBatchSymbols } from '../../utils/parse-batch-symbols';
import type { BatchAddResolveResult } from '../../types/watchlist.types';

/**
 * 批量添加自选股弹窗：粘贴一串代码（逗号 / 顿号 / 空格 / 换行分隔）批量加入目标分组
 *
 * 流程：本地解析（切分 + 形态校验，零请求）→ 请求上游确认代码是否存在 → 回传
 * 「可入库项 + 查不到的原始输入」。**落库与浮窗提示都由宿主负责**，本组件不碰 store
 * （与 `WatchlistGroupEditModal.vue` 的纯受控约定一致）。
 *
 * ⚠️ 上游对不存在的代码是静默丢弃（不是报错），所以「查不到」只能靠返回条数比对得出，
 * 见 `utils/match-batch-quotes.ts` 的说明。
 */
// 目标分组名只在模板里用（正文点名，避免用户加错分组），脚本内不需要 props 变量
defineProps<{
  /** 目标分组名称 */
  groupName: string;
}>();

const open = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{
  /** 校验完成（本组件已自关闭）：items 可入库、missing 为查不到的原始输入 */
  confirm: [payload: BatchAddResolveResult];
}>();

/** 输入框内容 */
const inputText = ref('');

/** 校验请求进行中（禁用提交防连点） */
const checking = ref(false);

/** 校验失败文案（失败时不关弹窗，用户可直接重试） */
const failedText = ref('');

/** 本地解析结果（只做文本切分与形态校验，不请求上游） */
const parsed = computed(() => parseBatchSymbols(inputText.value));

/** 识别到的代码个数（含形态非法的，用于超限判断） */
const recognizedCount = computed(() => parsed.value.valid.length + parsed.value.invalid.length);

/** 是否超出单次上限 */
const overLimit = computed(() => recognizedCount.value > BATCH_ADD_MAX_COUNT);

/** 能否提交：至少一个形态合法的代码、未超限、且不在请求中 */
const canSubmit = computed(
  () => parsed.value.valid.length > 0 && !overLimit.value && !checking.value,
);

// 打开时清空上一轮输入与报错（关闭时不清，避免误点遮罩后要重打一遍）
watch(open, (isOpen) => {
  if (isOpen) {
    inputText.value = '';
    failedText.value = '';
  }
});

/** 提交：请求上游确认存在性后回传结果（形态非法的代码直接算「查不到」，一并提示） */
const onSubmit = async (): Promise<void> => {
  if (!canSubmit.value) {
    return;
  }
  checking.value = true;
  failedText.value = '';
  try {
    const quotes = await fetchFullQuotes(parsed.value.valid.map((item) => item.symbol));
    const result = matchBatchQuotes(parsed.value.valid, quotes);
    emit('confirm', {
      items: result.items,
      missing: [...result.missing, ...parsed.value.invalid],
    });
    open.value = false;
  } catch (error) {
    console.error('[WatchlistBatchAddModal]', handleSdkError(error));
    failedText.value = BATCH_ADD_FAILED_TEXT;
  } finally {
    checking.value = false;
  }
};
</script>

<template>
  <BaseModal v-model:open="open" title="批量添加股票" max-width-class="max-w-lg">
    <div class="space-y-3">
      <p class="text-xs text-text-tertiary">
        粘贴股票代码，用逗号分隔（中英文逗号、顿号、空格、换行都可以），例如
        300033，300034, 300035
      </p>
      <textarea
        v-model="inputText"
        rows="6"
        aria-label="批量添加股票代码"
        placeholder="300033，300034，300035"
        class="w-full resize-y rounded-lg bg-flat-weak px-3 py-2 font-mono text-sm text-text outline-none transition-colors placeholder:text-text-tertiary focus:ring-1 focus:ring-primary"
      />
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span class="text-text-secondary">已识别 {{ recognizedCount }} 个代码</span>
        <span v-if="parsed.invalid.length > 0" class="text-up">
          {{ parsed.invalid.length }} 个格式无效
        </span>
        <span v-if="overLimit" class="text-up">
          单次最多 {{ BATCH_ADD_MAX_COUNT }} 个，请分批添加
        </span>
        <span v-if="failedText" class="text-up">{{ failedText }}</span>
      </div>
      <p class="text-xs text-text-tertiary">
        加入分组「{{ groupName }}」；查不到的代码会自动跳过并逐一提示
      </p>
    </div>
    <template #footer>
      <BaseButton variant="ghost" @click="open = false">取消</BaseButton>
      <BaseButton :disabled="!canSubmit" @click="onSubmit">
        {{ checking ? '查询中...' : '添加' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
