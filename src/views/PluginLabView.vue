<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useIntervalFn } from '@vueuse/core';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseConfirmModal from '../components/ui/BaseConfirmModal.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSwitch from '../components/ui/BaseSwitch.vue';
import BaseTag from '../components/ui/BaseTag.vue';
import PluginInstallModal from '../components/plugin/PluginInstallModal.vue';
import PluginUpdateBar from '../components/plugin/PluginUpdateBar.vue';
import { pluginKernel } from '../plugin';
import { BUILTIN_PLUGINS } from '../plugins';
import { usePlugins } from '../composables/use-plugins';
import { usePluginUpdate } from '../composables/use-plugin-update';
import { useUserPlugins } from '../composables/use-user-plugins';
import {
  PLUGIN_LAB_EVENT_LIMIT,
  PLUGIN_LAB_TICK_MS,
  PLUGIN_STATUS,
  PLUGIN_STATUS_LABEL,
  PLUGIN_STATUS_TONE,
  USER_PLUGIN_INTAKE_UPGRADE_HINT,
  USER_PLUGIN_SOURCE,
  USER_PLUGIN_SOURCE_LABEL,
} from '../constants/plugin.constants';
import {
  PLUGIN_UPDATE_ACTION_BUSY_LABEL,
  PLUGIN_UPDATE_ACTION_LABEL,
  PLUGIN_UPDATE_CHECKING_LABEL,
  PLUGIN_UPDATE_CHECK_LABEL,
  PLUGIN_UPDATE_CONFIRM_ALL_HINT,
  PLUGIN_UPDATE_CONFIRM_ALL_OK,
  PLUGIN_UPDATE_CONFIRM_ALL_TITLE,
  PLUGIN_UPDATE_CONFIRM_CANCEL,
  PLUGIN_UPDATE_CONFIRM_OK,
  PLUGIN_UPDATE_CONFIRM_TITLE,
  PLUGIN_UPDATE_LATEST_LABEL,
  PLUGIN_UPDATE_RELEASE_LINK_LABEL,
  PLUGIN_UPDATE_REPO_LABEL,
  PLUGIN_UPDATE_RETRY_LABEL,
  PLUGIN_UPDATE_SIZE_LABEL,
  PLUGIN_UPDATE_TAG_LABEL,
} from '../constants/plugin-update.constants';
import { formatTime } from '../utils/format-time';
import type { PluginRuntimeInfo } from '../types/plugin.types';
import type { PluginUpdateCandidate } from '../types/plugin-update.types';

/**
 * 速记服务在本页用到的最小结构
 *
 * `note:repo` 是速记插件的**私有服务**（由插件自己声明并 provide，不在宿主契约表里），
 * 宿主这里只声明真正用到的那一个方法 —— 宿主因此不 import 插件源码，插件没装也不影响本页。
 */
interface NoteRepoLike {
  /** 取最近一条速记 */
  latest: () => { text: string } | null;
}

/**
 * 插件工坊（宿主自带页面，正式功能）
 *
 * 本页是插件体系的自省 / 管理窗口：全部数据来自内核运行时的只读句柄
 * （`pluginKernel.reader()`）与服务容器（`pluginKernel.services`），
 * 启停 / 安装 / 卸载直接复用宿主的 composable 与弹窗，管理能力不只在设置页。
 *
 * 它本身**不是插件**：路径与导航由宿主注册（`ROUTE_PATH.PLUGIN_LAB`），
 * 因此不会被停用，也不出现在插件清单里，并作为「插件页随插件撤销」的兜底落点。
 */

const { setEnabled, retry } = usePlugins();
const { records, isUserPlugin, uninstall, pendingDbCleanup, resolveDbCleanup } = useUserPlugins();
const {
  barStatus,
  candidates,
  candidateOf,
  checking,
  busy,
  updatingIds,
  check,
  applyUpdate,
  applyAll,
} = usePluginUpdate();

/** 插件安装弹窗显隐 */
const installModalOpen = ref(false);

/** 当前处于「待确认卸载」状态的插件 id（再次点击才真正卸载） */
const confirmingUninstallId = ref('');

/** 待确认更新的插件 id（空串 = 没有待确认项） */
const pendingUpdateId = ref('');

