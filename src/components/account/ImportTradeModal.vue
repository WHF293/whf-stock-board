<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { useStockAccountStore } from '../../stores/stock-account';
import {
  TRADE_IMPORT_ACCEPT,
  TRADE_IMPORT_MAX_SIZE,
} from '../../constants/account.constants';
import type { TradeImportPayload } from '../../types/account.types';

/**
 * 交割单导入弹窗
 *
 * 上半部分：目标账户选择（radio，默认选中父层当前激活账户）
 * 下半部分：文件上传（点击/拖拽，csv/xlsx/xls，大小上限见常量）
 *
 * 确认后 emit confirm 携带 { accountId, fileName, fileSize }；
 * 解析与入库字段待定（TODO 由父层 handler 预留）
 */
const props = defineProps<{
  /** 打开时默认选中的账户 id（通常为父层当前激活 tab） */
  defaultAccountId?: string;
}>();

const emit = defineEmits<{
  /** 确认导入（解析入库待实现） */
  confirm: [payload: TradeImportPayload];
}>();

const open = defineModel<boolean>('open', { required: true });

const accountStore = useStockAccountStore();

/** 已选账户 id */
const selectedAccountId = ref<string>('');

/** 已选文件（解析入库待定，仅透传文件信息） */
const pickedFile = ref<File | null>(null);

/** 拖拽悬停态（上传区高亮） */
const isDragOver = ref(false);

/** 文件校验错误文案 */
const fileError = ref('');

/** 隐藏的 file input 引用 */
const fileInputRef = ref<HTMLInputElement | null>(null);

/** 弹窗打开时重置选择 */
watch(open, (isOpen) => {
  if (isOpen) {
    selectedAccountId.value =
      props.defaultAccountId ?? accountStore.accounts[0]?.id ?? '';
    pickedFile.value = null;
    fileError.value = '';
    isDragOver.value = false;
  }
});

/** 文件大小格式化展示（MB，保留 1 位） */
const fileSizeText = computed(() => {
  if (!pickedFile.value) {
    return '';
  }
  return `${(pickedFile.value.size / 1024 / 1024).toFixed(1)} MB`;
});

/**
 * 校验并接受文件
 * @param file 待校验文件
 */
const acceptFile = (file: File | null | undefined): void => {
  fileError.value = '';
  if (!file) {
    return;
  }
  if (file.size > TRADE_IMPORT_MAX_SIZE) {
    fileError.value = '文件超过 10MB 上限';
    return;
  }
  pickedFile.value = file;
};

/**
 * input change 回调
 * @param event 输入事件
 */
const onFileChange = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  acceptFile(input.files?.[0]);
  // 允许重复选择同一文件
  input.value = '';
};

/**
 * 拖拽放下回调
 * @param event 拖拽事件
 */
const onDrop = (event: DragEvent): void => {
  isDragOver.value = false;
  acceptFile(event.dataTransfer?.files?.[0]);
};

/** 是否可确认：账户与文件均已选择 */
const canConfirm = computed(
  () => Boolean(selectedAccountId.value) && Boolean(pickedFile.value),
);

/** 确认导入：透传账户与文件信息（解析入库字段待定） */
const onConfirm = (): void => {
  if (!canConfirm.value || !pickedFile.value) {
    return;
  }
  emit('confirm', {
    accountId: selectedAccountId.value,
    fileName: pickedFile.value.name,
    fileSize: pickedFile.value.size,
  });
  open.value = false;
};
</script>

<template>
  <BaseModal v-model:open="open" title="导入交割单" max-width-class="max-w-lg">
    <div class="space-y-5">
      <!-- 上半部分：账户选择 -->
      <section class="space-y-2">
        <h4 class="text-sm font-medium text-text">选择账户</h4>
        <div
          v-if="accountStore.accounts.length > 0"
          class="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
          role="radiogroup"
          aria-label="目标账户"
        >
          <label
            v-for="account in accountStore.accounts"
            :key="account.id"
            class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
            :class="
              selectedAccountId === account.id
                ? 'border-primary bg-primary-weak text-primary'
                : 'border-flat-weak text-text-secondary hover:border-primary hover:text-text'
            "
          >
            <input
              v-model="selectedAccountId"
              type="radio"
              name="trade-import-account"
              :value="account.id"
              class="accent-primary"
            />
            <span class="truncate">{{ account.name }}</span>
          </label>
        </div>
        <p v-else class="rounded-lg bg-flat-weak px-3 py-4 text-center text-sm text-text-tertiary">
          还没有账户，请先点击「+ 添加」创建账户
        </p>
      </section>

      <!-- 下半部分：文件上传 -->
      <section class="space-y-2">
        <h4 class="text-sm font-medium text-text">选择交割单文件</h4>
        <div
          class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors"
          :class="
            isDragOver
              ? 'border-primary bg-primary-weak'
              : 'border-flat-weak hover:border-primary'
          "
          role="button"
          tabindex="0"
          aria-label="选择交割单文件"
          @click="fileInputRef?.click()"
          @keydown.enter="fileInputRef?.click()"
          @dragover.prevent="isDragOver = true"
          @dragleave.prevent="isDragOver = false"
          @drop.prevent="onDrop"
        >
          <MenuIcon name="tradeImport" :size="28" class="text-text-tertiary" />
          <template v-if="pickedFile">
            <p class="text-sm text-text">{{ pickedFile.name }}</p>
            <p class="text-xs text-text-tertiary">
              {{ fileSizeText }}，点击可重新选择
            </p>
          </template>
          <template v-else>
            <p class="text-sm text-text-secondary">
              点击选择或拖拽文件到此处
            </p>
            <p class="text-xs text-text-tertiary">
              支持 CSV / XLSX / XLS，不超过 10MB
            </p>
          </template>
        </div>
        <input
          ref="fileInputRef"
          type="file"
          :accept="TRADE_IMPORT_ACCEPT"
          class="hidden"
          @change="onFileChange"
        />
        <p v-if="fileError" class="text-xs text-up" role="alert">
          {{ fileError }}
        </p>
      </section>
    </div>
    <template #footer>
      <BaseButton variant="ghost" @click="open = false">取消</BaseButton>
      <BaseButton
        variant="primary"
        :disabled="!canConfirm"
        @click="onConfirm"
      >
        开始导入
      </BaseButton>
    </template>
  </BaseModal>
</template>
