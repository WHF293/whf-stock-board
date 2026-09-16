<script setup lang="ts">
import { computed, provide } from 'vue';
import BaseDrawer from '../ui/BaseDrawer.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import { pluginKernel } from '../../plugin';
import { PLUGIN_PANEL_HOST_KEY } from '../../plugin/panel-host';
import { usePluginPanelsStore } from '../../stores/plugin-panels';
import { PLUGIN_PANEL_DRAWER_WIDTH } from '../../constants/plugin.constants';

/**
 * 左侧栏插件面板宿主（drawer 形态）
 *
 * `mode: 'drawer'` 的面板在侧栏只留一个入口按钮，内容在这里承载：
 * 抽屉宽度比侧栏宽得多，适合编辑器、配置面板等需要横向空间的内容。
 * 面板组件拿到的宿主上下文 `mode` 为 `drawer`，可据此提供「保存并关闭」等动作。
 */
const panelsStore = usePluginPanelsStore();

/** 当前抽屉里承载的面板（面板被卸载 / 禁用时自动变为 null，抽屉随之关闭） */
const panel = computed(() => {
  void pluginKernel.revision.value;
  const key = panelsStore.drawerPanelKey;
  if (!key) return null;
  return pluginKernel.contributions.sidebar.panels.find((item) => item.key === key) ?? null;
});

/** 抽屉显隐（双向：外部关闭抽屉时同步清掉 store 里的键） */
const open = computed<boolean>({
  get: () => panelsStore.isDrawerOpen && panel.value !== null,
  set: (value: boolean) => {
    if (!value) panelsStore.closeDrawer();
  },
});

provide(PLUGIN_PANEL_HOST_KEY, {
  get key(): string {
    return panel.value?.key ?? '';
  },
  mode: 'drawer',
  close: (): void => panelsStore.closeDrawer(),
});
</script>

<template>
  <BaseDrawer
    v-model:open="open"
    :title="panel?.title ?? '插件面板'"
    :width="PLUGIN_PANEL_DRAWER_WIDTH"
  >
    <component v-if="panel" :is="panel.component" v-bind="panel.props" />
    <BaseEmpty v-else text="面板已不可用" />
  </BaseDrawer>
</template>