/** 单包更新确认弹窗显隐 */
const updateConfirmOpen = ref(false);

/** 批量更新确认弹窗显隐 */
const updateAllConfirmOpen = ref(false);

/** 待确认更新的候选（弹窗据此渲染版本变化 / 体积 / 说明） */
const pendingCandidate = computed<PluginUpdateCandidate | undefined>(() =>
  pendingUpdateId.value.length === 0 ? undefined : candidateOf(pendingUpdateId.value),
);

/**
 * 本轮清单的发布页地址（全部更新弹窗「查看更新说明」用）
 *
 * 同一份清单里各项的 `releaseUrl` 相同，取首项即可；候选为空时空串（那时弹窗也不会开）。
 */
const updateReleaseUrl = computed<string>(() => candidates.value[0]?.releaseUrl ?? '');

/** 「检查更新」按钮文案（随状态变化） */
const updateCheckText = computed<string>(() => {
  if (checking.value) return PLUGIN_UPDATE_CHECKING_LABEL;
  if (barStatus.value === 'fail') return PLUGIN_UPDATE_RETRY_LABEL;
  if (barStatus.value === 'latest') return PLUGIN_UPDATE_LATEST_LABEL;
  return PLUGIN_UPDATE_CHECK_LABEL;
});

/** 开工坊静默检查一次（受 30min 冷却约束；手动点按钮才 force 绕过） */
onMounted(() => {
  void check();
});

/** 手动检查更新：绕过冷却期 */
const onCheckUpdate = (): void => {
  void check({ force: true });
};

/**
 * 点某个插件的「更新」：先弹确认，确认后才开始下载
 * @param info 插件运行时信息
 */
const onRequestUpdate = (info: PluginRuntimeInfo): void => {
  if (!candidateOf(info.id)) return;
  pendingUpdateId.value = info.id;
  updateConfirmOpen.value = true;
};

/** 确认更新：关闭弹窗并开始下载安装 */
const onConfirmUpdate = (): void => {
  const id = pendingUpdateId.value;
  pendingUpdateId.value = '';
  if (id.length === 0) return;
  void applyUpdate(id);
};

/** 取消 / 关闭确认弹窗：清掉待确认项 */
const onCancelUpdate = (): void => {
  pendingUpdateId.value = '';
};

/**
 * 提示条「全部更新」：先弹确认（批量也要确认——一样是下载远程代码并执行，
 * 影响面还更大），确认后才串行更新
 */
const onRequestUpdateAll = (): void => {
  if (candidates.value.length === 0) return;
  updateAllConfirmOpen.value = true;
};

/** 确认批量更新：关闭弹窗并开始串行下载安装 */
const onConfirmUpdateAll = (): void => {
  void applyAll();
};

/**
 * 某个插件的「可更新」标签文案（无可更新时返回空串，模板据此不渲染）
 * @param id 插件 id
 * @returns 标签文案
 */
const updateTagOf = (id: string): string => {
  const candidate = candidateOf(id);
  return candidate ? PLUGIN_UPDATE_TAG_LABEL(candidate.latestVersion) : '';
};

/**
 * 插件的安装来源文案（只有用户安装的插件才有；内置插件返回空串）
 * @param id 插件 id
 * @returns 来源文案
 */
const sourceLabel = (id: string): string => {
  const record = records.value.find((item) => item.id === id);
  if (!record) return '';
  const key = (record.source ?? USER_PLUGIN_SOURCE.CODE) as keyof typeof USER_PLUGIN_SOURCE_LABEL;
  const from = USER_PLUGIN_SOURCE_LABEL[key] ?? USER_PLUGIN_SOURCE_LABEL[USER_PLUGIN_SOURCE.CODE];
  return BUILTIN_PLUGINS.some((plugin) => plugin.id === id) ? `${from} · 已接管内置版` : from;
};

/**
 * 请求卸载：第一次点击进入待确认态，第二次点击执行
 * @param info 插件运行时信息
 */
const onUninstall = (info: PluginRuntimeInfo): void => {
  if (confirmingUninstallId.value !== info.id) {
    confirmingUninstallId.value = info.id;
    return;
  }
  confirmingUninstallId.value = '';
  uninstall(info.id);
};

