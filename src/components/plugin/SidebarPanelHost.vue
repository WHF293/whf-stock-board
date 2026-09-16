<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { PLUGIN_PANEL_HOST_KEY } from '../../plugin/panel-host';
import { usePluginPanelsStore } from '../../stores/plugin-panels';
import { usePluginStore } from '../../stores/plugin';
import type { RegisteredSidebarPanel } from '../../types/plugin.types';

/**
 * 左侧栏插件面板宿主（inline 形态）
 *
 * 负责三件事：给面板一个可折叠的标题条、把宿主上下文 `provide` 下去
 * （面板据此知道自己怎么被关掉）、响应 `panel:open` 服务发来的「滚动到可视区」请求。
 * 面板本身对内联/抽屉形态无感知，只依赖 `usePluginPanelHost()`。
 */
const props = defineProps<{
  /** 内核注册的侧栏面板 */
  panel: RegisteredSidebarPanel;
}>();

const pluginStore = usePluginStore();
const panelsStore = usePluginPanelsStore();

/** 面板根元素（滚动定位用） */
const rootRef = ref<HTMLElement | null>(null);

/** 是否折叠（默认展开；折叠时**不挂载**面板组件，避免后台白跑轮询） */
const collapsed = computed(() => pluginStore.isPanelCollapsed(props.panel.key));

provide(PLUGIN_PANEL_HOST_KEY, {
  key: props.panel.key,
  mode: 'inline',
  close: (): void => {
    if (!collapsed.value) pluginStore.togglePanelCollapsed(props.panel.key);
  },
});

// 「打开面板」服务：宿主把意图写进 store，这里消费并把面板滚进可视区
watch(
  () => [panelsStore.revealSeq, panelsStore.revealPanelKey] as const,
  ([, key]) => {
    if (key !== props.panel.key) return;
    rootRef.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
);
</script>

<template>
  <section ref="rootRef" class="mt-2">
    <button
      type="button"
      class="pressable flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium text-text-secondary hover:bg-flat-weak hover:text-text active:scale-[0.98]"
      :aria-expanded="!collapsed"
      @click="pluginStore.togglePanelCollapsed(panel.key)"
    >
      <MenuIcon v-if="panel.icon" :name="panel.icon" :size="12" />
      <span class="min-w-0 flex-1 truncate">{{ panel.title }}</span>
      <MenuIcon :name="collapsed ? 'chevronRight' : 'chevronDown'" :size="12" />
    </button>
    <div v-if="!collapsed" class="px-1 pb-1">
      <component :is="panel.component" v-bind="panel.props" />
    </div>
  </section>
</template>
