<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useAgentStore } from '@/stores/agent';
import type { McpTransport } from '@/types/agent.types';
import { listBuiltinMcpServers, resetMcpRuntime } from '@/agent/mcp/registry';
import { pluginKernel } from '@/plugin';
import { parseMcpJsonText } from '@/utils/mcp-json';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseSwitch from '@/components/ui/BaseSwitch.vue';
import BaseConfirmModal from '@/components/ui/BaseConfirmModal.vue';
import MenuIcon from '@/components/ui/MenuIcon.vue';

/**
 * MCP 服务器管理弹窗（一期仅 streamable HTTP / SSE 远端传输）
 *
 * - 列表：启用开关 + 删除；
 * - 添加：两种模式 —— 手动填写（名称 / 传输方式 / URL / 请求头），或粘贴 JSON
 *   （支持 { "mcpServers": {...} } 标准格式与单服务器对象，批量导入）；
 * - 远端已接线：启用的服务器在下次 Agent 运行时连接并合入工具（连接失败跳过该服务器、
 *   不影响其余工具），故增删改后调用 `resetMcpRuntime()` 让运行时不缓存旧连接；
 * - 内置 MCP（应用接口 / stock-sdk）：进程内实现，不可删除、不可编辑，随应用常驻
 */
const store = useAgentStore();

const open = defineModel<boolean>('open', { required: true });

/** 添加表单显隐 */
const addOpen = ref(false);
/** 添加模式：manual 手动填写 / json 粘贴 JSON */
const addMode = ref<'manual' | 'json'>('manual');
const form = reactive({
  name: '',
  transport: 'streamable-http' as McpTransport,
  url: '',
  headersText: '',
});
const formError = ref('');
/** JSON 模式：文本、导入结果反馈 */
const jsonText = ref('');
const jsonImported = ref('');
const importing = ref(false);

/** 打开添加表单（收起编辑表单） */
const openAdd = (): void => {
  editTarget.value = null;
  form.name = '';
  form.transport = 'streamable-http';
  form.url = '';
  form.headersText = '';
  formError.value = '';
  jsonText.value = '';
  jsonImported.value = '';
  addMode.value = 'manual';
  addOpen.value = true;
};

/** 提交 JSON 批量导入 */
const submitJsonImport = (): void => {
  if (!jsonText.value.trim()) {
    formError.value = '请粘贴 JSON 配置';
    return;
  }
  let result;
  try {
    result = parseMcpJsonText(jsonText.value);
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'JSON 解析失败';
    return;
  }
  if (result.servers.length === 0) {
    formError.value = result.skipped[0] ?? '未解析出任何服务器';
    return;
  }
  formError.value = '';
  importing.value = true;
  void Promise.all(result.servers.map((server) => store.addMcp(server)))
    .then(() => resetMcpRuntime())
    .then(() => {
      const skippedNote =
        result.skipped.length > 0 ? '；跳过 ' + result.skipped.length + ' 条（' + result.skipped.join('；') + '）' : '';
      jsonImported.value = '已导入 ' + result.servers.length + ' 台服务器' + skippedNote;
      jsonText.value = '';
    })
    .catch(() => {
      formError.value = '导入失败，请重试';
    })
    .finally(() => {
      importing.value = false;
    });
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
    .then(() => resetMcpRuntime())
    .then(() => {
      addOpen.value = false;
    });
};

/**
 * 启停远端 MCP（变更后失效运行时缓存，下次运行重连）
 * @param id MCP id
 * @param enabled 是否启用
 * @returns 无
 */
