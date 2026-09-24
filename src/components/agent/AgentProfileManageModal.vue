<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useAgentStore } from '@/stores/agent';
import { DEFAULT_AGENT_SYSTEM_PROMPT } from '@/constants/agent.constants';
import type { AgentProfile, SubagentDef } from '@/types/agent.types';
import { isBuiltinSubagent } from '@/constants/builtin-subagents';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseSwitch from '@/components/ui/BaseSwitch.vue';
import BaseTextTip from '@/components/ui/BaseTextTip.vue';
import BaseConfirmModal from '@/components/ui/BaseConfirmModal.vue';
import SubagentEditModal from './SubagentEditModal.vue';
import MenuIcon from '@/components/ui/MenuIcon.vue';

/**
 * Agent 配置管理弹窗（方案 §6.4）
 *
 * 两个区块：
 * - Agent 配置：新建/编辑（名称 / 描述 / 自定义系统提示词 / 主模型 / subagent 编排 /
 *   skills 与 MCP 白名单 / 默认标记）+ 删除；
 * - Subagent 库：新建/编辑 + 删除。
 */
const store = useAgentStore();

const open = defineModel<boolean>('open', { required: true });

/** 弹窗内视图 */
type ViewMode = 'list' | 'profile-form';
const view = ref<ViewMode>('list');
/** 编辑中的配置 id（undefined = 新建） */
const editingId = ref<number | undefined>(undefined);

/* -------------------------------- profile 表单 ------------------------------- */

const form = reactive({
  name: '',
  description: '',
  systemPrompt: '',
  modelId: null as number | null,
  subagentIds: [] as number[],
  skillIds: [] as number[],
  mcpIds: [] as number[],
  isDefault: false,
});
const formError = ref('');

/**
 * 勾选 / 取消勾选 id 列表项
 * @param list 当前列表
 * @param id 目标 id
 * @returns 新列表
 */