/** 心跳：事件环形缓冲不是响应式的，用 1s tick 驱动「最近事件」刷新 */
const tick = ref(0);
useIntervalFn(() => {
  tick.value += 1;
}, PLUGIN_LAB_TICK_MS);

/** 内核只读句柄（每次 tick / 状态变化后重新取快照） */
const runtime = computed(() => {
  void pluginKernel.revision.value;
  void tick.value;
  return pluginKernel.reader();
});

/** 插件清单 */
const plugins = computed<readonly PluginRuntimeInfo[]>(() => runtime.value.list());

/** 已挂载的插件数量 */
const mountedCount = computed(
  () => plugins.value.filter((item) => item.status === PLUGIN_STATUS.MOUNTED).length,
);

/** 当前生效的服务名列表 */
const services = computed<readonly string[]>(() => runtime.value.listServices());

/** 最近事件（由新到旧） */
const events = computed(() => runtime.value.recentEvents().slice(0, PLUGIN_LAB_EVENT_LIMIT));

/** 全部插件贡献的侧栏面板 */
const panels = computed(() => {
  void pluginKernel.revision.value;
  return [...pluginKernel.contributions.sidebar.panels];
});

/** 全部插件贡献的导航菜单 */
const menus = computed(() => {
  void pluginKernel.revision.value;
  return [...pluginKernel.contributions.menu.items];
});

/** 全部插件贡献的命令 */
const commands = computed(() => {
  void pluginKernel.revision.value;
  return [...pluginKernel.contributions.commands.commands];
});

/** 全部插件贡献的 Agent MCP 服务器 */
const mcpServers = computed(() => {
  void pluginKernel.revision.value;
  return [...pluginKernel.contributions.agent.servers];
});

/**
 * 当前生效的速记服务（由 dsh-quick-note 插件提供，未提供时降级）
 *
 * 宿主页面直接向服务容器取用：插件挂载 / 卸载后重解析一次即可，
 * 不必把实现当作 props 注入（页面也就不再依赖谁来挂载它）。
 */
const noteRepo = computed<NoteRepoLike | undefined>(() => {
  void tick.value;
  void pluginKernel.revision.value;
  return pluginKernel.services.consumeAs<NoteRepoLike>('note:repo');
});

/** 速记服务是否可用（插件被禁用时为 false） */
const noteAvailable = computed(() => noteRepo.value !== undefined);

/** 最近一条速记正文（服务不可用时展示提示） */
const latestNoteText = computed(() => noteRepo.value?.latest()?.text ?? '');

/**
 * 贡献点计数的可读文案
 * @param info 插件运行时信息
 * @returns 形如「面板 1 · 菜单 0 · 命令 1」的摘要
 */
const contributionSummary = (info: PluginRuntimeInfo): string => {
  const {
    sidebarPanels,
    headerItems,
    menuItems,
    routes,
    dockPanels,
    commands,
    stockRowActions,
    stockDetailSections,
    agentServers,
  } = info.contributions;
  return [
    `侧栏面板 ${sidebarPanels}`,
    `顶栏条目 ${headerItems}`,
    `菜单 ${menuItems}`,
    `路由 ${routes}`,
    `停靠面板 ${dockPanels}`,
    `命令 ${commands}`,
    `行操作 ${stockRowActions}`,
    `详情扩展 ${stockDetailSections}`,
    `MCP ${agentServers}`,
  ].join(' · ');
};
</script>