const toggleRemote = (id: number, enabled: boolean): void => {
  void store.toggleMcp(id, enabled).then(() => resetMcpRuntime());
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

/* -------------------------------- 编辑（远端 MCP） ------------------------------- */

/** 编辑目标（null 表示未进入编辑模式） */
const editTarget = ref<null | { id: number; name: string }>(null);
/** 编辑模式：manual 输入框填写 / json 编辑 JSON 文本 */
const editMode = ref<'manual' | 'json'>('manual');
const editForm = reactive({
  name: '',
  transport: 'streamable-http' as McpTransport,
  url: '',
  headersText: '',
});
const editError = ref('');
/** json 模式下的文本（进入编辑时预填当前配置） */
const editJsonText = ref('');

/**
 * 进入编辑模式（同时收起添加表单）
 * @param mcp 目标服务器
 * @param mcp.id
 * @param mcp.name
 * @param mcp.transport
 * @param mcp.url
 * @param mcp.headers
 */
const openEdit = (mcp: { id: number; name: string; transport: McpTransport; url: string; headers: Record<string, string> | null }): void => {
  addOpen.value = false;
  editTarget.value = mcp;
  editMode.value = 'manual';
  editForm.name = mcp.name;
  editForm.transport = mcp.transport;
  editForm.url = mcp.url;
  editForm.headersText = mcp.headers ? JSON.stringify(mcp.headers, null, 2) : '';
  editJsonText.value = JSON.stringify(
    { name: mcp.name, transport: mcp.transport, url: mcp.url, headers: mcp.headers ?? {} },
    null,
    2,
  );
  editError.value = '';
};

/** 退出编辑模式 */
const closeEdit = (): void => {
  editTarget.value = null;
};

/** 提交编辑（输入框模式） */
const submitEditManual = (): void => {
  if (!editTarget.value) return;
  if (!editForm.name.trim() || !editForm.url.trim()) {
    editError.value = '名称与 URL 为必填';
    return;
  }
  let headers: Record<string, string> | null = null;
  if (editForm.headersText.trim()) {
    try {
      const parsed: unknown = JSON.parse(editForm.headersText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
      headers = parsed as Record<string, string>;
    } catch {
      editError.value = '请求头不是合法的 JSON 对象';
      return;
    }
  }
  editError.value = '';
  void store
    .updateMcp(editTarget.value.id, {
      name: editForm.name.trim(),
      transport: editForm.transport,
      url: editForm.url.trim(),
      headers,
    })
    .then(() => resetMcpRuntime())
    .then(() => {
      editTarget.value = null;
    })
    .catch(() => {
      editError.value = '保存失败，请重试';
    });
};

/** 提交编辑（JSON 模式：只接受恰好一台服务器的配置） */
const submitEditJson = (): void => {
  if (!editTarget.value) return;
  let result;
  try {
    result = parseMcpJsonText(editJsonText.value);
  } catch (err) {
    editError.value = err instanceof Error ? err.message : 'JSON 解析失败';
    return;
  }
  if (result.servers.length === 0) {
    editError.value = result.skipped[0] ?? '未解析出服务器';
    return;
  }
  if (result.servers.length > 1) {
    editError.value = '编辑模式仅支持单台服务器配置（解析到 ' + result.servers.length + ' 台）';
    return;
  }
  editError.value = '';
  void store
    .updateMcp(editTarget.value.id, result.servers[0])
    .then(() => resetMcpRuntime())
    .then(() => {
      editTarget.value = null;
    })
    .catch(() => {
      editError.value = '保存失败，请重试';
    });
};

/** 确认删除 */
const confirmDelete = (): void => {
  if (deleteTarget.value) {
    void store.removeMcp(deleteTarget.value.id).then(() => resetMcpRuntime());
  }
  deleteModalOpen.value = false;
};

/**
 * 内置 MCP 服务器（宿主自带 + 插件贡献）
 *
 * 插件经 `ctx.agent.addServer()` 注册的服务器同样常驻不可删：
 * 它的生命周期由插件启停控制，而不是在管理弹窗里增删。
 */
const builtinServers = computed(() => {
  void pluginKernel.revision.value;
  return listBuiltinMcpServers();
});
</script>

<template>
  <BaseModal v-model:open="open" title="MCP 服务器管理" max-width-class="max-w-lg">
    <div class="space-y-2">
      <!-- 内置 MCP：常驻不可删（应用接口 / stock-sdk） -->
      <div
        v-for="builtin in builtinServers"
        :key="builtin.key"
        class="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary-weak/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2 truncate text-sm font-medium text-text">
            {{ builtin.name }}
            <span
              class="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-none text-white"
            >
              内置
            </span>
          </p>
          <p class="mt-0.5 truncate text-xs text-text-tertiary">{{ builtin.description }}</p>
          <p class="mt-0.5 truncate text-xs text-text-secondary">
            {{ builtin.tools.map((t) => t.definition.name).join(' / ') }}
          </p>
        </div>
        <span class="shrink-0 text-xs text-text-tertiary">常驻</span>
      </div>

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
          @update:model-value="(v: boolean) => toggleRemote(mcp.id, v)"
        />
        <button
          type="button"
          class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-primary"
          aria-label="编辑 MCP"
          @click="openEdit(mcp)"
        >
          <MenuIcon name="pencil" :size="15" />
        </button>
        <button
          type="button"
          class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-up"
          aria-label="删除 MCP"
          @click="openDelete(mcp)"
        >
          <MenuIcon name="trash" :size="15" />
        </button>
      </div>

      <!-- 编辑表单（远端 MCP）：输入框 / JSON 两种形式 -->
      <div v-if="editTarget" class="space-y-2.5 rounded-xl border border-primary/40 p-3">
        <p class="text-xs font-medium text-primary">编辑「{{ editTarget.name }}」</p>
        <div class="flex gap-1.5">
          <button
            v-for="mode in [
              { key: 'manual', label: '输入框填写' },
              { key: 'json', label: '编辑 JSON' },
            ]"
            :key="mode.key"
            type="button"
            class="rounded-full border px-3 py-1 text-xs transition-colors"
            :class="
              editMode === mode.key
                ? 'border-primary bg-primary-weak text-primary'
                : 'border-flat-weak text-text-secondary hover:border-primary'
            "
            @click="editMode = mode.key as 'manual' | 'json'"
          >
            {{ mode.label }}
          </button>
        </div>

        <template v-if="editMode === 'manual'">
          <input
            v-model="editForm.name"
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
                editForm.transport === key
                  ? 'border-primary bg-primary-weak text-primary'
                  : 'border-flat-weak text-text-secondary hover:border-primary'
              "
              @click="editForm.transport = key"
            >
              {{ label }}
            </button>
          </div>
          <input
            v-model="editForm.url"
            type="text"
            placeholder="https://mcp.example.com/mcp"
            class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
          />
          <textarea
            v-model="editForm.headersText"
            rows="2"
            placeholder="请求头 JSON（可选），例如 Authorization 与 Bearer 令牌"
            class="w-full resize-none rounded-lg border border-flat-weak bg-transparent px-3 py-2 font-mono text-xs text-text outline-none focus:border-primary"
          />
        </template>

        <template v-else>
          <textarea
            v-model="editJsonText"
            rows="8"
            placeholder="单个服务器 JSON 对象，或 { &quot;mcpServers&quot;: { 单台 } }"
            class="w-full resize-y rounded-lg border border-flat-weak bg-transparent px-3 py-2 font-mono text-xs text-text outline-none focus:border-primary"
          />
        </template>

        <p v-if="editError" class="text-xs text-up">{{ editError }}</p>
        <div class="flex justify-end gap-2">
          <BaseButton variant="ghost" @click="closeEdit">取消</BaseButton>
          <BaseButton variant="primary" @click="editMode === 'json' ? submitEditJson() : submitEditManual()">
            保存
          </BaseButton>
        </div>
      </div>

      <p
        v-if="store.mcps.length === 0"
        class="py-4 text-center text-sm text-text-tertiary"
      >
        暂无远端 MCP 服务器，点击下方按钮添加
      </p>

      <!-- 添加表单 -->
      <div v-if="addOpen && !editTarget" class="space-y-2.5 rounded-xl border border-flat-weak p-3">
        <!-- 模式切换：手动填写 / 粘贴 JSON -->
        <div class="flex gap-1.5">
          <button
            v-for="mode in [
              { key: 'manual', label: '手动填写' },
              { key: 'json', label: '粘贴 JSON' },
            ]"
            :key="mode.key"
            type="button"
            class="rounded-full border px-3 py-1 text-xs transition-colors"
            :class="
              addMode === mode.key
                ? 'border-primary bg-primary-weak text-primary'
                : 'border-flat-weak text-text-secondary hover:border-primary'
            "
            @click="addMode = mode.key as 'manual' | 'json'"
          >
            {{ mode.label }}
          </button>
        </div>

        <!-- 手动填写 -->
        <template v-if="addMode === 'manual'">
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
        </template>

        <!-- 粘贴 JSON：mcpServers 标准格式 / 单服务器对象 -->
        <template v-else>
          <textarea
            v-model="jsonText"
            rows="7"
            placeholder="{ &quot;mcpServers&quot;: { &quot;demo&quot;: { &quot;url&quot;: &quot;http://127.0.0.1:3117/mcp&quot;, &quot;transport&quot;: &quot;streamable-http&quot;, &quot;headers&quot;: {} } } }"
            class="w-full resize-y rounded-lg border border-flat-weak bg-transparent px-3 py-2 font-mono text-xs text-text outline-none focus:border-primary"
          />
          <p v-if="jsonImported" class="text-xs text-text-secondary">{{ jsonImported }}</p>
        </template>

        <p v-if="formError" class="text-xs text-up">{{ formError }}</p>
        <div class="flex justify-end gap-2">
          <BaseButton variant="ghost" @click="addOpen = false">取消</BaseButton>
          <BaseButton variant="primary" :disabled="importing" @click="addMode === 'json' ? submitJsonImport() : submitAdd()">
            {{ addMode === 'json' ? '导入' : '添加' }}
          </BaseButton>
        </div>
      </div>

      <button
        v-else-if="!editTarget"
        type="button"
        class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-flat-weak py-3 text-sm text-text-tertiary transition-colors hover:border-primary hover:text-primary"
        @click="openAdd"
      >
        <MenuIcon name="plus" :size="14" />
        添加 MCP 服务器
      </button>

      <p class="text-xs text-text-tertiary">
        内置 MCP（应用接口 / stock-sdk）常驻可用、不可删除；远端仅支持 Streamable HTTP / SSE，启用后其工具会合入 Agent（连接失败自动跳过该服务器）。声明了 ui:// 的工具，结果会在聊天区沙箱卡片内渲染
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
