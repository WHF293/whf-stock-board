<script setup lang="ts">
import { ref } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseModal from '../ui/BaseModal.vue';
import BaseSwitch from '../ui/BaseSwitch.vue';
import BaseTag from '../ui/BaseTag.vue';
import { usePlugins } from '../../composables/use-plugins';
import { useUserPlugins } from '../../composables/use-user-plugins';
import {
  PLUGIN_STATUS,
  PLUGIN_STATUS_LABEL,
  PLUGIN_STATUS_TONE,
} from '../../constants/plugin.constants';
import type { PluginRuntimeInfo } from '../../types/plugin.types';

/**
 * 插件管理弹窗
 *
 * 启停是**即时**的：关闭插件立刻撤销它的侧栏面板 / 菜单 / 路由 / 命令 / MCP 工具，
 * 重新打开则重新挂载，全程不需要重启应用 —— 这是「一切皆插件 + 可逆副作用」的直接收益。
 * 用户插件（应用内安装）额外有「卸载」：从持久化移除代码并注销插件，两段确认防误触。
 */
const open = defineModel<boolean>('open', { required: true });

const { plugins, mountedCount, setEnabled, retry } = usePlugins();
const { isUserPlugin, uninstall, pendingDbCleanup, resolveDbCleanup } = useUserPlugins();

/** 当前处于「待确认卸载」状态的插件 id（再次点击才真正卸载） */
const confirmingUninstallId = ref('');

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

/**
 * 贡献点计数的可读文案
 * @param info 插件运行时信息
 * @returns 形如「侧栏面板 1 · 命令 1」的摘要
 */
const contributionSummary = (info: PluginRuntimeInfo): string => {
  const {
    sidebarPanels,
    menuItems,
    routes,
    dockPanels,
    commands,
    stockRowActions,
    agentServers,
  } = info.contributions;
  const parts = [
    sidebarPanels > 0 ? `侧栏面板 ${sidebarPanels}` : '',
    menuItems > 0 ? `菜单 ${menuItems}` : '',
    routes > 0 ? `路由 ${routes}` : '',
    dockPanels > 0 ? `停靠面板 ${dockPanels}` : '',
    commands > 0 ? `命令 ${commands}` : '',
    stockRowActions > 0 ? `行操作 ${stockRowActions}` : '',
    agentServers > 0 ? `MCP 工具集 ${agentServers}` : '',
  ].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(' · ') : '无贡献点';
};
</script>

<template>
  <BaseModal v-model:open="open" title="插件管理" max-width-class="max-w-xl">
    <p class="mb-3 text-xs text-text-tertiary">
      共 {{ plugins.length }} 个插件，已挂载 {{ mountedCount }} 个。关闭插件会立即撤销它贡献的面板、菜单、路由与命令；
      依赖它的插件会转为「等待依赖」。
    </p>

    <div
      v-if="pendingDbCleanup"
      class="mb-3 rounded-card border border-flat-weak px-3 py-2.5"
    >
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

    <BaseEmpty v-if="plugins.length === 0" text="没有任何插件" />

    <ul v-else class="space-y-2">
      <li
        v-for="info in plugins"
        :key="info.id"
        class="rounded-card border border-flat-weak px-3 py-2.5"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-text">{{ info.name }}</span>
              <BaseTag :tone="PLUGIN_STATUS_TONE[info.status]">
                {{ PLUGIN_STATUS_LABEL[info.status] }}
              </BaseTag>
              <span class="text-xs text-text-tertiary">v{{ info.version }}</span>
            </div>
            <p class="mt-1 text-xs text-text-tertiary">{{ info.id }} · {{ info.author }}</p>
          </div>
          <BaseSwitch
            :model-value="info.status !== PLUGIN_STATUS.DISABLED"
            @update:model-value="(value: boolean) => setEnabled(info.id, value)"
          />
        </div>

        <p class="mt-2 text-xs text-text-secondary">{{ info.description }}</p>
        <p class="mt-1 text-xs text-text-tertiary">{{ contributionSummary(info) }}</p>
        <p v-if="info.inject.length > 0" class="mt-1 text-xs text-text-tertiary">
          依赖插件：{{ info.inject.join('、') }}
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
            卸载后移除插件代码（插件产生的本地数据保留，重装后恢复）
          </p>
          <BaseButton
            :variant="confirmingUninstallId === info.id ? 'danger' : 'ghost'"
            @click="onUninstall(info)"
          >
            {{ confirmingUninstallId === info.id ? '确认卸载' : '卸载' }}
          </BaseButton>
        </div>
      </li>
    </ul>
  </BaseModal>
</template>
