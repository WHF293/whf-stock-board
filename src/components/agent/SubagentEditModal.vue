<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useAgentStore } from '@/stores/agent';
import type { SubagentDef } from '@/types/agent.types';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';

/**
 * Subagent 编辑弹窗（新建 / 编辑共用）
 *
 * 字段：调用名（蛇形，主 agent 经 task 工具按 name 派发）、
 * 何时使用描述、system prompt、可选独立模型（空 = 继承主 agent）。
 */
const store = useAgentStore();

const open = defineModel<boolean>('open', { required: true });

/** 编辑目标（null = 新建） */
const target = defineModel<SubagentDef | null>('target', { default: null });

const form = reactive({
  name: '',
  description: '',
  prompt: '',
  modelId: null as number | null,
});
const formError = ref('');

watch(open, (isOpen) => {
  if (isOpen) {
    form.name = target.value?.name ?? '';
    form.description = target.value?.description ?? '';
    form.prompt = target.value?.prompt ?? '';
    form.modelId = target.value?.modelId ?? null;
    formError.value = '';
  }
});

/** 保存 */
const save = (): void => {
  const name = form.name.trim();
  if (!name) {
    formError.value = '调用名不能为空';
    return;
  }
  if (!form.description.trim()) {
    formError.value = '「何时使用」描述不能为空';
    return;
  }
  void store.upsertSubagent({
    id: target.value?.id,
    name,
    description: form.description.trim(),
    prompt: form.prompt.trim(),
    modelId: form.modelId,
    toolNames: target.value?.toolNames ?? [],
  });
  open.value = false;
};
</script>

<template>
  <BaseModal v-model:open="open" :title="target ? '编辑 Subagent' : '新建 Subagent'" max-width-class="max-w-lg">
    <div class="space-y-4">
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">调用名（蛇形，如 kline_analyst）</p>
        <input
          v-model="form.name"
          type="text"
          placeholder="kline_analyst"
          class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
      </div>
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">何时使用（主 agent 据此决定派发）</p>
        <input
          v-model="form.description"
          type="text"
          placeholder="例如：当需要深入分析个股 K 线与技术指标时使用"
          class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
      </div>
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">System Prompt</p>
        <textarea
          v-model="form.prompt"
          rows="5"
          placeholder="子 agent 的系统提示词（隔离上下文中运行）"
          class="w-full resize-y rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
      </div>
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">独立模型（可选，空 = 继承主 agent）</p>
        <select
          v-model="form.modelId"
          class="w-full rounded-lg border border-flat-weak bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
        >
          <option :value="null">继承主 agent 模型</option>
          <option v-for="model in store.models" :key="model.id" :value="model.id">
            {{ model.name }}
          </option>
        </select>
      </div>
      <p v-if="formError" class="text-xs text-up">{{ formError }}</p>
    </div>
    <template #footer>
      <BaseButton variant="ghost" @click="open = false">取消</BaseButton>
      <BaseButton variant="primary" @click="save">保存</BaseButton>
    </template>
  </BaseModal>
</template>
