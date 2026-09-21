<script setup lang="ts">
import { useIntervalFn } from "@vueuse/core";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import TitleBar from "./TitleBar.vue";
import HeaderTools from "./HeaderTools.vue";
import PluginSettingsModal from "../components/plugin/PluginSettingsModal.vue";
import StockSearchModal from "../components/business/StockSearchModal.vue";
import FirstRunSetupModal from "../components/business/FirstRunSetupModal.vue";
import BaseDrawer from "../components/ui/BaseDrawer.vue";
import SettingsView from "../views/SettingsView.vue";
import DockPanel from "../components/dock/DockPanel.vue";
import BaseTooltip from "../components/ui/BaseTooltip.vue";
import MenuIcon from "../components/ui/MenuIcon.vue";
import NotificationHost from "../components/ui/NotificationHost.vue";
import PluginConfirmHost from "../components/plugin/PluginConfirmHost.vue";
import SidebarPanelHost from "../components/plugin/SidebarPanelHost.vue";
import SidebarPanelEntry from "../components/plugin/SidebarPanelEntry.vue";
import PluginPanelDrawer from "../components/plugin/PluginPanelDrawer.vue";
import { pluginKernel } from "../plugin";
import { matchesCommandKeys, parseCommandKeys } from "../plugin/command-keys";
import { useTheme } from "../composables/use-theme";
import { MARKET_STATUS_REFRESH_INTERVAL_MS } from "../constants/polling.constants";
import { HOST_HEADER_ITEM, HOST_HEADER_ITEMS } from "../constants/header.constants";
import { MENU_ITEMS, ROUTE_PATH } from "../constants/router-meta.constants";
import { openAgentAnalysisWindow } from "../utils/agent-window";
import { orderSidebarMenu } from "../utils/order-sidebar-menu";
import { useStockOpen } from "../composables/use-stock-open";
import { useMarketStatusStore } from "../stores/market-status";
import { useSettingsStore } from "../stores/settings";
import { trackAction } from "../weblog/weblogActions";
import type { SearchResult } from "../types/stock-quote.types";
import type { HeaderRenderItem } from "../types/header.types";
import type { ParsedCommandKeys } from "../plugin/command-keys";
import type { SidebarMenuEntry } from "../utils/order-sidebar-menu";
import type { RegisteredCommand, RegisteredSidebarPanel } from "../types/plugin.types";

/**
 * 主布局：左侧导航（桌面固定 / 窄屏抽屉）+ 右侧路由内容区 + 右侧停靠面板（默认收起）
 *
 * 侧栏底部为设置入口（数据来源链接在设置页「数据获取」卡片内）；
 * 头部展示页面标题、顶栏工具条（交易时段徽标 / 明暗切换 / 搜索 / Agent 分析 + 插件条目）；
 * 挂载后刷新市场状态并每 10 分钟同步，供全部轮询消费
 *
 * 插件体系：左侧栏的面板与菜单项、顶栏条目均由插件内核贡献（见 `src/plugin/`），
 * 本布局只负责渲染注册表 + 分发插件命令快捷键，不关心具体是哪个插件；
 * 宿主自带顶栏项的声明顺序与插件条目合并后，统一由设置页「顶栏工具」编排顺序与显隐。
 * 桌面端全部顶栏条目（宿主 + 插件，如盯盘）都渲染在自绘 TitleBar 上；
 * 浏览器无标题栏，全部条目留在页内 header。
 *
 * 标题栏：Tauri 桌面端主窗口去掉了系统原生标题栏（tauri.conf 的 decorations: false），
 * 顶部渲染自绘 TitleBar（品牌区 + 侧栏收起/展开开关 + 窗口控制按钮，颜色跟随应用明暗主题），
 * 品牌区与侧栏开关随之从侧栏顶部上移（桌面端侧栏不再有顶部块）；
 * 浏览器模式无窗口概念，不渲染标题栏、品牌区与开关留在侧栏顶部。
 */