<template>
  <div class="space-y-4">
    <BaseCard title="内核概览">
      <div class="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        <div class="rounded-card bg-flat-weak px-3 py-2">
          <p class="text-xs text-text-tertiary">已注册插件</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-text">{{ plugins.length }}</p>
        </div>
        <div class="rounded-card bg-flat-weak px-3 py-2">
          <p class="text-xs text-text-tertiary">已挂载</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-text">{{ mountedCount }}</p>
        </div>
        <div class="rounded-card bg-flat-weak px-3 py-2">
          <p class="text-xs text-text-tertiary">生效服务</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-text">{{ services.length }}</p>
        </div>
        <div class="rounded-card bg-flat-weak px-3 py-2">
          <p class="text-xs text-text-tertiary">侧栏面板</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-text">{{ panels.length }}</p>
        </div>
      </div>
      <p class="mt-3 text-xs text-text-tertiary">
        开关即时生效：卸载一个插件等于撤销它的全部贡献，无需重启应用。
      </p>
    </BaseCard>

    <BaseCard title="插件清单">
      <div class="mb-3 flex items-center justify-between gap-4">
        <p class="text-xs text-text-tertiary">在工坊里直接启停、安装与卸载插件</p>
        <div class="flex shrink-0 items-center gap-2">
          <BaseButton
            variant="ghost"
            :disabled="busy"
            data-track="PLUGIN_UPDATE_CHECK"
            @click="onCheckUpdate"
          >
            {{ updateCheckText }}
          </BaseButton>
          <BaseButton
            variant="ghost"
            data-track="PLUGIN_INSTALL_OPEN"
            @click="installModalOpen = true"
          >
            安装插件
          </BaseButton>
        </div>
      </div>
      <PluginUpdateBar
        :status="barStatus"
        :candidates="candidates"
        :busy="busy"
        @check="onCheckUpdate"
        @update-all="onRequestUpdateAll"
      />
      <div v-if="pendingDbCleanup" class="mb-3 rounded-card border border-flat-weak px-3 py-2.5">
        <p class="text-xs text-text-secondary">
          「{{ pendingDbCleanup.pluginName }}」已卸载。它在本地数据库有
          {{ pendingDbCleanup.tables.length }} 张数据表
          （{{ pendingDbCleanup.tables.join('、') }}），是否一并删除？
        </p>
        <div class="mt-2 flex justify-end gap-2">
          <BaseButton variant="ghost" @click="resolveDbCleanup(false)">保留数据</BaseButton>
          <BaseButton variant="danger" @click="resolveDbCleanup(true)">一并删除</BaseButton>
        </div>
      </div>
      <ul class="space-y-2">
        <li
          v-for="info in plugins"
          :key="info.id"
          class="rounded-card border border-flat-weak px-3 py-2.5"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-text">{{ info.name }}</span>
              <BaseTag :tone="PLUGIN_STATUS_TONE[info.status]">
                {{ PLUGIN_STATUS_LABEL[info.status] }}
              </BaseTag>
              <span class="text-xs text-text-tertiary">v{{ info.version }}</span>
              <BaseTag v-if="updateTagOf(info.id)" tone="primary">
                {{ updateTagOf(info.id) }}
              </BaseTag>
              <span class="text-xs text-text-tertiary">{{ info.id }}</span>
            </div>
            <BaseSwitch
              :model-value="info.status !== PLUGIN_STATUS.DISABLED"
              data-track="PLUGIN_TOGGLE"
              @update:model-value="(value: boolean) => setEnabled(info.id, value)"
            />
          </div>
          <p class="mt-1 text-xs text-text-secondary">{{ info.description }}</p>
          <p class="mt-1 text-xs text-text-tertiary">{{ contributionSummary(info) }}</p>
          <p v-if="info.inject.length > 0" class="mt-1 text-xs text-text-tertiary">
            依赖：{{ info.inject.join('、') }}
          </p>
          <div v-if="info.status === PLUGIN_STATUS.FAILED" class="mt-2 flex items-center gap-2">
            <p class="min-w-0 flex-1 break-words text-xs text-up">挂载失败：{{ info.error }}</p>
            <BaseButton variant="ghost" @click="retry(info.id)">重试</BaseButton>
          </div>
          <div
            v-if="isUserPlugin(info.id)"
            class="mt-2 flex items-center justify-end gap-2 border-t border-flat-weak pt-2"
          >
            <p class="min-w-0 flex-1 text-xs text-text-tertiary">
              {{ sourceLabel(info.id) }} · 卸载后移除插件代码（本地数据保留，重装后接着用）
            </p>
            <BaseButton
              v-if="candidateOf(info.id)"
              variant="ghost"
              :disabled="busy"
              @click="onRequestUpdate(info)"
            >
              {{ updatingIds.includes(info.id) ? PLUGIN_UPDATE_ACTION_BUSY_LABEL : PLUGIN_UPDATE_ACTION_LABEL }}
            </BaseButton>
            <BaseButton
              :variant="confirmingUninstallId === info.id ? 'danger' : 'ghost'"
              @click="onUninstall(info)"
            >
              {{ confirmingUninstallId === info.id ? '确认卸载' : '卸载' }}
            </BaseButton>
          </div>
          <p v-else class="mt-2 border-t border-flat-weak pt-2 text-xs text-text-tertiary">
            内置插件 · 随应用分发，只能启停，不能卸载
          </p>
        </li>
      </ul>
      <BaseEmpty v-if="plugins.length === 0" text="没有任何插件" />
    </BaseCard>

    <BaseCard title="贡献点总览">
      <div class="space-y-4">
        <div>
          <p class="mb-1.5 text-xs font-medium text-text-secondary">
            左侧栏面板（{{ panels.length }}）
          </p>
          <ul v-if="panels.length > 0" class="space-y-1">
            <li
              v-for="panel in panels"
              :key="panel.key"
              class="flex items-center gap-2 text-xs text-text-secondary"
            >
              <BaseTag tone="flat">{{ panel.mode }}</BaseTag>
              <span class="text-text">{{ panel.title }}</span>
              <span class="text-text-tertiary">{{ panel.key }}</span>
            </li>
          </ul>
          <BaseEmpty v-else text="暂无插件面板" />
        </div>

        <div class="border-t border-flat-weak pt-3">
          <p class="mb-1.5 text-xs font-medium text-text-secondary">
            导航菜单（{{ menus.length }}）
          </p>
          <ul v-if="menus.length > 0" class="space-y-1">
            <li
              v-for="item in menus"
              :key="item.key"
              class="flex items-center gap-2 text-xs text-text-secondary"
            >
              <span class="text-text">{{ item.title }}</span>
              <span class="text-text-tertiary">{{ item.path }}</span>
            </li>
          </ul>
          <BaseEmpty v-else text="暂无插件菜单" />
        </div>

        <div class="border-t border-flat-weak pt-3">
          <p class="mb-1.5 text-xs font-medium text-text-secondary">
            命令（{{ commands.length }}）
          </p>
          <ul v-if="commands.length > 0" class="space-y-1">
            <li
              v-for="command in commands"
              :key="command.key"
              class="flex items-center gap-2 text-xs text-text-secondary"
            >
              <kbd
                v-if="command.keys"
                class="rounded border border-flat-weak bg-flat-weak px-1.5 py-0.5 font-semibold text-text"
              >
                {{ command.keys }}
              </kbd>
              <span class="text-text">{{ command.title }}</span>
            </li>
          </ul>
          <BaseEmpty v-else text="暂无插件命令" />
        </div>

        <div class="border-t border-flat-weak pt-3">
          <p class="mb-1.5 text-xs font-medium text-text-secondary">
            Agent 工具（{{ mcpServers.length }}）
          </p>
          <ul v-if="mcpServers.length > 0" class="space-y-1">
            <li
              v-for="server in mcpServers"
              :key="server.key"
              class="flex items-center gap-2 text-xs text-text-secondary"
            >
              <span class="text-text">{{ server.name }}</span>
              <span class="text-text-tertiary">{{ server.tools.length }} 个工具</span>
            </li>
          </ul>
          <BaseEmpty v-else text="暂无插件提供的 MCP 工具" />
        </div>
      </div>
    </BaseCard>

    <BaseCard title="跨插件服务">
      <p class="text-xs text-text-tertiary">当前生效的服务名</p>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <BaseTag v-for="name in services" :key="name" tone="flat">{{ name }}</BaseTag>
      </div>
      <div class="mt-4 border-t border-flat-weak pt-3">
        <p class="text-xs font-medium text-text-secondary">note:repo（由「速记」插件提供）</p>
        <p v-if="noteAvailable" class="mt-1 whitespace-pre-wrap break-words text-sm text-text">
          {{ latestNoteText || '（还没有速记）' }}
        </p>
        <p v-else class="mt-1 text-xs text-text-tertiary">
          未提供：启用「速记」插件后本卡片会读取到它的最近一条速记。
        </p>
      </div>
    </BaseCard>

    <BaseCard title="最近事件">
      <ul v-if="events.length > 0" class="space-y-1">
        <li
          v-for="(event, index) in events"
          :key="`${event.name}-${event.at}-${index}`"
          class="flex items-center gap-2 text-xs text-text-secondary"
        >
          <span class="w-16 shrink-0 tabular-nums text-text-tertiary">
            {{ formatTime(event.at) }}
          </span>
          <span class="text-text">{{ event.name }}</span>
          <span v-if="event.source" class="text-text-tertiary">{{ event.source }}</span>
        </li>
      </ul>
      <BaseEmpty v-else text="暂无事件" />
    </BaseCard>

    <!-- 插件安装弹窗：zip 包批量入队即自动解析（六步进度 + 包间冲突仲裁）→ 单装 / 批量装；
         粘贴代码走「解析预览 → 确认安装」（与设置页共用同一组件） -->
    <PluginInstallModal v-model:open="installModalOpen" />

    <!-- 更新确认弹窗：必须先确认再下载（否则用户一点「更新」就静默装了远程代码） -->
    <BaseConfirmModal
      v-model:open="updateConfirmOpen"
      :title="pendingCandidate ? PLUGIN_UPDATE_CONFIRM_TITLE(pendingCandidate.name) : ''"
      :ok-text="PLUGIN_UPDATE_CONFIRM_OK"
      :cancel-text="PLUGIN_UPDATE_CONFIRM_CANCEL"
      max-width-class="max-w-lg"
      @ok="onConfirmUpdate"
      @cancel="onCancelUpdate"
    >
      <div v-if="pendingCandidate" class="space-y-2">
        <p class="text-text">
          v{{ pendingCandidate.currentVersion }} → v{{ pendingCandidate.latestVersion }}
        </p>
        <p class="text-xs text-text-tertiary">
          体积 {{ PLUGIN_UPDATE_SIZE_LABEL(pendingCandidate.zipSize) }} ·
          来源 {{ PLUGIN_UPDATE_REPO_LABEL }}
        </p>
        <p v-if="pendingCandidate.changelog" class="whitespace-pre-wrap break-words">
          {{ pendingCandidate.changelog }}
        </p>
        <p class="text-xs text-text-secondary">
          {{
            USER_PLUGIN_INTAKE_UPGRADE_HINT(
              pendingCandidate.currentVersion,
              pendingCandidate.latestVersion,
            )
          }}
        </p>
        <a
          v-if="pendingCandidate.releaseUrl"
          :href="pendingCandidate.releaseUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="block text-xs text-primary underline underline-offset-2"
        >
          {{ PLUGIN_UPDATE_RELEASE_LINK_LABEL }}
        </a>
      </div>
    </BaseConfirmModal>

    <!-- 批量更新确认弹窗：与单包确认同一口径（都要下远程代码），列出每个插件的版本变化 -->
    <BaseConfirmModal
      v-model:open="updateAllConfirmOpen"
      :title="PLUGIN_UPDATE_CONFIRM_ALL_TITLE(candidates.length)"
      :ok-text="PLUGIN_UPDATE_CONFIRM_ALL_OK(candidates.length)"
      :cancel-text="PLUGIN_UPDATE_CONFIRM_CANCEL"
      max-width-class="max-w-lg"
      @ok="onConfirmUpdateAll"
    >
      <div v-if="candidates.length > 0" class="space-y-2">
        <ul class="space-y-1">
          <li
            v-for="candidate in candidates"
            :key="candidate.id"
            class="flex items-baseline justify-between gap-3"
          >
            <span class="min-w-0 truncate text-text">{{ candidate.name }}</span>
            <span class="shrink-0 text-xs text-text-tertiary">
              v{{ candidate.currentVersion }} → v{{ candidate.latestVersion }}
            </span>
          </li>
        </ul>
        <p class="text-xs text-text-secondary">{{ PLUGIN_UPDATE_CONFIRM_ALL_HINT }}</p>
        <a
          v-if="updateReleaseUrl"
          :href="updateReleaseUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="block text-xs text-primary underline underline-offset-2"
        >
          {{ PLUGIN_UPDATE_RELEASE_LINK_LABEL }}
        </a>
      </div>
    </BaseConfirmModal>
  </div>
</template>
