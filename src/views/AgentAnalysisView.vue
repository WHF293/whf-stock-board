<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { useAgentStore } from '@/stores/agent';
import type { AgentManagerKey } from '@/types/agent.types';
import AgentSidebar from '@/components/agent/AgentSidebar.vue';
import ChatPanel from '@/components/agent/ChatPanel.vue';
import ModelManageModal from '@/components/agent/ModelManageModal.vue';
import SkillManageModal from '@/components/agent/SkillManageModal.vue';
import McpManageModal from '@/components/agent/McpManageModal.vue';
import AgentProfileManageModal from '@/components/agent/AgentProfileManageModal.vue';

/**
 * Agent 分析页（方案 §4：页面级双栏布局）
 *
 * - 浏览器端整页降级提示（Agent 运行时依赖 Tauri：SQLite / http fetch / fs）；
 * - 左栏 AgentSidebar（新建对话 + 管理入口 + 会话树）+ 右侧 ChatPanel；
 * - 四个管理弹窗（Skills / MCP / Model / Agents）均为真 CRUD 落库；
 * - standalone（独立 WebviewWindow）：占满整个 webview（h-dvh、无圆角卡片边距）
 */
defineProps<{
  /** 独立窗口模式（/agent-window 路由注入）：高度撑满 webview、去卡片圆角 */
  standalone?: boolean;
}>();

const store = useAgentStore();

/** 当前 Tauri 环境（模块级判定即可，运行中不会切换） */
const tauriAvailable = isTauri();

/** 打开中的管理弹窗 key（null 关闭） */
const openManager = ref<AgentManagerKey | null>(null);

/**
 * 关闭管理弹窗（BaseModal @update:open 回调）
 * @param value false = 请求关闭
 */
const onManagerOpenChange = (value: boolean): void => {
  if (!value) openManager.value = null;
};

onMounted(() => {
  if (tauriAvailable) {
    void store.init();
  }
});
</script>

<template>
  <!-- 浏览器端降级提示 -->
  <div
    v-if="!tauriAvailable"
    class="flex items-center justify-center border border-flat-weak bg-surface"
    :class="standalone ? 'h-dvh' : 'h-[calc(100dvh-6.5rem)] rounded-2xl'"
  >
    <div class="max-w-sm text-center">
      <p class="text-base font-medium text-text">Agent 分析仅 Tauri 桌面端可用</p>
      <p class="mt-2 text-sm text-text-tertiary">
        对话数据本地 SQLite、模型直连与 Skills 文件系统均依赖桌面端能力
      </p>
    </div>
  </div>

  <!-- 桌面端：页面级双栏（定高卡片：撑满可视区，输入框始终贴底）；standalone 占满 webview -->
  <div
    v-else
    class="flex min-h-0 overflow-hidden border border-flat-weak bg-surface shadow-sm"
    :class="standalone ? 'h-dvh' : 'h-[calc(100dvh-6.5rem)] rounded-2xl'"
  >
    <AgentSidebar @open-manager="openManager = $event" />
    <ChatPanel @open-manager="openManager = $event" />

    <!-- 管理弹窗（Skills / MCP / Model / Agents） -->
    <ModelManageModal
      :open="openManager === 'model'"
      @update:open="onManagerOpenChange"
    />
    <SkillManageModal
      :open="openManager === 'skills'"
      @update:open="onManagerOpenChange"
    />
    <McpManageModal
      :open="openManager === 'mcp'"
      @update:open="onManagerOpenChange"
    />
    <AgentProfileManageModal
      :open="openManager === 'agents'"
      @update:open="onManagerOpenChange"
    />
  </div>
</template>
