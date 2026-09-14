<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useAgentStore } from '@/stores/agent';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseSwitch from '@/components/ui/BaseSwitch.vue';
import BaseConfirmModal from '@/components/ui/BaseConfirmModal.vue';
import MenuIcon from '@/components/ui/MenuIcon.vue';

/**
 * Skills 管理弹窗
 *
 * - 列表：启用开关（角标计数）+ 删除；
 * - 添加：登记展示名 / 目录名 / 描述；目录扫描与 SKILL.md 解析（fs 后端）在 M4 接入，
 *   本期登记的 dirName 即 appData/agent-workspace 下的约定目录。
 */
const store = useAgentStore();

const open = defineModel<boolean>('open', { required: true });

/** 添加表单显隐 */
const addOpen = ref(false);
const form = reactive({ name: '', dirName: '', description: '' });
const formError = ref('');

/** 打开添加表单 */
const openAdd = (): void => {
  form.name = '';
  form.dirName = '';
  form.description = '';
  formError.value = '';
  addOpen.value = true;
};

/** 提交添加 */
const submitAdd = (): void => {
  const dirName = form.dirName.trim();
  if (!form.name.trim() || !dirName) {
    formError.value = '名称与目录名为必填';
    return;
  }
  void store.addSkill(form.name.trim(), dirName, form.description.trim() || null).then((id) => {
    if (id < 0) formError.value = '目录名已存在';
    else addOpen.value = false;
  });
};

/** 删除确认 */
const deleteTarget = ref<{ id: number; name: string } | null>(null);
const deleteModalOpen = ref(false);

/**
 * 打开删除确认
 * @param skill 目标
 * @param skill.id Skill id
 * @param skill.name Skill 名称
 */
const openDelete = (skill: { id: number; name: string }): void => {
  deleteTarget.value = skill;
  deleteModalOpen.value = true;
};

/** 确认删除 */
const confirmDelete = (): void => {
  if (deleteTarget.value) void store.removeSkill(deleteTarget.value.id);
  deleteModalOpen.value = false;
};
</script>

<template>
  <BaseModal v-model:open="open" title="Skills 管理" max-width-class="max-w-lg">
    <div class="space-y-2">
      <div
        v-for="skill in store.skills"
        :key="skill.id"
        class="flex items-center gap-3 rounded-xl border border-flat-weak px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-text">{{ skill.name }}</p>
          <p class="mt-0.5 truncate text-xs text-text-tertiary">
            {{ skill.description || skill.dirName }}
          </p>
        </div>
        <BaseSwitch
          :model-value="skill.enabled"
          @update:model-value="(v: boolean) => void store.toggleSkill(skill.id, v)"
        />
        <button
          type="button"
          class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-up"
          aria-label="删除 Skill"
          @click="openDelete(skill)"
        >
          <MenuIcon name="trash" :size="15" />
        </button>
      </div>

      <p v-if="store.skills.length === 0" class="py-6 text-center text-sm text-text-tertiary">
        还没有 Skill，点击下方按钮登记
      </p>

      <!-- 添加表单 -->
      <div v-if="addOpen" class="space-y-2.5 rounded-xl border border-flat-weak p-3">
        <input
          v-model="form.name"
          type="text"
          placeholder="Skill 名称"
          class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
        <input
          v-model="form.dirName"
          type="text"
          placeholder="目录名（唯一，如 stock-diagnosis）"
          class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
        <textarea
          v-model="form.description"
          rows="2"
          placeholder="描述（可选，主 agent 据此决定何时使用）"
          class="w-full resize-none rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
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
        添加 Skill
      </button>

      <p class="text-xs text-text-tertiary">
        启用的 Skill 会注入 Agent 的系统提示词索引（目录内容加载在后续里程碑接入）
      </p>
    </div>
  </BaseModal>

  <BaseConfirmModal
    v-model:open="deleteModalOpen"
    title="删除 Skill"
    :content="`删除 Skill「${deleteTarget?.name ?? ''}」？引用它的 Agent 配置将自动忽略。`"
    ok-text="删除"
    ok-variant="danger"
    @ok="confirmDelete"
  />
</template>
