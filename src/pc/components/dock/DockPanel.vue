<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import MenuIcon from '../ui/MenuIcon.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import StockDetailPanel from './StockDetailPanel.vue';
import FuturesChainPanel from './FuturesChainPanel.vue';
import StockF10Drawer from '../business/stock-f10/StockF10Drawer.vue';
import DockResizer from '../business/DockResizer.vue';
import { pluginKernel } from '../../../common/plugin/index';
import {
  DOCK_PANEL_WIDTH_MAX_RATIO,
  DOCK_LAYOUT_CANVAS_PADDING,
  DOCK_PANEL_CONTENT,
} from '../../../common/constants/dock-panel.constants.ts';
import { FUTURES_CHAIN_PAGE_URL_TEMPLATE } from '../../../common/constants/futures.constants.ts';
import { ROUTE_PATH } from '../../../common/constants/router-meta.constants.ts';
import { useDockPanelStore } from '../../../common/stores/dock-panel';

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

/** 面板头部标题（个股详情 / 产业链 / F10 用固定模式；插件面板用其声明标题） */
const panelTitle = computed(() => {
  if (dockPanel.content === DOCK_PANEL_CONTENT.STOCK) return '个股详情';
  if (dockPanel.content === DOCK_PANEL_CONTENT.CHAIN)
    return `${dockPanel.chainVarietyName} · 产业链`;
  if (dockPanel.content === DOCK_PANEL_CONTENT.F10)
    return `更多信息 · ${dockPanel.f10Name || dockPanel.f10Symbol}`;
  if (dockPanel.content === DOCK_PANEL_CONTENT.PLUGIN) return pluginPanel.value?.title ?? '插件面板';
  return '';
});

/**
 * 抽屉拖拽调宽（更多信息 / 产业链等非 STOCK 内容；个股详情的手柄在其内容
 * StockDetailPanel 内部自渲染，此处不再重复挂）：鼠标 X 换算面板宽度写入
 * store（store 内 clamp 到 375 ~ 60vw 并持久化）
 * @param clientX 鼠标屏幕 X
 */
const onDockResize = (clientX: number): void => {
  dockPanel.setWidth(window.innerWidth - clientX - DOCK_LAYOUT_CANVAS_PADDING);
};

/** 产业链页面完整地址（面板头部「新窗口打开」用，嵌入失败时的兜底出口） */
const chainFullUrl = computed(() =>
  FUTURES_CHAIN_PAGE_URL_TEMPLATE.replace('{code}', encodeURIComponent(dockPanel.chainContractCode)),
);

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
  <!-- Islands（2026-10-22）：去贴边通栏的 border-l，改独立浮岛
       （rounded-2xl + shadow-island，overflow-hidden 裁圆角）；
       与主区的间隔由 MainLayout 内容行的 gap-2.5 露出画布承接。
       开关动画（2026-10-24 王总指定）：Transition 滑入滑出 + 淡入淡出，
       收起时同步负 margin-right 让主区平滑回填（见底部 style） -->
  <Transition name="dock-panel">
    <aside
      v-if="dockPanel.open"
      class="dock-panel relative flex flex-col overflow-hidden rounded-2xl bg-surface shadow-island"
      :style="{
        width: `min(${dockPanel.width}px, ${Math.round(DOCK_PANEL_WIDTH_MAX_RATIO * 100)}vw)`,
        '--dock-width': `${dockPanel.width}px`,
      }"
    >
      <!-- 头部：标题 + 关闭 -->
      <header class="flex h-11 shrink-0 items-center justify-between border-b border-flat-weak pl-4 pr-1">
        <h2 class="text-sm font-semibold text-text">{{ panelTitle }}</h2>
        <div class="flex items-center">
          <a
            v-if="dockPanel.content === DOCK_PANEL_CONTENT.CHAIN"
            :href="chainFullUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="pressable rounded-lg p-2 text-text-secondary hover:bg-flat-weak hover:text-text active:scale-90"
            aria-label="在新窗口打开产业链页面"
            title="在新窗口打开"
          >
            <MenuIcon name="export" :size="16" />
          </a>
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

      <!-- 内容区：产业链 iframe 通铺（去内边距禁滚动，页面自带布局）；
         其余内容独立滚动。relative 供拖拽手柄定位（个股详情内容由
         StockDetailPanel 自带手柄，此处跳过避免双份） -->
      <div
        class="relative min-h-0 flex-1"
        :class="dockPanel.content === DOCK_PANEL_CONTENT.CHAIN ? 'overflow-hidden' : 'overflow-y-auto p-3'"
      >
        <DockResizer
          v-if="dockPanel.open && dockPanel.content !== DOCK_PANEL_CONTENT.STOCK"
          :on-resize="onDockResize"
        />
        <StockDetailPanel
          v-if="dockPanel.content === DOCK_PANEL_CONTENT.STOCK"
          :symbol="dockPanel.symbol"
        />
        <!-- 产业链基本面：iframe 嵌同花顺 F10 页面（期货总览页品种基本面发起） -->
        <FuturesChainPanel
          v-else-if="dockPanel.content === DOCK_PANEL_CONTENT.CHAIN"
          :contract-code="dockPanel.chainContractCode"
          :variety-name="dockPanel.chainVarietyName"
        />
        <!-- 个股 F10 资料抽屉（详情页顶栏 F10 按钮发起） -->
        <StockF10Drawer
          v-else-if="dockPanel.content === DOCK_PANEL_CONTENT.F10"
          :symbol="dockPanel.f10Symbol"
          :name="dockPanel.f10Name"
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
  </Transition>
</template>

<style scoped>
/*
 * 停靠面板开合动画（2026-10-24 王总指定）：
 * 展开 = 淡入 + 从右侧滑入；收起 = 淡出 + 向右滑出。
 * 滑出/滑入同时以负 margin-right 抵消面板占位宽度，让左侧主区
 * 平滑回填（而不是收尾瞬间跳变）；面板自身宽度不变，内容无挤压。
 * --dock-width 由模板行内样式注入（store 的 width 经 clamp 持久化）。
 */
.dock-panel-enter-active {
  transition:
    opacity 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    margin-right 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.dock-panel-leave-active {
  transition:
    opacity 0.18s cubic-bezier(0.4, 0, 1, 1),
    margin-right 0.18s cubic-bezier(0.4, 0, 1, 1),
    transform 0.18s cubic-bezier(0.4, 0, 1, 1);
  /* 收起过程禁止误触内部按钮 */
  pointer-events: none;
}

.dock-panel-enter-from,
.dock-panel-leave-to {
  opacity: 0;
  margin-right: calc(-1 * var(--dock-width, 0px));
  /* 略带位移，滑入/滑出方向感更明确（与 margin 回填叠加） */
  transform: translateX(16px);
}
</style>

