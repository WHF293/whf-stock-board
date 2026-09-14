<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useAgentStore } from '@/stores/agent';
import type { McpTransport } from '@/types/agent.types';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseSwitch from '@/components/ui/BaseSwitch.vue';
import BaseConfirmModal from '@/components/ui/BaseConfirmModal.vue';
import MenuIcon from '@/components/ui/MenuIcon.vue';

/**
 * MCP 服务器管理弹窗（一期仅 streamable HTTP / SSE 远端传输）
 *
 * - 列表：启用开关 + 删除；
 * - 添加：名称 / 传输方式 / URL / 请求头（JSON，可选）；连接测试与工具列举在 M4 接入。
 */
const store = useAgentStore();

const open = defineModel<boolean>('open', { required: true });

/** 添加表单显隐 */
const addOpen = ref(false);
const form = reactive({
  name: '',
  transport: 'streamable-http' as McpTransport,
  url: '',
  headersText: '',
});
const formError = ref('');

/** 打开添加表单 */
const openAdd = (): void => {
  form.name = '';
  form.transport = 'streamable-http';
  form.url = '';
  form.headersText = '';
  formError.value = '';
  addOpen.value = true;
};

/** 提交添加 */
const submitAdd = (): void => {
  if (!form.name.trim() || !form.url.trim()) {
    formError.value = '名称与 URL 为必填';
    return;
  }
  let headers: Record<string, string> | null = null;
  if (form.headersText.trim()) {
    try {
      const parsed: unknown = JSON.parse(form.headersText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
      headers = parsed as Record<string, string>;
    } catch {
      formError.value = '请求头不是合法的 JSON 对象';
      return;
    }
  }
  void store
    .addMcp({ name: form.name.trim(), transport: form.transport, url: form.url.trim(), headers })
    .then(() => {
      addOpen.value = false;
    });
};

/** 传输方式展示名 */
const TRANSPORT_LABEL: Record<McpTransport, string> = {
  'streamable-http': 'Streamable HTTP',
  sse: 'SSE',
};

/** 删除确认 */
const deleteTarget = ref<{ id: number; name: string } | null>(null);
const deleteModalOpen = ref(false);

/**
 * 打开删除确认
 * @param mcp 目标
 * @param mcp.id MCP id
 * @param mcp.name MCP 名称
 */
const openDelete = (mcp: { id: number; name: string }): void => {
  deleteTarget.value = mcp;
  deleteModalOpen.value = true;
};

/** 确认删除 */
const confirmDelete = (): void => {
  if (deleteTarget.value) void store.removeMcp(deleteTarget.value.id);
  deleteModalOpen.value = false;
};
</script>

<template>
  <BaseModal v-model:open="open" title="MCP 服务器管理" max-width-class="max-w-lg">
    <div class="space-y-2">
      <div
        v-for="mcp in store.mcps"
        :key="mcp.id"
        class="flex items-center gap-3 rounded-xl border border-flat-weak px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-text">{{ mcp.name }}</p>
          <p class="mt-0.5 truncate text-xs text-text-tertiary">
            {{ TRANSPORT_LABEL[mcp.transport] }} · {{ mcp.url }}
          </p>
        </div>
        <BaseSwitch
          :model-value="mcp.enabled"
          @update:model-value="(v: boolean) => void store.toggleMcp(mcp.id, v)"
        />
        <button
          type="button"
          class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-up"
          aria-label="删除 MCP"
          @click="openDelete(mcp)"
        >
          <MenuIcon name="trash" :size="15" />
        </button>
      </div>

      <p v-if="store.mcps.length === 0" class="py-6 text-center text-sm text-text-tertiary">
        还没有 MCP 服务器，点击下方按钮添加
      </p>

      <!-- 添加表单 -->
      <div v-if="addOpen" class="space-y-2.5 rounded-xl border border-flat-weak p-3">
        <input
          v-model="form.name"
          type="text"
          placeholder="名称"
          class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
        <div class="flex gap-1.5">
          <button
            v-for="(label, key) in TRANSPORT_LABEL"
            :key="key"
            type="button"
            class="rounded-full border px-3 py-1 text-xs transition-colors"
            :class="
              form.transport === key
                ? 'border-primary bg-primary-weak text-primary'
                : 'border-flat-weak text-text-secondary hover:border-primary'
            "
            @click="form.transport = key"
          >
            {{ label }}
          </button>
        </div>
        <input
          v-model="form.url"
          type="text"
          placeholder="https://mcp.example.com/mcp"
          class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
        <textarea
          v-model="form.headersText"
          rows="2"
          placeholder="请求头 JSON（可选），例如 Authorization 与 Bearer 令牌"
          class="w-full resize-none rounded-lg border border-flat-weak bg-transparent px-3 py-2 font-mono text-xs text-text outline-none focus:border-primary"
        />
        <p v-if="formError" class="text-xs text-up">{{ formError }}</p>
        <div class="flex justify-end gap-2">
          <BaseButton variant="ghost" @click="addOpen = false">取消</BaseButton>
          <BaseButton variant="primary" @click="submitAdd">添加</BaseButton>
        </div>
      </div>

      <button
        v-else
        type="button"
        class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-flat-weak py-3 text-sm text-text-tertiary transition-colors hover:border-primary hover:text-primary"
        @click="openAdd"
      >
        <MenuIcon name="plus" :size="14" />
        添加 MCP 服务器
      </button>

      <p class="text-xs text-text-tertiary">
        仅支持远端传输（Streamable HTTP / SSE）；启用的服务器其工具会合入 Agent
      </p>
    </div>
  </BaseModal>

  <BaseConfirmModal
    v-model:open="deleteModalOpen"
    title="删除 MCP 服务器"
    :content="`删除 MCP 服务器「${deleteTarget?.name ?? ''}」？引用它的 Agent 配置将自动忽略。`"
    ok-text="删除"
    ok-variant="danger"
    @ok="confirmDelete"
  />
</template>
