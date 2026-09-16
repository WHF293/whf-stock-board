<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useAgentStore } from '@/stores/agent';
import { parseSkillZip, writeSkillFiles } from '@/utils/skill-zip';
import { BUILTIN_SKILLS } from '@/constants/builtin-skills';
import { isTauri } from '@tauri-apps/api/core';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseSwitch from '@/components/ui/BaseSwitch.vue';
import BaseTextTip from '@/components/ui/BaseTextTip.vue';
import BaseConfirmModal from '@/components/ui/BaseConfirmModal.vue';
import MenuIcon from '@/components/ui/MenuIcon.vue';
import ResourceAccessModal from './ResourceAccessModal.vue';
import type { GrantResourceKind } from '@/types/agent.types';

/**
 * Skills 管理弹窗
 *
 * - 内置 skill：随应用发货的方法论（不可删、不可编辑），但**可以关掉或指定只给某些 agent 用**；
 * - 用户 skill：启用开关（角标计数）+ 删除；添加可登记展示名 / 目录名 / 描述，
 *   或导入 zip 包（解压 SKILL.md 与附属文件到 appData/agent-workspace/<dirName>/，
 *   并自动读取 frontmatter 登记）；
 * - 每个 skill 都有「访问设置」（gear）：启用 + 全部 agent / 精确指定。
 */
const store = useAgentStore();

const open = defineModel<boolean>('open', { required: true });

/* --------------------------------- 访问设置 -------------------------------- */

/** 访问设置弹窗的受控资源（null = 未打开） */
const accessTarget = ref<null | {
  resourceId: number;
  resourceName: string;
  builtin: boolean;
  enabled?: boolean;
}>(null);
const accessOpen = ref(false);

/**
 * 打开访问设置弹窗
 * @param target 目标资源描述
 * @param target.resourceId 资源 id（内置为负数）
 * @param target.resourceName 展示名
 * @param target.builtin 是否内置
 * @param target.enabled 用户资源自身的启用状态（内置忽略）
 */
const openAccess = (target: {
  resourceId: number;
  resourceName: string;
  builtin: boolean;
  enabled?: boolean;
}): void => {
  accessTarget.value = target;
  accessOpen.value = true;
};

/** kind 常量（模板里引用需要具名） */
const ACCESS_KIND: GrantResourceKind = 'skill';

/** 添加表单显隐 */
const addOpen = ref(false);
const form = reactive({ name: '', dirName: '', description: '' });
const formError = ref('');

/** zip 导入：进度/错误提示 */
const importing = ref(false);
const importError = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

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

/** 触发 zip 文件选择 */
const pickZip = (): void => {
  importError.value = '';
  if (!isTauri()) {
    importError.value = 'Skill 导入仅支持桌面端';
    return;
  }
  fileInput.value?.click();
};

/**
 * 处理选中的 zip：解析 → 落盘 → 登记
 * @param event input change 事件
 */
