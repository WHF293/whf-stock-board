<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { useAgentStore } from '@/stores/agent';
import { useScheduleStore } from '@/stores/schedule';
import { useNotificationsStore } from '@/stores/notifications';
import { NOTIFY_TONE } from '@/constants/notify.constants';
import {
  consumePendingAgentAsk,
  listenAgentAsk,
  notifyAgentReady,
} from '@/agent/agent-bridge';
import type { AgentManagerKey } from '@/types/agent.types';
import AgentSidebar from '@/components/agent/AgentSidebar.vue';
import ChatPanel from '@/components/agent/ChatPanel.vue';
import ScheduleManagerView from '@/components/agent/ScheduleManagerView.vue';
import UsageStatsView from '@/components/agent/UsageStatsView.vue';
import AgentWindowTitlebar from '@/components/agent/AgentWindowTitlebar.vue';
import NotificationHost from '@/components/ui/NotificationHost.vue';
import ModelManageModal from '@/components/agent/ModelManageModal.vue';
import SkillManageModal from '@/components/agent/SkillManageModal.vue';
import McpManageModal from '@/components/agent/McpManageModal.vue';
import AgentProfileManageModal from '@/components/agent/AgentProfileManageModal.vue';

/**
 * Agent 分析页（方案 §4：页面级双栏布局）
 *
 * - 浏览器端整页降级提示（Agent 运行时依赖 Tauri：SQLite / http fetch / fs）；
 * - 左栏 AgentSidebar（新建对话 + 管理入口 + 定时任务入口 + 会话树 + 使用统计）+ 右侧主区：
 *   对话视图（ChatPanel）、定时任务管理（ScheduleManagerView）与使用统计看板
 *   （UsageStatsView）三选一渲染；
 * - ChatPanel 用 v-show 保留运行状态（切去任务页 / 统计页不打断进行中的对话），
 *   任务管理页与统计页用 v-if 按需挂载；四个管理弹窗均为真 CRUD 落库；
 * - standalone（独立 WebviewWindow）：decorations:false + 自定义标题栏
 *   （AgentWindowTitlebar，与主窗口同款交互），并挂 NotificationHost——
 *   通知浮窗宿主只在 MainLayout 渲染过，独立窗口不经 MainLayout，必须自带一份
 *   （复制成功 / 任务导入等 toast 才有容器；内嵌模式不挂，避免与 MainLayout 双份）
 */
defineProps<{
  /** 独立窗口模式（/agent-window 路由注入）：高度撑满 webview、去卡片圆角 */
  standalone?: boolean;
}>();

const store = useAgentStore();
const scheduleStore = useScheduleStore();
const notifications = useNotificationsStore();

/** 当前 Tauri 环境（模块级判定即可，运行中不会切换） */
const tauriAvailable = isTauri();

/** 右区视图模式：chat 对话 / schedule 定时任务管理 / stats 使用统计看板 */
const viewMode = ref<'chat' | 'schedule' | 'stats'>('chat');

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

/**
 * 消费一条外部「AI 分析」请求（跨窗口事件 / 浏览器回退暂存）：
 * 切回对话视图；未配置模型 → 浮窗提示 + 自动打开 Model 管理；
 * 已配置 → 经 ChatPanel.askAgent 直发（运行中自动退化为预填草稿）
 * @param prompt 完整提示词
 */
const handleAgentAsk = (prompt: string): void => {
  viewMode.value = 'chat';
  if (store.models.length === 0) {
    openManager.value = 'model';
    notifications.push({
      title: '当前没有配置过模型',
      body: '请在 Model 管理中添加模型并设为默认后，回到原页面重新发起 AI 分析',
      tone: NOTIFY_TONE.FLAT,
    });
    return;
  }
  chatPanelRef.value?.askAgent(prompt);
};

onMounted(() => {
  if (tauriAvailable) {
    // 先 init 再广播就绪：主窗口握手方收到回执才投递请求，保证 models 已加载
    void store.init().then(async () => {
      await listenAgentAsk(handleAgentAsk);
      await notifyAgentReady();
    });
    // 定时任务：恢复列表 + 启动心跳（幂等；随应用生命周期常驻）
    void scheduleStore.init().then(() => scheduleStore.startTicker());
  }
  // 浏览器回退路径：同窗路由跳转后取走暂存请求（init 幂等，就绪后再消费）
  const pending = consumePendingAgentAsk();
  if (pending !== null) void store.init().then(() => handleAgentAsk(pending));
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

  <!-- 桌面端：standalone 独立窗口 = 自定义标题栏 + 内容区；内嵌 = 原定高卡片 -->
  <div
    v-else
    class="flex min-h-0 flex-col"
    :class="standalone ? 'h-dvh' : 'h-[calc(100dvh-6.5rem)]'"
  >
    <!-- 独立窗口标题栏（decorations:false，主窗口同款三键与拖拽；内嵌不渲染） -->
    <AgentWindowTitlebar v-if="standalone" />

    <!-- 内容区双栏：standalone 占满余下高度；内嵌保留卡片圆角与边框 -->
    <div
      class="flex min-h-0 flex-1 overflow-hidden bg-surface"
      :class="standalone ? '' : 'rounded-2xl border border-flat-weak shadow-sm'"
    >
      <AgentSidebar
        @open-manager="openManager = $event"
        @open-schedule="viewMode = 'schedule'"
        @open-stats="viewMode = 'stats'"
      />

      <!-- 右区主视图：对话（v-show 保留运行状态） / 定时任务管理、使用统计（v-if 按需挂载） -->
      <ChatPanel v-show="viewMode === 'chat'" ref="chatPanelRef" @open-manager="openManager = $event" />
      <ScheduleManagerView
        v-if="viewMode === 'schedule'"
        @back="viewMode = 'chat'"
        @open-session="onOpenSession"
      />
      <UsageStatsView v-if="viewMode === 'stats'" @back="viewMode = 'chat'" />

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

    <!-- 独立窗口自带通知浮窗宿主（MainLayout 的只在主窗口存在） -->
    <NotificationHost v-if="standalone" />
  </div>
</template>
