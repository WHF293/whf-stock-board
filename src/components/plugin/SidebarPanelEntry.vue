<script setup lang="ts">
import MenuIcon from '../ui/MenuIcon.vue';
import BaseTooltip from '../ui/BaseTooltip.vue';
import { usePluginPanelsStore } from '../../stores/plugin-panels';
import { trackAction } from '../../weblog/weblogActions';
import type { RegisteredSidebarPanel } from '../../types/plugin.types';

/**
 * 插件面板入口按钮（drawer 形态面板在左侧栏里的入口）
 *
 * 与 `SidebarPanelHost`（inline 形态）配套：drawer 面板内容在右侧抽屉里，
 * 侧栏这里只需要一个能唤起它的入口，形态与「设置」入口保持一致。
 */
const props = defineProps<{
  /** 内核注册的侧栏面板 */
  panel: RegisteredSidebarPanel;
  /** 侧栏是否处于收起（仅图标）状态 */
  collapsed: boolean;
}>();

const panelsStore = usePluginPanelsStore();

/** 打开该面板的抽屉（并记一条行为埋点） */
const onOpen = (): void => {
  trackAction('PLUGIN_PANEL_OPEN', { target: props.panel.key, detail: props.panel.title });
  panelsStore.openDrawer(props.panel.key);
};
</script>

<template>
  <button
    type="button"
    class="pressable group relative flex items-center gap-2 rounded-lg py-1 text-xs text-text-secondary hover:bg-flat-weak hover:text-text active:scale-[0.98]"
    :class="collapsed ? 'justify-center px-1' : 'px-1'"
    :aria-label="panel.title"
    @click="onOpen"
  >
    <MenuIcon :name="panel.icon || 'menu'" :size="14" />
    <span v-if="!collapsed" class="truncate">{{ panel.title }}</span>
    <BaseTooltip v-if="collapsed" :text="panel.title" />
  </button>
</template>