const route = useRoute();
const router = useRouter();
const { isDark, toggleDark } = useTheme();
const marketStatusStore = useMarketStatusStore();
const settingsStore = useSettingsStore();
const { openSidebar, toContextList } = useStockOpen();

/**
 * 初始设置引导弹窗显隐（派生自 settings.setupCompleted，以 store 为唯一事实源）
 *
 * 用可写 computed 而非一次性 ref：弹窗组件是纯受控的，关闭时只 emit update:open(false)，
 * 「首次启动那次关闭即视为完成引导」这条语义由这里落库（设置页复用的那次不落，见组件说明）。
 */
const firstRunSetupOpen = computed({
  get: () => !settingsStore.setupCompleted,
  set: (value: boolean) => {
    if (!value) settingsStore.completeSetup();
  },
});

/** 是否 Tauri 桌面端（决定是否渲染自绘标题栏 + 侧栏品牌区是否上移；浏览器 false） */
const isTauriDesktop = isTauri();

/**
 * 打开 Agent 分析：Tauri 开独立 WebviewWindow（已开则聚焦），
 * 浏览器回退为站内 standalone 路由（/agent-window）
 */
const openAgentAnalysis = (): void => {
  void openAgentAnalysisWindow().then((opened) => {
    if (!opened) void router.push(ROUTE_PATH.AGENT_WINDOW);
  });
};

/**
 * 打开软件白皮书（站内文档页）
 *
 * 已在该页时不重复导航，避免 vue-router 抛重复导航告警
 */
const openWhitepaper = (): void => {
  if (route.path === ROUTE_PATH.WHITEPAPER) return;
  void router.push(ROUTE_PATH.WHITEPAPER);
};

// 暗色 class / data-theme / data-trend 的落 <html> 已上提到 App.vue 的
// useDocumentThemeSync（独立 WebviewWindow 不经过本布局，须全局生效）；
// 这里 useTheme 仅供顶栏明暗切换按钮使用

/** 头部页面标题（路由 meta.title） */
const pageTitle = computed(() => route.meta.title ?? "");

// ---------- 侧栏顺序（用户可在设置页编排，持久化在 settings.menuOrder） ----------

/** 宿主内置菜单（声明顺序即默认顺序） */
const HOST_MENU_ITEMS: readonly SidebarMenuEntry[] = MENU_ITEMS;

/** 插件贡献的菜单项（内核注册表；插件注册即出现，卸载即消失） */
const pluginMenuItems = computed<SidebarMenuEntry[]>(() => {
  void pluginKernel.revision.value;
  return pluginKernel.contributions.menu.items.map((item) => ({
    path: item.path,
    title: item.title,
    icon: item.icon,
  }));
});

/**
 * 按用户编排顺序渲染的菜单项
 *
 * 顺序规则收敛在 `orderSidebarMenu`（而不是写在这里）：宿主在「插件页随插件
 * 撤销」时要把用户退到「侧栏第一个菜单」，两处必须用同一份实现，否则界面上的
 * 第一个和兜底跳去的第一个会不是同一个页面。
 */
const menuItems = computed<SidebarMenuEntry[]>(() =>
  orderSidebarMenu(
    HOST_MENU_ITEMS,
    pluginMenuItems.value,
    settingsStore.menuOrder,
    settingsStore.hiddenMenus,
  ),
);

/** 当前侧栏顺序下的路径列表（驱动页面过渡方向与 Shift+Tab 循环） */
const menuOrderPaths = computed<string[]>(() =>
  menuItems.value.map((item) => item.path),
);

// ---------- 页面进入动画（纯 CSS keyframes，方向按侧栏顺序） ----------

/**
 * 当前页面的进入动画类名（空串 = 本轮不播放）
 *
 * 为什么不用 `<Transition mode="out-in">`：out-in 必须先等旧页离场动画回调整完
 * 才会插入新页；一旦该回调没触发（快速连点、WebView 窗口被遮挡时节流动画等），
 * 新页就永远不会插入 —— 表现为「内容区空白，且怎么切路由都无法恢复」。
 * keyframes 在元素插入时直接播放，没有离场/进入状态机，不存在卡死路径。
 */
