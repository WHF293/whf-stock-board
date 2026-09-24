<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAgentStore } from '@/stores/agent';
import { AGENT_MANAGER_ENTRIES } from '@/constants/agent.constants';
import { listBuiltinMcpServers } from '@/agent/mcp/registry';
import type { AgentManagerKey } from '@/types/agent.types';
import MenuIcon from '@/components/ui/MenuIcon.vue';
import SessionTree from './SessionTree.vue';

/**
 * Agent 页面左栏（页面级，非全局侧栏）
 *
 * 自上而下：新建对话主按钮 → Skills/MCP/Model/Agents 管理入口（带角标）
 * → 会话树（分组折叠 + 拖拽排序 + ⋯ 菜单）→ 底部「使用统计」入口。
 * 收起态：新建会话 + 管理图标 + 新建分组，底部使用统计与展开按钮。
 */
const emit = defineEmits<{
  /** 点击管理入口，key 标识目标弹窗 */
  (e: 'open-manager', key: AgentManagerKey): void;
  /** 点击「定时任务」入口：右区切换为定时任务管理视图 */
  (e: 'open-schedule'): void;
  /** 点击「使用统计」入口：右区切换为使用统计看板 */
  (e: 'open-stats'): void;
}>();

const store = useAgentStore();

/** SessionTree 实例（收起态直接唤起其新建分组弹窗） */
const sessionTreeRef = ref<InstanceType<typeof SessionTree> | null>(null);

/** 入口角标（已启用/配置数量，内置常驻项一并计入） */
const BADGE_BY_KEY = computed<Record<AgentManagerKey, number>>(() => ({
  skills: store.counts.skills,
  // 内置 MCP（宿主自带 + 插件贡献）常驻，计入角标
  mcp: store.counts.mcps + listBuiltinMcpServers().length,
  model: store.counts.models,
  // Agents 弹窗同时管理 Agent 配置与 Subagent 库，角标 = 两者之和（含内置 subagent）
  agents: store.counts.profiles + store.subagents.length,
}));

/** 新建对话（未分组，后续可拖入分组） */
const onNewChat = (): void => {
  void store.newSession(null);
};
</script>

<template>
  <!--
    页面级左栏：单容器宽度过渡（w-64 ⇄ w-12），两层内容绝对定位交叉淡入淡出，
    避免 v-if 换分支导致的生硬跳变；inert 保证隐藏层不参与焦点 / 读屏
  -->
  <aside
    class="relative h-full shrink-0 overflow-hidden border-r border-flat-weak bg-surface transition-[width] duration-300 ease-in-out"
    :class="store.sidebarCollapsed ? 'w-12' : 'w-64'"
  >
    <!-- 收起态窄条：新建会话 + 管理入口图标 + 新建分组，展开按钮在底部 -->
    <div
      class="absolute inset-y-0 left-0 flex w-12 flex-col items-center gap-2 py-3 transition-opacity duration-200"
      :class="store.sidebarCollapsed ? 'opacity-100' : 'pointer-events-none opacity-0'"
      :inert="!store.sidebarCollapsed"
    >
      <button
        type="button"
        class="pressable rounded-lg border border-dashed border-flat-weak p-2 text-text-tertiary transition-colors hover:border-primary hover:text-primary"
        aria-label="新建会话"
        @click="onNewChat"
      >
        <MenuIcon name="plus" :size="18" />
      </button>
      <nav class="mt-2 flex flex-col items-center gap-1" aria-label="Agent 管理入口">
        <button
          v-for="entry in AGENT_MANAGER_ENTRIES"
          :key="entry.key"
          type="button"
          class="pressable relative rounded-lg p-2 text-text-tertiary transition-colors hover:bg-flat-weak hover:text-text"
          :title="`${entry.label}（${BADGE_BY_KEY[entry.key]}）`"
          :aria-label="entry.label"
          @click="emit('open-manager', entry.key)"
        >
          <MenuIcon :name="entry.icon" :size="18" />
          <span
            class="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full bg-flat-weak px-1 text-center text-[10px] leading-3.5 text-text-tertiary"
          >
            {{ BADGE_BY_KEY[entry.key] }}
          </span>
        </button>
        <button
          type="button"
          class="pressable rounded-lg p-2 text-text-tertiary transition-colors hover:bg-flat-weak hover:text-text"
          title="定时任务"
          aria-label="定时任务"
          @click="emit('open-schedule')"
        >
          <MenuIcon name="bell" :size="18" />
        </button>
        <button
          type="button"
          class="pressable mt-2 rounded-lg p-2 text-text-tertiary transition-colors hover:bg-flat-weak hover:text-text"
          title="新建分组"
          aria-label="新建分组"
          @click="sessionTreeRef?.openNewGroup()"
        >
          <MenuIcon name="folder" :size="18" />
        </button>
      </nav>
      <!-- 底部：使用统计 + 展开侧栏 -->
      <div class="mt-auto flex flex-col items-center gap-1 pb-1">
        <button
          type="button"
          class="pressable rounded-lg p-2 text-text-tertiary transition-colors hover:bg-flat-weak hover:text-text"
          title="使用统计"
          aria-label="使用统计"
          @click="emit('open-stats')"
        >
          <MenuIcon name="chartBars" :size="18" />
        </button>
        <button
          type="button"
          class="pressable rounded-lg p-2 text-text-tertiary hover:bg-flat-weak hover:text-text"
          aria-label="展开侧栏"
          @click="store.sidebarCollapsed = false"
        >
          <MenuIcon name="panelLeft" :size="18" />
        </button>
      </div>
    </div>

    <!-- 展开态内容（固定 w-64：宽度动画期间文字不换行挤压，仅整体淡入淡出） -->
    <div
      class="absolute inset-y-0 left-0 flex w-64 flex-col transition-opacity duration-200"
      :class="store.sidebarCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'"
      :inert="store.sidebarCollapsed"
    >
      <!-- 新建对话（样式对齐收起态新建会话：虚线描边按钮，默认灰边框、hover 提亮主题色） -->
      <div class="shrink-0 px-3 pt-3">
        <button
          type="button"
          class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-flat-weak py-2 text-xs text-text-tertiary transition-colors hover:border-primary hover:text-primary"
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
        <button
          type="button"
          class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-flat-weak hover:text-text"
          @click="emit('open-schedule')"
        >
          <MenuIcon name="bell" :size="16" class="text-text-tertiary" />
          <span class="flex-1 text-left">定时任务</span>
        </button>
      </nav>

      <!-- 会话树（滚动区；收起态仍挂载，供新建分组弹窗复用） -->
      <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3">
        <div class="flex items-center justify-between px-1.5 pb-1">
          <p class="text-xs font-medium text-text-tertiary">会话</p>
          <button
            type="button"
            class="pressable rounded p-1 text-text-tertiary transition-colors hover:bg-flat-weak hover:text-text"
            title="新建分组"
            aria-label="新建分组"
            @click="sessionTreeRef?.openNewGroup()"
          >
            <MenuIcon name="plus" :size="12" />
          </button>
        </div>
        <SessionTree ref="sessionTreeRef" />
      </div>

      <!-- 底部：使用统计入口（左栏最下，与收起态图标位对应） -->
      <div class="shrink-0 border-t border-flat-weak px-3 py-2">
        <button
          type="button"
          class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-flat-weak hover:text-text"
          @click="emit('open-stats')"
        >
          <MenuIcon name="chartBars" :size="16" class="text-text-tertiary" />
          <span class="flex-1 text-left">使用统计</span>
        </button>
      </div>
    </div>
  </aside>
</template>
