<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { useAgentStore } from '@/stores/agent';
import { useScheduleStore } from '@/stores/schedule';
import type { AgentManagerKey } from '@/types/agent.types';
import AgentSidebar from '@/components/agent/AgentSidebar.vue';
import ChatPanel from '@/components/agent/ChatPanel.vue';
import ScheduleManagerView from '@/components/agent/ScheduleManagerView.vue';
import ModelManageModal from '@/components/agent/ModelManageModal.vue';
import SkillManageModal from '@/components/agent/SkillManageModal.vue';
import McpManageModal from '@/components/agent/McpManageModal.vue';
import AgentProfileManageModal from '@/components/agent/AgentProfileManageModal.vue';

/**
 * Agent 分析页（方案 §4：页面级双栏布局）
 *
 * - 浏览器端整页降级提示（Agent 运行时依赖 Tauri：SQLite / http fetch / fs）；
 * - 左栏 AgentSidebar（新建对话 + 管理入口 + 定时任务入口 + 会话树）+ 右侧主区：
 *   对话视图（ChatPanel）与定时任务管理视图（ScheduleManagerView）二选一渲染；
 * - ChatPanel 用 v-show 保留运行状态（切去任务页不打断进行中的对话），
 *   任务管理页用 v-if 按需挂载；四个管理弹窗均为真 CRUD 落库；
 * - standalone（独立 WebviewWindow）：占满整个 webview（h-dvh、无圆角卡片边距）
 */
defineProps<{
  /** 独立窗口模式（/agent-window 路由注入）：高度撑满 webview、去卡片圆角 */
  standalone?: boolean;
}>();

const store = useAgentStore();
const scheduleStore = useScheduleStore();

/** 当前 Tauri 环境（模块级判定即可，运行中不会切换） */
const tauriAvailable = isTauri();

/** 右区视图模式：chat 对话 / schedule 定时任务管理 */
const viewMode = ref<'chat' | 'schedule'>('chat');

/** ChatPanel 实例（跳转任务会话时强制重读消息，见 onOpenSession） */
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);

/** 打开中的管理弹窗 key（null 关闭） */
const openManager = ref<AgentManagerKey | null>(null);

/**
 * 关闭管理弹窗（BaseModal @update:open 回调）
 * @param value false = 请求关闭
 */
const onManagerOpenChange = (value: boolean): void => {
  if (!value) openManager.value = null;
};

/**
 * 从任务卡片跳转绑定会话：切回对话视图 + 选中会话 + 强制重读消息
 * （任务执行的消息由调度器旁路落库，缓存命中守卫会让常规切换读不到）
 * @param sessionId 任务绑定会话 id
 */
const onOpenSession = (sessionId: number): void => {
  store.currentSessionId = sessionId;
  viewMode.value = 'chat';
  void chatPanelRef.value?.reloadSession(sessionId);
};

onMounted(() => {
  if (tauriAvailable) {
    void store.init();
    // 定时任务：恢复列表 + 启动心跳（幂等；随应用生命周期常驻）
    void scheduleStore.init().then(() => scheduleStore.startTicker());
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
    <AgentSidebar @open-manager="openManager = $event" @open-schedule="viewMode = 'schedule'" />

    <!-- 右区主视图：对话（v-show 保留运行状态） / 定时任务管理（v-if 按需挂载） -->
    <ChatPanel v-show="viewMode === 'chat'" ref="chatPanelRef" @open-manager="openManager = $event" />
    <ScheduleManagerView
      v-if="viewMode === 'schedule'"
      @back="viewMode = 'chat'"
      @open-session="onOpenSession"
    />

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