const pageAnim = ref("");

/** 页面滑入方向：前进（右侧滑入）/ 后退（左侧滑入） */
type PageAnim = "" | "page-anim-forward" | "page-anim-back";

watch(
  () => route.path,
  (to, from) => {
    const order = menuOrderPaths.value;
    const toIndex = order.indexOf(to);
    const fromIndex = order.indexOf(from);
    const next: PageAnim =
      toIndex >= 0 && fromIndex >= 0 && toIndex < fromIndex
        ? "page-anim-back"
        : "page-anim-forward";
    // KeepAlive 复用已缓存页面的 DOM 时，同一个元素上的 CSS 动画不会自动重播；
    // 先清空类名、下一帧再赋回，强制动画重新触发
    pageAnim.value = "";
    void nextTick(() => {
      pageAnim.value = next;
    });
  },
);

/** 实际收起态（桌面专用应用，用户收起即生效） */
const effectiveCollapsed = computed(() => settingsStore.sidebarCollapsed);

/** 侧栏宽度类名：按收起态切换 */
const sidebarWidthClass = computed(() =>
  effectiveCollapsed.value ? 'w-16' : 'w-56',
);

// ---------- 插件贡献点消费（侧栏面板 / 命令快捷键） ----------

/** 全部插件侧栏面板（内核注册表，随插件装卸实时变化） */
const sidebarPanels = computed(() => {
  void pluginKernel.revision.value;
  return [...pluginKernel.contributions.sidebar.panels];
});

/**
 * 取指定位置、指定形态的插件面板
 * @param position 面板位置（nav 导航区 / footer 侧栏底部）
 * @param mode 展示形态（inline 内联 / drawer 抽屉入口）
 * @returns 面板列表
 */
const pickPanels = (position: 'nav' | 'footer', mode: 'inline' | 'drawer') =>
  sidebarPanels.value.filter((panel) => panel.position === position && panel.mode === mode);

/**
 * 是否渲染内联面板：侧栏收起为图标栏（64px）时按面板自身声明决定
 * @param panel 面板
 * @returns 是否渲染
 */
const shouldRenderInline = (panel: RegisteredSidebarPanel): boolean =>
  !effectiveCollapsed.value || panel.visibleWhenCollapsed;

/** 导航区 / 侧栏底部的内联面板与抽屉入口面板 */
const navInlinePanels = computed(() => pickPanels('nav', 'inline').filter(shouldRenderInline));
const navDrawerPanels = computed(() => pickPanels('nav', 'drawer'));
const footerInlinePanels = computed(() => pickPanels('footer', 'inline').filter(shouldRenderInline));
const footerDrawerPanels = computed(() => pickPanels('footer', 'drawer'));

// ---------- 顶栏（右上角工具条） ----------

/** 宿主自带顶栏条目（声明顺序即默认顺序） */
const hostHeaderItems: HeaderRenderItem[] = HOST_HEADER_ITEMS.map((item) => ({
  key: item.id,
  id: item.id,
  title: item.title,
  icon: item.icon,
  panel: null,
}));

/** 插件贡献的顶栏条目（内核注册表，已按插件声明的 order 排好） */
const pluginHeaderItems = computed<HeaderRenderItem[]>(() => {
  void pluginKernel.revision.value;
  return pluginKernel.contributions.header.items.map((item) => ({
    key: item.key,
    id: item.key,
    title: item.title,
    icon: item.icon,
    panel: item,
  }));
});

/**
 * 按用户编排顺序渲染的顶栏条目
 *
 * 与侧栏导航同一套兜底规则：持久化顺序里没有的条目（版本升级新增、新装插件）
 * 追加到末尾，保证入口不丢失；`settings.hiddenHeaderItems` 里编排时关掉的条目不渲染。
 */
