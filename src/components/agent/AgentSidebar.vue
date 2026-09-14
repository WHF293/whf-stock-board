<script setup lang="ts">
import { computed } from 'vue';
import { useAgentStore } from '@/stores/agent';
import { AGENT_MANAGER_ENTRIES } from '@/constants/agent.constants';
import type { AgentManagerKey } from '@/types/agent.types';
import MenuIcon from '@/components/ui/MenuIcon.vue';
import SessionTree from './SessionTree.vue';

/**
 * Agent 页面左栏（页面级，非全局侧栏）
 *
 * 自上而下：新建对话主按钮 → Skills/MCP/Model/Agents 管理入口（带角标）
 * → 会话树（分组折叠 + 拖拽排序 + ⋯ 菜单）。收起态只留窄条（新建/展开按钮）。
 */
const emit = defineEmits<{
  /** 点击管理入口，key 标识目标弹窗 */
  (e: 'open-manager', key: AgentManagerKey): void;
}>();

const store = useAgentStore();

/** 入口角标（已启用/配置数量） */
const BADGE_BY_KEY = computed<Record<AgentManagerKey, number>>(() => ({
  skills: store.counts.skills,
  mcp: store.counts.mcps,
  model: store.counts.models,
  agents: store.counts.profiles,
}));

/** 新建对话（未分组，后续可拖入分组） */
const onNewChat = (): void => {
  void store.newSession(null);
};
</script>

<template>
  <!-- 收起态：窄条（仅新建 + 展开按钮） -->
  <div
    v-if="store.sidebarCollapsed"
    class="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-r border-flat-weak bg-surface py-3"
  >
    <button
      type="button"
      class="pressable rounded-lg p-2 text-text-tertiary hover:bg-flat-weak hover:text-text"
      aria-label="展开侧栏"
      @click="store.sidebarCollapsed = false"
    >
      <MenuIcon name="panelLeft" :size="18" />
    </button>
    <button
      type="button"
      class="pressable rounded-lg border border-dashed border-primary p-2 text-text-tertiary hover:text-primary"
      aria-label="新建对话"
      @click="onNewChat"
    >
      <MenuIcon name="plus" :size="18" />
    </button>
  </div>

  <!-- 展开态 -->
  <div
    v-else
    class="flex h-full w-64 shrink-0 flex-col border-r border-flat-weak bg-surface"
  >
    <!-- 新建对话（样式对齐「新建分组」：虚线描边按钮） -->
    <div class="shrink-0 px-3 pt-3">
      <button
        type="button"
        class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary py-2 text-xs text-text-tertiary transition-colors hover:text-primary"
        @click="onNewChat"
      >
        <MenuIcon name="plus" :size="12" />
        新建对话
      </button>
    </div>

    <!-- 管理入口行 -->
    <nav class="shrink-0 space-y-0.5 px-3 pt-3" aria-label="Agent 管理入口">
      <button
        v-for="entry in AGENT_MANAGER_ENTRIES"
        :key="entry.key"
        type="button"
        class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-flat-weak hover:text-text"
        @click="emit('open-manager', entry.key)"
      >
        <MenuIcon :name="entry.icon" :size="16" class="text-text-tertiary" />
        <span class="flex-1 text-left">{{ entry.label }}</span>
        <span
          class="min-w-5 rounded-full bg-flat-weak px-1.5 text-center text-xs leading-5 text-text-tertiary"
        >
          {{ BADGE_BY_KEY[entry.key] }}
        </span>
      </button>
    </nav>

    <!-- 会话树（滚动区） -->
    <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3">
      <p class="px-1.5 pb-1 text-xs font-medium text-text-tertiary">会话</p>
      <SessionTree />
    </div>
  </div>
</template>