const onZipChange = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // 允许重复选同一个文件
  if (!file) return;
  importing.value = true;
  void file
    .arrayBuffer()
    .then((buffer) => parseSkillZip(buffer, file.name))
    .then(async (parsed) => {
      await writeSkillFiles(parsed);
      const id = await store.addSkill(parsed.name, parsed.dirName, parsed.description);
      if (id < 0) throw new Error('目录名 ' + parsed.dirName + ' 已登记，请先删除同名 Skill');
    })
    .catch((err: unknown) => {
      importError.value = err instanceof Error ? err.message : '导入失败';
    })
    .finally(() => {
      importing.value = false;
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
  <BaseModal v-model:open="open" title="Skills 管理" max-width-class="max-w-3xl">
    <!-- 双列网格：内置与自装 skill 卡片自然接续；表单/按钮/提示等整宽项加 col-span-2 -->
    <div class="grid grid-cols-2 gap-2">
      <!-- 内置 Skill：随应用发货的方法论，不可删但可直接停用 / 限定 agent -->
      <div
        v-for="builtin in BUILTIN_SKILLS"
        :key="builtin.id"
        class="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary-weak/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2 truncate text-sm font-medium text-text">
            {{ builtin.name }}
            <span
              class="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-none text-on-primary"
            >
              内置
            </span>
          </p>
          <!-- hover 弹完整描述：列表里是单行截断，气泡不受正文滚动容器裁剪 -->
          <BaseTextTip
            as="p"
            class="mt-0.5 truncate text-xs text-text-tertiary"
            :text="builtin.description"
          >
            {{ builtin.description }}
          </BaseTextTip>
        </div>
        <!-- 列表内直接启停：内置走 resource_scope.enabled，用户走自身表 -->
        <BaseSwitch
          :model-value="store.isBuiltinEnabled('skill', builtin.id)"
          @update:model-value="(v: boolean) => void store.toggleSkill(builtin.id, v)"
        />
        <button
          type="button"
          class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-primary"
          aria-label="访问设置"
          title="访问设置（允许哪些 Agent 使用）"
          @click="openAccess({ resourceId: builtin.id, resourceName: builtin.name, builtin: true })"
        >
          <MenuIcon name="sliders" :size="15" />
        </button>
      </div>

      <div
        v-for="skill in store.skills"
        :key="skill.id"
        class="flex items-center gap-3 rounded-xl border border-flat-weak px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-text">{{ skill.name }}</p>
          <BaseTextTip
            as="p"
            class="mt-0.5 truncate text-xs text-text-tertiary"
            :text="skill.description || skill.dirName"
          >
            {{ skill.description || skill.dirName }}
          </BaseTextTip>
        </div>
        <BaseSwitch
          :model-value="skill.enabled"
          @update:model-value="(v: boolean) => void store.toggleSkill(skill.id, v)"
        />
        <button
          type="button"
          class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-primary"
          aria-label="访问设置"
          title="访问设置（允许哪些 Agent 使用）"
          @click="openAccess({ resourceId: skill.id, resourceName: skill.name, builtin: false, enabled: skill.enabled })"
        >
          <MenuIcon name="sliders" :size="15" />
        </button>
        <button
          type="button"
          class="rounded p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-up"
          aria-label="删除 Skill"
          @click="openDelete(skill)"
        >
          <MenuIcon name="trash" :size="15" />
        </button>
      </div>

      <p v-if="store.skills.length === 0" class="col-span-2 py-6 text-center text-sm text-text-tertiary">
        还没有自装 Skill，点击下方按钮登记
      </p>

      <!-- 添加表单 -->
      <div v-if="addOpen" class="col-span-2 space-y-2.5 rounded-xl border border-flat-weak p-3">
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
        class="col-span-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-flat-weak py-3 text-sm text-text-tertiary transition-colors hover:border-primary hover:text-primary"
        @click="openAdd"
      >
        <MenuIcon name="plus" :size="14" />
        添加 Skill
      </button>

      <!-- zip 导入：与手动登记并列为两种添加方式 -->
      <div v-if="!addOpen" class="col-span-2 flex items-center gap-2">
        <input
          ref="fileInput"
          type="file"
          accept=".zip"
          class="hidden"
          @change="onZipChange"
        />
        <button
          type="button"
          :disabled="importing"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-flat-weak py-3 text-sm text-text-tertiary transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
          @click="pickZip"
        >
          <MenuIcon name="folder" :size="14" />
          {{ importing ? '导入中…' : '导入 zip 包' }}
        </button>
      </div>
      <p v-if="importError" class="col-span-2 text-xs text-up">{{ importError }}</p>

      <p class="col-span-2 text-xs text-text-tertiary">
        zip 根目录（或唯一顶层目录下）需包含 SKILL.md，frontmatter 的 name/description 会自动登记；附属文件一并解压到 appData/agent-workspace。内置 Skill 可直接开关，也可用右侧设置限定只给部分 Agent 使用
      </p>
    </div>
  </BaseModal>

  <ResourceAccessModal
    v-if="accessTarget"
    v-model:open="accessOpen"
    :kind="ACCESS_KIND"
    :resource-id="accessTarget.resourceId"
    :resource-name="accessTarget.resourceName"
    :builtin="accessTarget.builtin"
    :enabled="accessTarget.enabled"
  />

  <BaseConfirmModal
    v-model:open="deleteModalOpen"
    title="删除 Skill"
    :content="`删除 Skill「${deleteTarget?.name ?? ''}」？引用它的 Agent 配置将自动忽略。`"
    ok-text="删除"
    ok-variant="danger"
    @ok="confirmDelete"
  />
</template>