const headerItems = computed<HeaderRenderItem[]>(() => {
  const all: HeaderRenderItem[] = [...hostHeaderItems, ...pluginHeaderItems.value];
  const hidden = new Set(settingsStore.hiddenHeaderItems);
  const byKey = new Map<string, HeaderRenderItem>();
  for (const item of all) {
    if (!hidden.has(item.key)) byKey.set(item.key, item);
  }
  const ordered: HeaderRenderItem[] = [];
  for (const key of settingsStore.headerOrder) {
    const item = byKey.get(key);
    if (item) {
      ordered.push(item);
      byKey.delete(key);
    }
  }
  for (const item of all) {
    if (byKey.has(item.key)) ordered.push(item);
  }
  return ordered;
});

/** 桌面端进自绘 TitleBar 的条目：宿主自带项 + 插件条目（盯盘入口与白皮书同一行） */
const titleBarHeaderItems = computed<HeaderRenderItem[]>(() => headerItems.value);

/**
 * 固定在 TitleBar 左侧（侧栏开关之后）的宿主条目，数组顺序即渲染顺序：
 * Agent 分析在前、交易状态徽标在后——王总指定的常驻左位，不随右侧工具编排移动
 */
const TITLE_BAR_LEADING_ORDER: readonly string[] = [
  HOST_HEADER_ITEM.AGENT,
  HOST_HEADER_ITEM.MARKET_STATUS,
];

