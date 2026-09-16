<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useAgentStore } from '@/stores/agent';
import type { SubagentDef } from '@/types/agent.types';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';

/**
 * Subagent 编辑弹窗（新建 / 编辑共用）
 *
 * 两种输入形式：
 * - 填空输入：调用名 / 何时使用描述 / system prompt / 独立模型逐项填写；
 * - 纯文本输入：粘贴完整描述词文档（markdown），自动从中抽取「何时使用」描述
 *   （首个「角色」段落中「」内的职责概括），正文整篇作为 system prompt。
 */
const store = useAgentStore();

const open = defineModel<boolean>('open', { required: true });

/** 编辑目标（null = 新建） */
const target = defineModel<SubagentDef | null>('target', { default: null });

/** 输入形式：form 填空 / text 纯文本 */
const mode = ref<'form' | 'text'>('form');

const form = reactive({
  name: '',
  description: '',
  prompt: '',
  modelId: null as number | null,
});
const formError = ref('');

/** 纯文本模式：调用名 + 完整描述词文本 */
const plain = reactive({ name: '', text: '' });
/** 从文本抽取出的描述（预览给用户） */
const derivedDescription = ref('');

/**
 * 从描述词文本抽取「何时使用」描述：取首个「」内的角色概括，
 * 加上前后文补充为一句派发描述；抽不到时退回首行非标题文本。
 * @param text 描述词全文
 * @returns 描述；无法抽取返回空串
 */
const extractDescription = (text: string): string => {
  const quoted = /「([^」]+)」/.exec(text);
  if (quoted) return quoted[1].trim() + '：按文档约定执行';
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line.length > 0);
  return firstLine ? firstLine.slice(0, 60) : '';
};

watch(
  plain,
  () => {
    derivedDescription.value = plain.text.trim() ? extractDescription(plain.text) : '';
  },
  { flush: 'post' },
);

watch(open, (isOpen) => {
  if (isOpen) {
    form.name = target.value?.name ?? '';
    form.description = target.value?.description ?? '';
    form.prompt = target.value?.prompt ?? '';
    form.modelId = target.value?.modelId ?? null;
    plain.name = target.value?.name ?? '';
    plain.text = target.value?.prompt ?? '';
    derivedDescription.value = '';
    formError.value = '';
    // 编辑已有 subagent 时：有完整字段的用填空模式；只贴文本的新建默认纯文本
    mode.value = 'form';
  }
});

/** 保存 */
const save = (): void => {
  if (mode.value === 'text') {
    const name = plain.name.trim();
    if (!name) {
      formError.value = '调用名不能为空';
      return;
    }
    if (!plain.text.trim()) {
      formError.value = '描述词文本不能为空';
      return;
    }
    const description = derivedDescription.value || '（粘贴导入的 subagent）';
    void store.upsertSubagent({
      id: target.value?.id,
      name,
      description,
      prompt: plain.text.trim(),
      modelId: form.modelId,
      toolNames: target.value?.toolNames ?? [],
      // skill 的「哪些 agent 能用」由资源侧设置弹窗经 resource_grant 决定，
      // 这里只保留声明的 skillNames（授权是它的子集，见 agent/run-context.ts）
      skillNames: target.value?.skillNames ?? [],
      // 新建默认启用；编辑时沿用现状（启停以列表开关为主，这里只是不丢失）
      enabled: target.value?.enabled ?? true,
    });
    open.value = false;
    return;
  }
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
    skillNames: target.value?.skillNames ?? [],
    enabled: target.value?.enabled ?? true,
  });
  open.value = false;
};
</script>

<template>
  <BaseModal v-model:open="open" :title="target ? '编辑 Subagent' : '新建 Subagent'" max-width-class="max-w-lg">
    <div class="space-y-4">
      <!-- 输入形式切换 -->
      <div class="flex gap-1.5">
        <button
          v-for="m in [
            { key: 'form', label: '填空输入' },
            { key: 'text', label: '纯文本输入' },
          ]"
          :key="m.key"
          type="button"
          class="rounded-full border px-3 py-1 text-xs transition-colors"
          :class="
            mode === m.key
              ? 'border-primary bg-primary-weak text-primary'
              : 'border-flat-weak text-text-secondary hover:border-primary'
          "
          @click="mode = m.key as 'form' | 'text'"
        >
          {{ m.label }}
        </button>
      </div>

      <!-- 填空输入 -->
      <template v-if="mode === 'form'">
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
      </template>

      <!-- 纯文本输入：粘贴完整描述词 -->
      <template v-else>
        <div>
          <p class="mb-1.5 text-sm text-text-secondary">调用名（蛇形，主 agent 经 task 工具按名派发）</p>
          <input
            v-model="plain.name"
            type="text"
            placeholder="stock_research_analyst"
            class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 font-mono text-sm text-text outline-none focus:border-primary"
          />
        </div>
        <div>
          <p class="mb-1.5 text-sm text-text-secondary">描述词全文（整篇作为 System Prompt）</p>
          <textarea
            v-model="plain.text"
            rows="12"
            placeholder="# 角色&#10;你是一名「xxx Agent」，负责……&#10;&#10;# 工作流程&#10;……"
            class="w-full resize-y rounded-lg border border-flat-weak bg-transparent px-3 py-2 font-mono text-xs text-text outline-none focus:border-primary"
          />
        </div>
        <p v-if="derivedDescription" class="text-xs text-text-tertiary">
          自动抽取的「何时使用」描述：{{ derivedDescription }}
        </p>
      </template>

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
