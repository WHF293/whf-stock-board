<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import MenuIcon from '../ui/MenuIcon.vue';
import StockDetailPanel from './StockDetailPanel.vue';
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
 */
const dockPanel = useDockPanelStore();
const router = useRouter();

/**
 * 跳转股票详情整页：关闭面板后路由跳转（全站双击同款行为）
 */
const openDetailPage = (): void => {
  if (dockPanel.content !== DOCK_PANEL_CONTENT.STOCK || !dockPanel.symbol) return;
  const symbol = dockPanel.symbol;
  dockPanel.close();
  void router.push(`${ROUTE_PATH.STOCK_DETAIL}/${symbol}`);
};

/** 面板标题映射（新增内容类型在此补标题） */
const TITLE_BY_CONTENT: Record<string, string> = {
  [DOCK_PANEL_CONTENT.STOCK]: '个股详情',
};

/** 面板内容组件映射（可配置分发：新增内容类型在此注册组件） */
const CONTENT_COMPONENTS = {
  [DOCK_PANEL_CONTENT.STOCK]: StockDetailPanel,
} as const;

/** 当前内容组件（未注册类型不渲染） */
const contentComponent = computed(() =>
  dockPanel.content ? CONTENT_COMPONENTS[dockPanel.content] ?? null : null,
);

/** 面板头部标题 */
const panelTitle = computed(() =>
  dockPanel.content ? TITLE_BY_CONTENT[dockPanel.content] ?? '详情' : '',
);

/** 当前内容参数（个股为符号；其他类型后续扩展时改联合） */
const contentSymbol = computed(() =>
  dockPanel.content === DOCK_PANEL_CONTENT.STOCK ? dockPanel.symbol : '',
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

    <!-- 内容区（独立滚动） -->
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <component :is="contentComponent" v-if="contentComponent" :symbol="contentSymbol" />
    </div>
  </aside>
</template>

