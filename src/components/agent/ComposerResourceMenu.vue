<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ComposerResourceKind, ComposerResourceOption } from '@/types/agent.types';
import MenuIcon from '@/components/ui/MenuIcon.vue';

/**
 * 输入框底栏的 + 资源选择器（级联两级：类别 → 勾选列表）
 *
 * 勾选的是**对话级强制包含**：下次发送时该资源绕过 scope/grant 授权判定
 * （用户显式选择 > 配置层授权）直接并入运行上下文；停用的资源不在此列
 * （选项列表由宿主过滤），勾了也无效。选中项由宿主渲染成 chips 并持久到
 * 发送后，切换会话清空。
 *
 * 三类资源的并集口径（宿主接线，这里只管勾选）：
 * - 技能：强制进主 agent 的 skill 声明列表；
 * - MCP：强制并入主 agent 的工具集（不扩给子 agent）；
 * - 子代理：追加参与本次编排（与 Agent 配置的 subagentIds 取并集）。
 */
const props = defineProps<{
  /** 可选技能（enabled 的内置 + 用户） */
  skillOptions: ComposerResourceOption[];
  /** 可选 MCP（内置经启停过滤 + 远端 enabled） */
  mcpOptions: ComposerResourceOption[];
  /** 可选子代理（enabled） */
  subagentOptions: ComposerResourceOption[];
  /** 已勾选的技能资源 id */
  selectedSkillIds: number[];
  /** 已勾选的 MCP 资源 id */
  selectedMcpIds: number[];
  /** 已勾选的子代理 id */
  selectedSubagentIds: number[];
}>();

const emit = defineEmits<{
  /** 切换某资源的勾选状态 */
  (e: 'toggle', kind: ComposerResourceKind, id: number): void;
}>();

/** 弹层开关 */
const open = ref(false);

/** 当前展开的类别（null = 根级类别列表） */
const activeSection = ref<ComposerResourceKind | null>(null);

/** 类别元信息（顺序即根级展示顺序；仅本组件展示用） */
const SECTIONS: ReadonlyArray<{
  key: ComposerResourceKind;
  label: string;
  icon: string;
  hint: string;
}> = [
  { key: 'skill', label: '技能', icon: 'book', hint: '强制进主 agent 的 skill' },
  { key: 'mcp', label: 'MCP', icon: 'plug', hint: '强制并入主 agent 的工具' },
  { key: 'subagent', label: '子代理', icon: 'agent', hint: '追加参与编排的子 agent' },
];

/** 是否有任何勾选（触发按钮高亮） */
const hasSelection = computed(
  () =>
    props.selectedSkillIds.length > 0 ||
    props.selectedMcpIds.length > 0 ||
    props.selectedSubagentIds.length > 0,
);

/**
 * 某类别当前的勾选集合
 * @param kind 类别
 * @returns 已勾选 id 数组
 */
const selectedOf = (kind: ComposerResourceKind): number[] => {
  if (kind === 'skill') return props.selectedSkillIds;
  if (kind === 'mcp') return props.selectedMcpIds;
  return props.selectedSubagentIds;
};

/**
 * 某类别的选项列表
 * @param kind 类别
 * @returns 选项数组
 */
const optionsOf = (kind: ComposerResourceKind): ComposerResourceOption[] => {
  if (kind === 'skill') return props.skillOptions;
  if (kind === 'mcp') return props.mcpOptions;
  return props.subagentOptions;
};

/**
 * 切换勾选并留在当前列表（可连续勾选多个）
 * @param kind 类别
 * @param id 资源 id
 */
const toggle = (kind: ComposerResourceKind, id: number): void => {
  emit('toggle', kind, id);
};

/** 打开弹层并回到根级 */
const openMenu = (): void => {
  activeSection.value = null;
  open.value = true;
};

/** 切换弹层开关（打开时回根级） */
const toggleOpen = (): void => {
  if (open.value) {
    open.value = false;
    return;
  }
  openMenu();
};

/**
 * 勾选集合的展示计数（根级行右侧）
 * @param kind 类别
 * @returns 空串或「n」
 */
const countLabel = (kind: ComposerResourceKind): string => {
  const count = selectedOf(kind).length;
  return count > 0 ? String(count) : '';
};
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="rounded-full p-2 transition-colors"
      :class="
        hasSelection
          ? 'bg-primary-weak text-primary hover:opacity-80'
          : 'bg-flat-weak text-text-tertiary hover:bg-flat hover:text-text-secondary'
      "
      aria-label="添加对话资源"
      title="强制包含技能 / MCP / 子代理（本次对话生效）"
      @click="toggleOpen"
    >
      <MenuIcon name="plus" :size="15" />
    </button>

    <!-- 外点遮罩：全屏透明层，压在触发按钮上方、弹层下方 -->
    <div v-if="open" class="fixed inset-0 z-40" @click="open = false" />

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-64 overflow-y-auto rounded-xl border border-flat-weak bg-surface py-1 shadow-lg"
    >
      <!-- 根级：三个类别入口 -->
      <template v-if="activeSection === null">
        <p class="px-3 pb-1 pt-1.5 text-[11px] text-text-tertiary">对话级强制包含</p>
        <button
          v-for="section in SECTIONS"
          :key="section.key"
          type="button"
          class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-flat-weak"
          @click="activeSection = section.key"
        >
          <MenuIcon :name="section.icon" :size="15" class="shrink-0 text-text-tertiary" />
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5">
              <span class="text-sm text-text">{{ section.label }}</span>
              <span
                v-if="countLabel(section.key)"
                class="rounded-full bg-primary-weak px-1.5 text-[10px] leading-4 text-primary"
              >
                {{ countLabel(section.key) }}
              </span>
            </span>
            <span class="block truncate text-[11px] text-text-tertiary">{{ section.hint }}</span>
          </span>
          <MenuIcon name="chevronRight" :size="13" class="shrink-0 text-text-tertiary" />
        </button>
      </template>

      <!-- 二级：某类别的勾选列表 -->
      <template v-else>
        <button
          type="button"
          class="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-flat-weak"
          @click="activeSection = null"
        >
          <MenuIcon name="chevronLeft" :size="13" class="shrink-0 text-text-tertiary" />
          <span class="text-sm text-text">{{ SECTIONS.find((s) => s.key === activeSection)?.label }}</span>
        </button>
        <button
          v-for="option in optionsOf(activeSection)"
          :key="option.id"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-flat-weak"
          @click="toggle(activeSection, option.id)"
        >
          <MenuIcon
            name="check"
            :size="14"
            class="shrink-0"
            :class="selectedOf(activeSection).includes(option.id) ? 'text-primary' : 'text-transparent'"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm text-text">{{ option.name }}</span>
            <span v-if="option.description" class="block truncate text-[11px] text-text-tertiary">
              {{ option.description }}
            </span>
          </span>
        </button>
        <p v-if="optionsOf(activeSection).length === 0" class="px-3 py-2 text-xs text-text-tertiary">
          暂无可选项
        </p>
      </template>
    </div>
  </div>
</template>
