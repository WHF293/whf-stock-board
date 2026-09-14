<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseInput from '../ui/BaseInput.vue';
import BaseModal from '../ui/BaseModal.vue';
import { useStockAccountStore } from '../../stores/stock-account';

/**
 * 创建手工账户弹窗
 *
 * 名称必填且去重（忽略大小写）；确认后创建并 emit created（父层切换到新 tab）
 */
const props = defineProps<{
  /** 打开时预填的名称（预留编辑复用，可选） */
  initialName?: string;
}>();

const emit = defineEmits<{
  /** 创建成功（携带新账户 id） */
  created: [accountId: string];
}>();

const open = defineModel<boolean>('open', { required: true });

const accountStore = useStockAccountStore();

/** 表单字段 */
const name = ref('');
const note = ref('');

/** 校验错误文案（空 = 无错误） */
const nameError = ref('');

/** 弹窗打开时重置表单 */
watch(open, (isOpen) => {
  if (isOpen) {
    name.value = props.initialName ?? '';
    note.value = '';
    nameError.value = '';
  }
});

/** 提交创建：校验通过后落 store 并关闭 */
const onConfirm = (): void => {
  const trimmed = name.value.trim();
  if (!trimmed) {
    nameError.value = '请输入账户名称';
    return;
  }
  if (accountStore.nameExists(trimmed)) {
    nameError.value = '账户名称已存在';
    return;
  }
  const account = accountStore.addAccount(trimmed, note.value);
  open.value = false;
  emit('created', account.id);
};
</script>

<template>
  <BaseModal v-model:open="open" title="创建手工账户" max-width-class="max-w-md">
    <form class="space-y-4" @submit.prevent="onConfirm">
      <div class="space-y-1.5">
        <label class="text-sm text-text-secondary" for="account-name-input">
          账户名称<span class="ml-0.5 text-primary">*</span>
        </label>
        <BaseInput
          id="account-name-input"
          v-model="name"
          placeholder="例如：主账户 / 打新户"
        />
        <p v-if="nameError" class="text-xs text-up" role="alert">
          {{ nameError }}
        </p>
      </div>
      <div class="space-y-1.5">
        <label class="text-sm text-text-secondary" for="account-note-input">
          备注
        </label>
        <BaseInput
          id="account-note-input"
          v-model="note"
          placeholder="可选，如券商 / 用途"
        />
      </div>
      <!-- 隐藏提交入口：支持回车提交 -->
      <button type="submit" class="hidden" aria-hidden="true"></button>
    </form>
    <template #footer>
      <BaseButton variant="ghost" @click="open = false">取消</BaseButton>
      <BaseButton variant="primary" @click="onConfirm">创建</BaseButton>
    </template>
  </BaseModal>
</template>