/** TitleBar 左侧工具位（Agent 分析 + 交易状态），按上面的固定顺序 */
const titleBarLeadingItems = computed<HeaderRenderItem[]>(() => {
  const rank = new Map(TITLE_BAR_LEADING_ORDER.map((id, index) => [id, index]));
  return titleBarHeaderItems.value
    .filter((item) => rank.has(item.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
});

/** TitleBar 右侧工具条（明暗 / 搜索 / 白皮书，窗口控制按钮左侧） */
const titleBarTrailingItems = computed<HeaderRenderItem[]>(() =>
  titleBarHeaderItems.value.filter((item) => !TITLE_BAR_LEADING_ORDER.includes(item.id)),
);

/**
 * 页面 header 渲染的条目：浏览器 = 全部（无标题栏，宿主项留在页内）；
 * 桌面端 = 空（宿主项与插件条目都已移入 TitleBar）。
 *
 * 插件条目一并上移是用户指定（盯盘与白皮书同行）：插件下拉是 absolute z-50
 * 定位，TitleBar 无 overflow 裁剪、也不构成独立堆叠上下文，下拉照常浮在
 * 内容上方——「下拉要留在页内层级」的旧顾虑不成立。
 */
const inPageHeaderItems = computed<HeaderRenderItem[]>(() =>
  isTauriDesktop ? [] : headerItems.value,
);

/**
 * 插件命令的快捷键表
 *
 * 描述串在注册表变化时解析一次并缓存，键盘事件里只做比对 ——
 * capture 阶段每个按键都会走到这里，不适合每次都做字符串切分。
 */
const parsedCommands = computed<{ command: RegisteredCommand; parsed: ParsedCommandKeys }[]>(() => {
  void pluginKernel.revision.value;
  const result: { command: RegisteredCommand; parsed: ParsedCommandKeys }[] = [];
  for (const command of pluginKernel.contributions.commands.commands) {
    if (!command.keys) continue;
    const parsed = parseCommandKeys(command.keys);
    if (parsed) result.push({ command, parsed });
  }
  return result;
});

/** 头部搜索弹窗开关 */
const searchModalOpen = ref(false);

/** 插件设置弹窗开关（顶栏齿轮入口，列出声明了 settings 的已挂载插件） */
const pluginSettingsOpen = ref(false);

/** 设置抽屉显隐（设置不再是路由页，改为右侧抽屉） */
const settingsOpen = ref(false);

/**
 * 选中搜索结果：右侧面板打开个股详情并关闭弹窗
 * @param result 搜索结果
 * @param results 完整搜索结果列表（写入详情页左侧来源列表）
 */
const onHeaderSearchSelect = (result: SearchResult, results: SearchResult[]): void => {
  // 携带完整搜索结果作为详情页左侧来源列表
  openSidebar(result.code, toContextList(results, (item) => item.code));
  searchModalOpen.value = false;
};

// ---------- 快捷键：Shift + Tab 循环切换页面（按侧栏顺序，不含设置页） ----------
/** 当前路由在菜单顺序中的下标 */
const routeOrderIndex = ref(0);

/**
 * 全局键盘快捷键：
 * - 插件命令：命中任一已注册快捷键即执行（插件自己不用挂 keydown）
 * - Ctrl+Shift+B：切换左侧导航栏收起 / 展开（仅桌面端可见效果）
 * - Shift+Tab：按侧栏顺序切到下一个页面（到尾回第一个）
 * @param event 键盘事件
 */
const onGlobalKeydown = (event: KeyboardEvent): void => {
  // 插件命令优先：允许插件用 Ctrl+Alt+X 这类不与宿主冲突的组合
  for (const { command, parsed } of parsedCommands.value) {
    if (!matchesCommandKeys(event, parsed)) continue;
    event.preventDefault();
    trackAction('PLUGIN_COMMAND_RUN', {
      target: command.key,
      detail: command.title,
    });
    try {
      command.run();
    } catch (error) {
      console.error(`[plugin] 命令 ${command.key} 执行失败`, error);
    }
    return;
  }
  // Ctrl+Shift+B：展开则收起，反之展开
  if (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.code === "KeyB"
  ) {
    event.preventDefault();
    toggleSidebar();
    trackAction('NAV_SHORTCUT', { detail: 'Ctrl+Shift+B 侧栏开关' });
    return;
  }
  if (
    event.shiftKey &&
    event.key === "Tab" &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  ) {
    event.preventDefault();
    const order = menuOrderPaths.value;
    if (order.length === 0) return;
    routeOrderIndex.value = (routeOrderIndex.value + 1) % order.length;
    trackAction('NAV_SHORTCUT', { detail: `Shift+Tab → ${order[routeOrderIndex.value]}` });
    void router.push(order[routeOrderIndex.value]);
  }
};

onMounted(() => {
  document.addEventListener("keydown", onGlobalKeydown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onGlobalKeydown, true);
});

/**
 * 菜单项是否激活（当前路由完全匹配或位于其子路径下）
 * @param path 菜单路径
 * @returns 是否激活
 */
const isActive = (path: string): boolean =>
  route.path === path || route.path.startsWith(`${path}/`);

/** 切换侧栏收起状态 */
const toggleSidebar = (): void => {
  settingsStore.toggleSidebarCollapsed();
};

useIntervalFn(
  () => marketStatusStore.refresh(),
  MARKET_STATUS_REFRESH_INTERVAL_MS,
);
// 分钟级时钟 tick：交易窗口（09:15-15:00 / 美股时段）边界到达时自动开停轮询
useIntervalFn(
  () => marketStatusStore.tick(),
  60_000,
);
// 挂载即刷新一次市场状态（store 内部已做错误降级）
void marketStatusStore.refresh();
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden">
    <!-- 自绘标题栏（仅 Tauri 桌面端）：品牌区 + 侧栏开关 + 左侧工具（交易状态/Agent）
         + 右侧工具（明暗/搜索/白皮书）+ 窗口控制 -->
    <TitleBar v-if="isTauriDesktop">
      <template #leading-tools>
        <HeaderTools
          :items="titleBarLeadingItems"
          :is-dark="isDark"
          @toggle-theme="toggleDark()"
          @open-search="searchModalOpen = true"
          @open-agent="openAgentAnalysis"
          @open-whitepaper="openWhitepaper"
        />
      </template>
      <template #tools>
        <HeaderTools
          :items="titleBarTrailingItems"
          :is-dark="isDark"
          @toggle-theme="toggleDark()"
          @open-search="searchModalOpen = true"
          @open-agent="openAgentAnalysis"
          @open-whitepaper="openWhitepaper"
        />
      </template>
    </TitleBar>

    <div class="flex min-h-0 flex-1 overflow-hidden">
      <!-- 左侧导航：常驻侧栏（桌面端品牌区与收起/展开开关均已上移至标题栏，
           顶部不再有头部块，导航加顶部留白；浏览器模式保留原头部块） -->
      <aside
        class="flex shrink-0 flex-col border-r border-flat-weak bg-surface transition-all duration-200"
        :class="sidebarWidthClass"
      >
        <!-- 浏览器模式头部：品牌 + 收起/展开开关（Tauri 桌面端整块移入 TitleBar，不渲染） -->
        <div
          v-if="!isTauriDesktop"
          class="flex items-center py-4"
          :class="effectiveCollapsed ? 'justify-center px-2' : 'justify-between px-4'"
        >
          <div class="flex min-w-0 items-center gap-2">
            <!-- 品牌 logo：与客户端安装图标同源（public/favicon.svg）；收起时尺寸对齐菜单图标 -->
            <img
              src="/favicon.svg"
              alt="股票看板"
              class="shrink-0"
              :class="effectiveCollapsed ? 'h-4 w-4 rounded' : 'h-8 w-8 rounded-lg'"
            />
            <span v-if="!effectiveCollapsed" class="truncate text-base font-semibold text-text">股票看板</span>
          </div>
          <!-- 收起/展开按钮：持久化在 settings；panelLeft 形状与桌面端标题栏开关统一 -->
          <button
            type="button"
            class="pressable flex shrink-0 items-center justify-center rounded-md p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
            :aria-label="effectiveCollapsed ? '展开侧栏' : '收起侧栏'"
            data-track="NAV_SIDEBAR_TOGGLE"
            @click="toggleSidebar"
          >
            <MenuIcon name="panelLeft" :size="16" />
            <BaseTooltip v-if="effectiveCollapsed" :text="effectiveCollapsed ? '展开侧栏' : '收起侧栏'" />
          </button>
        </div>
        <!-- overflow-x-clip：收起态图标的 BaseTooltip（left-full）会横向溢出 nav，
             而 overflow-y:auto 会把 overflow-x 计算成 auto → 底部出现横向滚动条；clip 掐掉 -->
        <nav
          class="flex-1 space-y-1 overflow-x-clip overflow-y-auto px-2"
          :class="isTauriDesktop ? 'pt-3' : ''"
        >
          <RouterLink
            v-for="item in menuItems"
            :key="item.path"
            :to="item.path"
            data-track="NAV_MENU_CLICK"
            :data-track-detail="item.title"
            class="group relative pressable flex items-center gap-3 rounded-lg py-2 text-sm active:scale-[0.98]"
            :class="[
              effectiveCollapsed ? 'justify-center px-2' : 'px-3',
              isActive(item.path)
                ? 'bg-primary-weak font-medium text-primary'
                : 'text-text-secondary hover:bg-flat-weak',
            ]"
          >
            <MenuIcon :name="item.icon" :size="16" />
            <span v-if="!effectiveCollapsed" class="truncate">{{ item.title }}</span>
            <BaseTooltip v-if="effectiveCollapsed" :text="item.title" />
          </RouterLink>

          <!-- 插件贡献：导航区面板（inline 直接渲染 / drawer 只放入口） -->
          <SidebarPanelHost
            v-for="panel in navInlinePanels"
            :key="panel.key"
            :panel="panel"
          />
          <SidebarPanelEntry
            v-for="panel in navDrawerPanels"
            :key="panel.key"
            :panel="panel"
            :collapsed="effectiveCollapsed"
          />
        </nav>
        <!-- 侧栏底部：插件面板（footer 区）+ 设置入口（收起时仅显示图标） -->
        <div class="space-y-2 border-t border-flat-weak py-3" :class="effectiveCollapsed ? 'px-2' : 'px-4'">
          <SidebarPanelHost
            v-for="panel in footerInlinePanels"
            :key="panel.key"
            :panel="panel"
          />
          <SidebarPanelEntry
            v-for="panel in footerDrawerPanels"
            :key="panel.key"
            :panel="panel"
            :collapsed="effectiveCollapsed"
          />
          <button
            type="button"
            class="group relative pressable flex items-center gap-2 rounded-lg py-1 text-xs active:scale-[0.98] text-text-secondary hover:text-text"
            :class="effectiveCollapsed ? 'justify-center px-1' : 'px-1'"
            aria-label="打开设置"
            data-track="NAV_SETTINGS_OPEN"
            @click="settingsOpen = true"
          >
            <MenuIcon name="settings" :size="14" />
            <span v-if="!effectiveCollapsed">设置</span>
            <BaseTooltip v-if="effectiveCollapsed" text="设置" />
          </button>
        </div>
      </aside>

      <!-- 右侧内容区 -->
      <div class="relative flex min-w-0 flex-1 flex-col">
        <header
          class="flex h-14 shrink-0 items-center justify-between border-b border-flat-weak bg-surface px-6"
        >
          <div class="flex min-w-0 items-center gap-2">
            <h1 class="truncate text-base font-semibold text-text">
              {{ pageTitle }}
            </h1>
          </div>
          <!-- 顶栏工具条：桌面端全部条目（宿主 + 插件）已移入自绘 TitleBar，此处为空；
               浏览器无标题栏，全部条目都留在页内。右侧恒置「插件设置」齿轮
               （盯盘条目入 TitleBar 前所在的页内 header 位置，用户指定） -->
          <div class="flex items-center gap-1">
            <HeaderTools
              :items="inPageHeaderItems"
              :is-dark="isDark"
              @toggle-theme="toggleDark()"
              @open-search="searchModalOpen = true"
              @open-agent="openAgentAnalysis"
              @open-whitepaper="openWhitepaper"
            />
            <button
              type="button"
              class="pressable rounded-lg p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
              aria-label="插件设置"
              title="插件设置"
              data-track="PLUGIN_SETTINGS_OPEN"
              @click="pluginSettingsOpen = true"
            >
              <MenuIcon name="settings" :size="15" />
            </button>
          </div>
        </header>
        <main class="flex-1 overflow-y-auto">
          <!-- 内容上限 1600px：报价卡片栅格（quote-card-grid）在上限内按列宽公式排布 -->
          <div class="mx-auto w-full max-w-[1600px] p-6">
            <!-- 页面切换：KeepAlive 缓存页面状态；进入动画由 pageAnim 类名驱动（无离场状态机） -->
            <RouterView v-slot="{ Component, route: routeRecord }">
              <KeepAlive>
                <component
                  :is="Component"
                  :key="routeRecord.path"
                  :class="pageAnim"
                />
              </KeepAlive>
            </RouterView>
          </div>
        </main>
      </div>

      <!-- 右侧停靠面板（个股详情等可插拔内容，默认收起；窄屏全屏覆盖）。
           必须留在横向行容器内：根节点是 flex-col（标题栏 + 内容区两段），
           挂到根上会变成纵向列项，把侧栏 / 主区高度挤没 -->
      <DockPanel />
    </div>

    <!-- 全局标的搜索弹窗 -->
    <StockSearchModal
      :open="searchModalOpen"
      @close="searchModalOpen = false"
      @select="onHeaderSearchSelect"
    />

    <!-- 插件设置弹窗（顶栏齿轮入口） -->
    <PluginSettingsModal v-model:open="pluginSettingsOpen" />

    <!-- 初始设置引导（仅首次启动展示一次） -->
    <FirstRunSetupModal v-model:open="firstRunSetupOpen" />

    <!-- 设置抽屉（右侧滑入，宽 2/3 视口） -->
    <BaseDrawer v-model:open="settingsOpen" title="设置">
      <SettingsView @close="settingsOpen = false" />
    </BaseDrawer>

    <!-- 插件面板抽屉（承载 mode: 'drawer' 的插件面板） -->
    <PluginPanelDrawer />

    <!-- 应用级浮窗（插件经 app:notify 服务发起，跨路由常驻） -->
    <NotificationHost />

    <!-- 插件确认弹窗（经 app:ui 的 confirm 发起，宿主渲染、答复回到插件的 Promise） -->
    <PluginConfirmHost />
  </div>
</template>