const toggleId = (list: number[], id: number): number[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

/** 打开新建配置 */
const openCreateProfile = (): void => {
  editingId.value = undefined;
  Object.assign(form, {
    name: '',
    description: '',
    systemPrompt: '',
    modelId: null,
    subagentIds: [],
    skillIds: [],
    mcpIds: [],
    isDefault: store.profiles.length === 0,
  });
  formError.value = '';
  view.value = 'profile-form';
};

/**
 * 打开编辑配置
 * @param profile 配置对象
 */
const openEditProfile = (profile: AgentProfile): void => {
  editingId.value = profile.id;
  Object.assign(form, {
    name: profile.name,
    description: profile.description ?? '',
    systemPrompt: profile.systemPrompt ?? '',
    modelId: profile.modelId,
    subagentIds: [...profile.subagentIds],
    skillIds: [...profile.skillIds],
    mcpIds: [...profile.mcpIds],
    isDefault: profile.isDefault,
  });
  formError.value = '';
  view.value = 'profile-form';
};

/** 保存配置 */
const saveProfile = (): void => {
  if (!form.name.trim()) {
    formError.value = '名称不能为空';
    return;
  }
  void store.upsertProfile({
    id: editingId.value,
    name: form.name.trim(),
    description: form.description.trim() || null,
    systemPrompt: form.systemPrompt.trim() || null,
    modelId: form.modelId,
    toolNames: [],
    skillIds: form.skillIds,
    mcpIds: form.mcpIds,
    subagentIds: form.subagentIds,
    isDefault: form.isDefault,
  });
  view.value = 'list';
};

/** 删除确认（profile / subagent 共用） */
const deleteTarget = ref<{ kind: 'profile' | 'subagent'; id: number; name: string } | null>(null);
const deleteModalOpen = ref(false);

/** 确认删除 */
const confirmDelete = (): void => {
  if (!deleteTarget.value) return;
  const { kind, id } = deleteTarget.value;
  if (kind === 'profile') void store.removeProfile(id);
  else void store.removeSubagent(id);
  deleteModalOpen.value = false;
};

/* ------------------------------- subagent 编辑 ------------------------------ */

const subagentModalOpen = ref(false);
const subagentTarget = ref<SubagentDef | null>(null);

/**
 * 新建 subagent
 */
const openCreateSubagent = (): void => {
  subagentTarget.value = null;
  subagentModalOpen.value = true;
};

/**
 * 编辑 subagent
 * @param def 定义
 */
const openEditSubagent = (def: SubagentDef): void => {
  subagentTarget.value = def;
  subagentModalOpen.value = true;
};

/** 编排中的 subagent 定义（按 form.subagentIds 顺序） */
const orderedSubagents = computed(() =>
  form.subagentIds
    .map((id) => store.subagents.find((s) => s.id === id))
    .filter((s) => s !== undefined),
);

/** 弹窗标题 */
const modalTitle = computed(() => (view.value === 'list' ? 'Agent 配置' : editingId.value ? '编辑 Agent 配置' : '新建 Agent 配置'));

/**
 * Agent 配置副标题（描述 · subagent 数量）
 * 列表里单行截断，hover 气泡显示同一份文本（见 BaseTextTip）
 * @param profile Agent 配置
 * @returns 形如 `稳健型配置 · subagent 3` 的副标题
 */
const profileSubtitle = (profile: AgentProfile): string =>
  `${profile.description || '无描述'} · subagent ${profile.subagentIds.length}`;

// 每次打开回到列表态
watch(open, (isOpen) => {
  if (isOpen) view.value = 'list';
});
</script>

<template>
  <BaseModal v-model:open="open" :title="modalTitle" max-width-class="max-w-3xl">
    <!-- 列表态 -->
    <div v-if="view === 'list'" class="space-y-5">
      <!-- Agent 配置列表（双列） -->
      <div class="grid grid-cols-2 gap-2">
        <div
          v-for="profile in store.profiles"
          :key="profile.id"
          class="flex items-center gap-3 rounded-xl border border-flat-weak px-4 py-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium text-text">{{ profile.name }}</span>
              <span
                v-if="profile.isDefault"
                class="shrink-0 rounded-full bg-primary-weak px-2 py-0.5 text-xs text-primary"
              >
                默认
              </span>
            </div>
            <!-- hover 弹完整描述：列表里单行截断，气泡不受正文滚动容器裁剪 -->
            <BaseTextTip
              as="p"
              class="mt-0.5 truncate text-xs text-text-tertiary"
              :text="profileSubtitle(profile)"
            >
              {{ profileSubtitle(profile) }}
            </BaseTextTip>
          </div>
          <button
            type="button"
            class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text"
            aria-label="编辑配置"
            @click="openEditProfile(profile)"
          >
            <MenuIcon name="pencil" :size="15" />
          </button>
          <button
            type="button"
            class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-up"
            aria-label="删除配置"
            @click="deleteTarget = { kind: 'profile', id: profile.id, name: profile.name }; deleteModalOpen = true"
          >
            <MenuIcon name="trash" :size="15" />
          </button>
        </div>
        <p v-if="store.profiles.length === 0" class="col-span-2 py-4 text-center text-sm text-text-tertiary">
          还没有 Agent 配置，会话将使用全局默认提示词
        </p>
        <button
          type="button"
          class="col-span-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-flat-weak py-3 text-sm text-text-tertiary transition-colors hover:border-primary hover:text-primary"
          @click="openCreateProfile"
        >
          <MenuIcon name="plus" :size="14" />
          新建 Agent 配置
        </button>
      </div>

      <!-- Subagent 库（双列） -->
      <div class="grid grid-cols-2 gap-2 border-t border-flat-weak pt-4">
        <p class="col-span-2 text-sm font-medium text-text">Subagent 库</p>
        <div
          v-for="def in store.subagents"
          :key="def.id"
          class="flex items-center gap-3 rounded-xl bg-flat-weak/60 px-4 py-2.5"
        >
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2 truncate font-mono text-xs text-text">
              {{ def.name }}
              <span
                v-if="isBuiltinSubagent(def.id)"
                class="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-none text-on-primary"
              >
                内置
              </span>
            </p>
            <BaseTextTip
              as="p"
              class="mt-0.5 truncate text-xs text-text-tertiary"
              :text="def.description"
            >
              {{ def.description }}
            </BaseTextTip>
          </div>
          <template v-if="!isBuiltinSubagent(def.id)">
            <button
              type="button"
              class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text"
              aria-label="编辑 subagent"
              @click="openEditSubagent(def)"
            >
              <MenuIcon name="pencil" :size="14" />
            </button>
            <button
              type="button"
              class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-up"
              aria-label="删除 subagent"
              @click="deleteTarget = { kind: 'subagent', id: def.id, name: def.name }; deleteModalOpen = true"
            >
              <MenuIcon name="trash" :size="14" />
            </button>
          </template>
          <!-- 列表内直接启停：内置写 resource_scope，用户写 subagent 表（store 内按 id 分流） -->
          <BaseSwitch
            :model-value="def.enabled"
            @update:model-value="(v: boolean) => void store.toggleSubagent(def.id, v)"
          />
        </div>
        <button
          type="button"
          class="col-span-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-flat-weak py-2.5 text-sm text-text-tertiary transition-colors hover:border-primary hover:text-primary"
          @click="openCreateSubagent"
        >
          <MenuIcon name="plus" :size="14" />
          新建 Subagent
        </button>
      </div>
    </div>

    <!-- 配置表单态 -->
    <div v-else class="space-y-4">
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">名称<span class="text-up">*</span></p>
        <input
          v-model="form.name"
          type="text"
          placeholder="例如：深度诊断 Agent"
          class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
      </div>
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">描述</p>
        <input
          v-model="form.description"
          type="text"
          placeholder="一句话说明这个 Agent 的职责"
          class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
      </div>
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">
          自定义系统提示词<span class="text-xs text-text-tertiary">（空 = 全局默认）</span>
        </p>
        <textarea
          v-model="form.systemPrompt"
          rows="5"
          :placeholder="DEFAULT_AGENT_SYSTEM_PROMPT"
          class="w-full resize-y rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
      </div>
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">主模型（空 = 会话所选 / 全局默认）</p>
        <select
          v-model="form.modelId"
          class="w-full rounded-lg border border-flat-weak bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
        >
          <option :value="null">跟随会话 / 默认模型</option>
          <option v-for="model in store.models" :key="model.id" :value="model.id">
            {{ model.name }}
          </option>
        </select>
      </div>
      <div>
        <p class="mb-1.5 text-sm text-text-secondary">Subagent 编排（勾选即编排，主 agent 经 task 工具派发）</p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="def in store.subagents"
            :key="def.id"
            type="button"
            class="rounded-full border px-3 py-1 text-xs transition-colors"
            :class="
              form.subagentIds.includes(def.id)
                ? 'border-primary bg-primary-weak text-primary'
                : 'border-flat-weak text-text-secondary hover:border-primary'
            "
            @click="form.subagentIds = toggleId(form.subagentIds, def.id)"
          >
            {{ def.name }}
          </button>
          <span v-if="store.subagents.length === 0" class="text-xs text-text-tertiary">
            暂无 subagent，可在列表态新建
          </span>
        </div>
        <p v-if="orderedSubagents.length > 0" class="mt-1 text-xs text-text-tertiary">
          编排顺序：{{ orderedSubagents.map((s) => s.name).join(' → ') }}
        </p>
      </div>
      <!-- 技能 / MCP 的授权统一在资源侧「访问设置」配置（resource_grant 唯一事实源）；
           profile 上的 skillIds/mcpIds 是历史字段，运行时不参与装配（见 agent/run-context.ts） -->
      <p class="rounded-lg border border-flat-weak bg-surface px-3 py-2 text-xs text-text-tertiary">
        技能与数据源（MCP）的启用范围在左侧列表各资源的「访问设置」中配置：可设为全部 Agent 可用，或精确指定到主 Agent 与各子 Agent。
      </p>
      <label class="flex items-center justify-between text-sm text-text-secondary">
        设为默认配置
        <BaseSwitch v-model="form.isDefault" />
      </label>
      <p v-if="formError" class="text-xs text-up">{{ formError }}</p>
    </div>

    <template #footer>
      <template v-if="view === 'profile-form'">
        <BaseButton variant="ghost" @click="view = 'list'">取消</BaseButton>
        <BaseButton variant="primary" @click="saveProfile">保存</BaseButton>
      </template>
      <BaseButton v-else variant="primary" @click="open = false">完成</BaseButton>
    </template>
  </BaseModal>

  <!-- Subagent 编辑弹窗 -->
  <SubagentEditModal v-model:open="subagentModalOpen" v-model:target="subagentTarget" />

  <!-- 删除确认 -->
  <BaseConfirmModal
    v-model:open="deleteModalOpen"
    title="删除确认"
    :content="`删除「${deleteTarget?.name ?? ''}」？${deleteTarget?.kind === 'profile' ? '绑定它的会话将回落全局默认配置。' : '引用它的 Agent 配置将自动忽略。'}`"
    ok-text="删除"
    ok-variant="danger"
    @ok="confirmDelete"
  />
</template>
