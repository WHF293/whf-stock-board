<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import MenuIcon from '../ui/MenuIcon.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import StockDetailPanel from './StockDetailPanel.vue';
import { pluginKernel } from '../../plugin';
import {
  DOCK_PANEL_WIDTH_MAX_RATIO,
  DOCK_PANEL_CONTENT,
} from '../../constants/dock-panel.constants';
import { ROUTE_PATH } from '../../constants/router-meta.constants';
import { useDockPanelStore } from '../../stores/dock-panel';

/**
 * 右侧停靠面板容器：头部（标题 + 关闭）+ 内容分发
 *
 * 面板宽度 375px ~ 60vw（store 内 clamp），宽度经 pinia persist 持久化；
 * 拖拽手柄与贯穿竖线由 StockDetailPanel 在主区左缘渲染（更贴近主区、避免遮挡内容）
 *
 * 内容分两类：宿主的个股详情，以及插件贡献的停靠面板
 * （插件经 `ctx.dock.add()` 注册，store 里只存面板全局键）。
 */
const dockPanel = useDockPanelStore();
const router = useRouter();

/** 当前插件停靠面板（面板被卸载 / 插件被禁用时自动失效，降级为空态） */
const pluginPanel = computed(() => {
  void pluginKernel.revision.value;
  if (dockPanel.content !== DOCK_PANEL_CONTENT.PLUGIN) return null;
  return (
    pluginKernel.contributions.dock.panels.find(
      (panel) => panel.key === dockPanel.pluginPanelKey,
    ) ?? null
  );
});

/**
 * 跳转股票详情整页：关闭面板后路由跳转（全站双击同款行为）
 */
const openDetailPage = (): void => {
  if (dockPanel.content !== DOCK_PANEL_CONTENT.STOCK || !dockPanel.symbol) return;
  const symbol = dockPanel.symbol;
  dockPanel.close();
  void router.push(`${ROUTE_PATH.STOCK_DETAIL}/${symbol}`);
};

/** 面板头部标题（个股详情用固定文案；插件面板用其声明标题） */
const panelTitle = computed(() => {
  if (dockPanel.content === DOCK_PANEL_CONTENT.STOCK) return '个股详情';
  if (dockPanel.content === DOCK_PANEL_CONTENT.PLUGIN) return pluginPanel.value?.title ?? '插件面板';
  return '';
});

/**
 * Esc 关闭面板
 * @param event 键盘事件
 */
const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && dockPanel.open) {
    dockPanel.close();
  }
};

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <aside
    v-if="dockPanel.open"
    class="dock-panel relative flex flex-col border-l border-flat-weak bg-surface"
    :style="{ width: `min(${dockPanel.width}px, ${Math.round(DOCK_PANEL_WIDTH_MAX_RATIO * 100)}vw)` }"
  >
    <!-- 头部：标题 + 关闭 -->
    <header class="flex h-11 shrink-0 items-center justify-between border-b border-flat-weak pl-4 pr-1">
      <h2 class="text-sm font-semibold text-text">{{ panelTitle }}</h2>
      <div class="flex items-center">
        <button
          v-if="dockPanel.content === DOCK_PANEL_CONTENT.STOCK"
          type="button"
          class="pressable rounded-lg p-2 text-text-secondary hover:bg-flat-weak hover:text-text active:scale-90"
          aria-label="在详情页打开"
          title="打开详情页"
          @click="openDetailPage"
        >
          <MenuIcon name="expand" :size="16" />
        </button>
        <button
          type="button"
          class="pressable rounded-lg p-2 text-text-secondary hover:bg-flat-weak hover:text-text active:scale-90"
          aria-label="关闭详情面板"
          @click="dockPanel.close()"
        >
          <MenuIcon name="close" :size="16" />
        </button>
      </div>
    </header>

    <!-- 内容区（独立滚动）：按 content 分发 -->
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <StockDetailPanel
        v-if="dockPanel.content === DOCK_PANEL_CONTENT.STOCK"
        :symbol="dockPanel.symbol"
      />
      <!-- 插件停靠面板：面板被卸载（插件禁用）时降级为空态，不留白屏 -->
      <component
        v-else-if="pluginPanel"
        :is="pluginPanel.component"
        v-bind="pluginPanel.props"
      />
      <BaseEmpty
        v-else-if="dockPanel.content === DOCK_PANEL_CONTENT.PLUGIN"
        text="面板已不可用（所属插件可能已被禁用）"
      />
    </div>
  </aside>
</template>

