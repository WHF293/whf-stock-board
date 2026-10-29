<script setup lang="ts">
import { useIntervalFn } from "@vueuse/core";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDesktopChrome } from "../../common/composables/use-desktop-chrome";
import { PAGE_HEADER_ACTIONS_ID } from "../../common/composables/use-page-header-slot";
import TitleBar from "./TitleBar.vue";
import HeaderTools from "./HeaderTools.vue";
import PluginSettingsModal from "../components/plugin/PluginSettingsModal.vue";
import StockSearchModal from "../components/business/StockSearchModal.vue";
import CommandPalette from "../components/business/CommandPalette.vue";
import FirstRunSetupModal from "../components/business/FirstRunSetupModal.vue";
import BaseDrawer from "../components/ui/BaseDrawer.vue";
import BaseButton from "../components/ui/BaseButton.vue";
import SettingsView from "../views/SettingsView.vue";
import DockPanel from "../components/dock/DockPanel.vue";
import BaseTooltip from "../components/ui/BaseTooltip.vue";
import MenuIcon from "../components/ui/MenuIcon.vue";
import NotificationHost from "../components/ui/NotificationHost.vue";
import TreasuryFab from "../components/business/TreasuryFab.vue";
import PluginConfirmHost from "../components/plugin/PluginConfirmHost.vue";
import PluginStockPickerHost from "../components/plugin/PluginStockPickerHost.vue";
import SidebarPanelHost from "../components/plugin/SidebarPanelHost.vue";
import SidebarPanelEntry from "../components/plugin/SidebarPanelEntry.vue";
import PluginPanelDrawer from "../components/plugin/PluginPanelDrawer.vue";
import { pluginKernel } from "../plugin/index";
import { matchesCommandKeys, parseCommandKeys } from "../plugin/command-keys";
import { useTheme } from "../../common/composables/use-theme";
import { useSlidingThumb } from "../../common/composables/use-sliding-thumb";
import { MARKET_STATUS_REFRESH_INTERVAL_MS } from "../../common/constants/polling.constants.ts";
import { HOST_HEADER_ITEM, HOST_HEADER_ITEMS, HEADER_PLUGIN_LEAD_KEY } from "../../common/constants/header.constants.ts";
import { WATCH_WIDGET_EVENTS } from "../plugins/watch-widget/constants.ts";
import { openInNewWindow } from "../../common/utils/open-in-new-window";
import { openSiteDocsInApp, openSiteDocsInBrowser } from "../../common/utils/open-site-docs";
import { MENU_ITEMS, ROUTE_PATH } from "../../common/constants/router-meta.constants.ts";
import { openAgentAnalysisWindow } from "../../common/utils/agent-window";
import {
  flattenSidebarMenuGroups,
  groupSidebarMenu,
  orderSidebarMenu,
} from "../../common/utils/order-sidebar-menu";
import { useStockOpen } from "../../common/composables/use-stock-open";
import { useMarketStatusStore } from "../../common/stores/market-status";
import { useSettingsStore } from "../../common/stores/settings";
import { useUiStore } from "../../common/stores/ui";
import { trackAction } from "../weblog/weblogActions";
import type { SearchResult } from "../../common/types/stock-quote.types.ts";
import type { WatchWidgetOpenUrlPayload } from "../../common/types/watch-widget.types.ts";
import type { HeaderRenderItem } from "../../common/types/header.types.ts";
import type { ParsedCommandKeys } from "../plugin/command-keys";
import type { SidebarMenuEntry, SidebarMenuGroup } from "../../common/utils/order-sidebar-menu";
import type { RegisteredCommand, RegisteredSidebarPanel } from "../../common/types/plugin.types.ts";

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
const uiStore = useUiStore();
const { openSidebar, toContextList } = useStockOpen();

/** 页面全屏（详情页铺满应用窗口）：隐藏侧栏与页内页头，Esc / 切页兜底退出 */
const pageFullscreen = computed(() => uiStore.pageFullscreen);

// 切页兜底复位：全屏态下经快捷键 / 命令面板跳走后，新页面不能停留在无侧栏状态
watch(
  () => route.path,
  () => {
    if (uiStore.pageFullscreen) uiStore.exitPageFullscreen();
  },
);

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

/**
 * 是否按桌面端外壳渲染（自绘标题栏 + 侧栏品牌区上移）：
 * Tauri 恒真；浏览器可经 URL `?desktopTitlebar=1` 开启模拟以便与客户端比对样式
 */
const { desktopChrome } = useDesktopChrome();

/**
 * 打开 Agent 分析：Tauri 开独立 WebviewWindow（已开则聚焦），
 * 浏览器回退为站内 standalone 路由（/agent-window）
 */
const openAgentAnalysis = (): void => {
  void openAgentAnalysisWindow().then((opened) => {
    if (!opened) void router.push(ROUTE_PATH.AGENT_WINDOW);
  });
};

/** 打开插件工坊（站内路由；2026-10-29 侧栏入口移到顶栏 Agent 分析之后，王总指定） */
const openPluginLab = (): void => {
  void router.push(ROUTE_PATH.PLUGIN_LAB);
};

// 暗色 class / data-theme / data-trend 的落 <html> 已上提到 App.vue 的
// useDocumentThemeSync（独立 WebviewWindow 不经过本布局，须全局生效）；
// 这里 useTheme 仅供顶栏明暗切换按钮使用

/** 头部页面标题（路由 meta.title） */
const pageTitle = computed(() => route.meta.title ?? "");

/**
 * 是否存在可返回的上一页（路由历史栈里有 back 记录）
 *
 * history.state 非响应式，借 route.fullPath 让其在每次导航后重估
 * @returns 是否显示返回按钮
 */
const hasHistoryBack = computed(() => {
  void route.fullPath;
  return router.options.history.state.back != null;
});

/**
 * 菜单项是否激活（当前路由完全匹配或位于其子路径下）
 *
 * 必须先于「侧栏顺序」段定义：activeGroupId 的 watch 在 setup 期间就会
 * 求值 computed，isActive 若还处于 TDZ 会抛 ReferenceError 炸掉整个布局。
 * @param path 菜单路径
 * @returns 是否激活
 */
const isActive = (path: string): boolean =>
  route.path === path || route.path.startsWith(`${path}/`);

// ---------- 侧栏顺序（用户可在设置页编排，持久化在 settings.menuOrder） ----------
//
// 分组（2026-10-17）：条目归属由声明决定（MENU_ITEMS / 插件贡献点的 group，
// 缺省归「插件」组）；组顺序存 settings.menuGroupOrder、组内顺序沿用扁平
// menuOrder、折叠态存 settings.collapsedMenuGroups。归组与排序正交。

/** 宿主内置菜单（声明顺序即默认顺序） */
const HOST_MENU_ITEMS: readonly SidebarMenuEntry[] = MENU_ITEMS;

/** 插件贡献的菜单项（内核注册表；插件注册即出现，卸载即消失） */
const pluginMenuItems = computed<SidebarMenuEntry[]>(() => {
  void pluginKernel.revision.value;
  return pluginKernel.contributions.menu.items.map((item) => ({
    path: item.path,
    title: item.title,
    icon: item.icon,
    group: item.group,
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

/**
 * 按分组渲染的菜单（组顺序 = settings.menuGroupOrder，组内顺序 = 扁平 menuOrder）
 *
 * 归组与排序正交：条目归属只看声明（缺省归「插件」组），用户编排不改变归属。
 */
const menuGroups = computed<SidebarMenuGroup[]>(() =>
  groupSidebarMenu(menuItems.value, settingsStore.menuGroupOrder),
);

/**
 * 分组是否被折叠（组头点击收起 / 展开，持久化在 settings.collapsedMenuGroups）
 * @param groupId 分组 id
 * @returns 是否折叠
 */
const isGroupCollapsed = (groupId: string): boolean =>
  settingsStore.collapsedMenuGroups.includes(groupId);

/**
 * 切换分组折叠状态（组头点击入口）
 * @param groupId 分组 id
 */
const toggleMenuGroup = (groupId: string): void => {
  settingsStore.toggleMenuGroupCollapsed(groupId);
};

// ---------- 分组条目高度过渡（展开 / 收起动画，参考市场总览指数卡片的 row-clamp 过渡） ----------

/**
 * 展开：高度 0 → 实测内容高（auto 不可动画，须显式起止值）
 * @param el 组条目容器
 */
const onNavGroupEnter = (el: Element): void => {
  const node = el as HTMLElement;
  node.style.height = '0';
  void node.offsetHeight; // 强制 reflow，让起始高度先落定再过渡
  node.style.height = `${node.scrollHeight}px`;
};

/**
 * 展开结束：归还高度给内容自适应，并补测气泡几何（理由同 onNavGroupAfterLeave）
 * @param el 组条目容器
 */
const onNavGroupAfterEnter = (el: Element): void => {
  (el as HTMLElement).style.height = '';
  measureNavThumb();
};

/**
 * 收起：高度实测值 → 0；同时摘掉离场条目的 data-nav-item 锚点——
 * expandedFlatItems 在折叠瞬间已同步缩表，过渡期 DOM 若仍带旧锚点，
 * 气泡按序号取元素会错位闪跳
 * @param el 组条目容器
 */
const onNavGroupLeave = (el: Element): void => {
  const node = el as HTMLElement;
  node.style.height = `${node.scrollHeight}px`;
  void node.offsetHeight; // 强制 reflow，让起始高度先落定再过渡
  node.style.height = '0';
  node.querySelectorAll('a[data-nav-item]').forEach((anchor) => {
    anchor.removeAttribute('data-nav-item');
  });
};

/**
 * 收起结束：补测一次气泡几何。
 * nav 容器是 flex-1（内容再矮也不缩盒子），分组折叠只改内容高度 →
 * useSlidingThumb 的 ResizeObserver 不触发；而折叠瞬间 activeIndex watch
 * 那次 measure 落在高度动画起步（下方条目还没上移），量到的 offsetTop
 * 是旧布局——不在收尾重测，气泡就永远停在错位上（2026-10-22 王总报告）
 */
const onNavGroupAfterLeave = (): void => {
  measureNavThumb();
};

/**
 * 当前路由所在分组 id（未命中 = undefined）
 *
 * 供「导航到被折叠组里的页面时自动展开该组」用，避免出现
 * 「人已在页面里、侧栏却找不到选中项」的割裂感。
 */
const activeGroupId = computed(() =>
  menuGroups.value.find((group) => group.items.some((item) => isActive(item.path)))?.id,
);

// 路由落进被折叠的分组时自动展开该组（折叠态是用户偏好，这里只在「主动导航」时打破）
watch(activeGroupId, (groupId) => {
  if (groupId && isGroupCollapsed(groupId)) settingsStore.toggleMenuGroupCollapsed(groupId);
});

/** 展开态侧栏的扁平渲染序列（跳过被折叠组的条目；驱动滑动气泡定位） */
const expandedFlatItems = computed<SidebarMenuEntry[]>(() =>
  flattenSidebarMenuGroups(
    menuGroups.value.filter((group) => !isGroupCollapsed(group.id)),
  ),
);

/**
 * 收起态图标栏的扁平渲染序列（按组序展开、含被折叠组条目）
 *
 * 必须与展开态同源（menuGroups 的组序展开），不能直接用扁平 menuItems：
 * 用户编排的扁平顺序与「组顺序 + 组内顺序」可能不一致，收起态若走 menuItems
 * 会出现「收起后图标顺序和展开态不一样」的割裂感。
 */
const collapsedFlatItems = computed<SidebarMenuEntry[]>(() =>
  flattenSidebarMenuGroups(menuGroups.value),
);

/** 当前侧栏顺序下的路径列表（驱动页面过渡方向与 Shift+Tab 循环；含被折叠组的页面） */
const menuOrderPaths = computed<string[]>(() =>
  collapsedFlatItems.value.map((item) => item.path),
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
  // 盯盘轮播恒置首位（王总 2026-10-16 指定移到其他 icon 前面）：与 TitleBar
  // 「Agent 分析恒置末位」同一套兜底思路，渲染时显式提前，不受用户编排影响；
  // 插件被禁用 / 卸载时找不到该键，等于无操作
  const leadIndex = ordered.findIndex((item) => item.id === HEADER_PLUGIN_LEAD_KEY);
  if (leadIndex > 0) ordered.unshift(...ordered.splice(leadIndex, 1));
  return ordered;
});

/** 桌面端进自绘 TitleBar 的条目：宿主自带项 + 插件条目（盯盘入口与软件文档同一行） */
const titleBarHeaderItems = computed<HeaderRenderItem[]>(() => headerItems.value);

/**
 * 固定在 TitleBar 左侧（侧栏开关之后）的宿主条目：仅交易状态徽标
 * （Agent 分析已移到右侧末位——白皮书之后，王总 2026-10-13）
 */
const TITLE_BAR_LEADING_ORDER: readonly string[] = [HOST_HEADER_ITEM.MARKET_STATUS];

/** TitleBar 左侧工具位（交易状态徽标），按上面的固定顺序 */
const titleBarLeadingItems = computed<HeaderRenderItem[]>(() => {
  const rank = new Map(TITLE_BAR_LEADING_ORDER.map((id, index) => [id, index]));
  return titleBarHeaderItems.value
    .filter((item) => rank.has(item.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
});

/**
 * TitleBar 右侧工具条（明暗 / 搜索 / 软件文档 / Agent 分析 / 插件工坊，窗口控制按钮左侧）。
 * Agent 分析 + 插件工坊恒置末位（前者王总 2026-10-13、后者 2026-10-29 指定排在
 * Agent 之后）：用户已持久化的编排顺序可能还是旧默认，这里显式兜底，不随编排移动
 */
const titleBarTrailingItems = computed<HeaderRenderItem[]>(() => {
  const rest = titleBarHeaderItems.value.filter(
    (item) =>
      !TITLE_BAR_LEADING_ORDER.includes(item.id)
      && item.id !== HOST_HEADER_ITEM.AGENT
      && item.id !== HOST_HEADER_ITEM.PLUGIN_LAB,
  );
  const tail = titleBarHeaderItems.value.filter(
    (item) => item.id === HOST_HEADER_ITEM.AGENT || item.id === HOST_HEADER_ITEM.PLUGIN_LAB,
  );
  // 尾部按 [Agent, 插件工坊] 固定次序（与 HOST_HEADER_ITEMS 声明一致）
  const tailRank = new Map<string, number>(
    [HOST_HEADER_ITEM.AGENT, HOST_HEADER_ITEM.PLUGIN_LAB].map((id, index) => [id, index]),
  );
  tail.sort((a, b) => (tailRank.get(a.id) ?? 0) - (tailRank.get(b.id) ?? 0));
  return [...rest, ...tail];
});

/**
 * 页面 header 渲染的条目：浏览器 = 全部（无标题栏，宿主项留在页内）；
 * 桌面端 = 空（宿主项与插件条目都已移入 TitleBar）。
 *
 * 插件条目一并上移是用户指定（盯盘与软件文档同行）：插件下拉是 absolute z-50
 * 定位，TitleBar 无 overflow 裁剪、也不构成独立堆叠上下文，下拉照常浮在
 * 内容上方——「下拉要留在页内层级」的旧顾虑不成立。
 */
const inPageHeaderItems = computed<HeaderRenderItem[]>(() =>
  desktopChrome.value ? [] : headerItems.value,
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

/** 头部搜索弹窗开关（上下文选票场景：自选添加 / 插件选股） */
const searchModalOpen = ref(false);

/** 全局命令面板开关（顶栏搜索按钮 + Ctrl+K，三合一入口：个股 / 页面 / 命令） */
const commandPaletteOpen = ref(false);

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
 * - Ctrl+K：打开全局命令面板（个股 / 页面 / 命令三合一）
 * - Esc：退出页面全屏（详情页铺满模式）
 * - 插件命令：命中任一已注册快捷键即执行（插件自己不用挂 keydown）
 * - Ctrl+Shift+B：切换左侧导航栏收起 / 展开（仅桌面端可见效果）
 * - Shift+Tab：按侧栏顺序切到下一个页面（到尾回第一个）
 * @param event 键盘事件
 */
const onGlobalKeydown = (event: KeyboardEvent): void => {
  // Esc：退出页面全屏（无弹窗要 Esc 时才轮到它；弹窗自己会 stopPropagation / 前置判定）
  if (event.key === "Escape" && uiStore.pageFullscreen) {
    event.preventDefault();
    uiStore.exitPageFullscreen();
    trackAction('NAV_SHORTCUT', { detail: 'Esc 退出页面全屏' });
    return;
  }
  // Ctrl+K：命令面板（在插件命令前判定，占位组合不允许被插件覆盖）
  if (
    event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.code === "KeyK"
  ) {
    event.preventDefault();
    commandPaletteOpen.value = true;
    trackAction("NAV_SHORTCUT", { detail: "Ctrl+K 命令面板" });
    return;
  }
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
  // 盯盘小组件气泡「新闻原文」点击：气泡窗口 focusable:false 且无 shell 权限，
  // 经 open-url 事件交主窗口用与热点新闻页一致的窗口逻辑打开（仅桌面端有气泡窗口）
  if (isTauri()) {
    void listen<WatchWidgetOpenUrlPayload>(WATCH_WIDGET_EVENTS.OPEN_URL, (event) => {
      if (event.payload?.url) void openInNewWindow(event.payload.url);
    }).then((unlisten) => {
      unlistenOpenUrl = unlisten;
    });
  }
});

/** open-url 事件退订句柄（仅桌面端注册） */
let unlistenOpenUrl: (() => void) | undefined;

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onGlobalKeydown, true);
  unlistenOpenUrl?.();
});

/** 切换侧栏收起状态 */
const toggleSidebar = (): void => {
  settingsStore.toggleSidebarCollapsed();
};

// ---------- 侧栏滑动玻璃气泡（与 BaseTabs/移动端 TabBar 同款动画，垂直方向） ----------

/** 侧栏 nav 容器（滑动气泡定位父级；收起/展开宽度动画由其 ResizeObserver 兜底重测） */
const navRef = ref<HTMLElement | null>(null);

/**
 * 激活菜单序号（驱动气泡位移；当前路由不在菜单内 = -1 气泡隐藏）
 *
 * 两种形态的 DOM 序列不同：展开态 = 分组渲染、跳过被折叠组，序号取
 * expandedFlatItems；收起态 = 扁平图标流（按组序展开、含被折叠组），序号取
 * collapsedFlatItems。两者都与其 data-nav-item 锚点的 DOM 顺序一致，
 * 气泡按序号取元素才能对得上。
 */
const activeNavIndex = computed(() => {
  const items = effectiveCollapsed.value ? collapsedFlatItems.value : expandedFlatItems.value;
  return items.findIndex((item) => isActive(item.path));
});

const { thumbStyle: navThumbStyle, measure: measureNavThumb } = useSlidingThumb({
  container: navRef,
  activeIndex: activeNavIndex,
  itemSelector: ":scope a[data-nav-item]",
});

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
         + 右侧工具（明暗/搜索/软件文档）+ 窗口控制 -->
    <TitleBar v-if="desktopChrome">
      <template #leading-tools>
        <HeaderTools
          :items="titleBarLeadingItems"
          :is-dark="isDark"
          @toggle-theme="toggleDark()"
          @open-search="commandPaletteOpen = true"
          @open-agent="openAgentAnalysis"
          @open-plugin-lab="openPluginLab"
          @open-site-docs-in-app="openSiteDocsInApp"
          @open-site-docs-in-browser="openSiteDocsInBrowser"
        />
      </template>
      <template #tools>
        <HeaderTools
          :items="titleBarTrailingItems"
          :is-dark="isDark"
          @toggle-theme="toggleDark()"
          @open-search="commandPaletteOpen = true"
          @open-agent="openAgentAnalysis"
          @open-plugin-lab="openPluginLab"
          @open-site-docs-in-app="openSiteDocsInApp"
          @open-site-docs-in-browser="openSiteDocsInBrowser"
        />
        <!-- 页面全屏：全局入口（王总 2026-10-17 指定移到顶栏，任意页面可用；
             置位后 MainLayout 隐藏侧栏 / 页内页头 / 停靠面板，页面根由
             .pc-page-fs 全局规则拉伸撑满），图标随态切换，Esc 亦可退出 -->
        <button
          type="button"
          class="pressable flex shrink-0 items-center justify-center rounded-lg p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
          :aria-label="pageFullscreen ? '退出页面全屏' : '页面全屏'"
          :title="pageFullscreen ? '退出页面全屏（Esc）' : '页面全屏'"
          data-track="PAGE_FULLSCREEN_TOGGLE"
          @click="uiStore.togglePageFullscreen()"
        >
          <MenuIcon :name="pageFullscreen ? 'minimize' : 'maximize'" :size="14" />
        </button>
      </template>
    </TitleBar>

    <!-- Islands 布局（2026-10-22）：本行是岛化画布——p-2.5 露出画布底色、gap-2.5
         是岛间隙；侧栏 / 页内页头 / 停靠面板各自为独立浮岛，标题栏不岛化保持通栏 -->
    <div class="flex min-h-0 flex-1 overflow-hidden gap-2.5 p-2.5">
      <!-- 左侧导航：常驻侧栏（桌面端品牌区与收起/展开开关均已上移至标题栏，
           顶部不再有头部块，导航加顶部留白；浏览器模式保留原头部块）。
           Islands（2026-10-22）：去贴边通栏的 border-r，改独立浮岛
           （rounded-2xl + shadow-island，overflow-hidden 裁圆角）。
           页面全屏（详情页铺满）时整体隐藏（v-show 保留 DOM，退出全屏零重建） -->
      <aside
        v-show="!pageFullscreen"
        class="flex shrink-0 flex-col overflow-hidden rounded-2xl bg-surface shadow-island transition-all duration-200"
        :class="sidebarWidthClass"
      >
        <!-- 浏览器模式头部：品牌 + 收起/展开开关（Tauri 桌面端整块移入 TitleBar，不渲染） -->
        <div
          v-if="!desktopChrome"
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
        <!-- overflow-x-clip：兜底掐掉意外横向溢出产生的横向滚动条（overflow-y:auto 会把
             overflow-x 计算成 auto）。收起态图标的 BaseTooltip 已 Teleport 到 body
             （fixed 定位），不受此裁剪影响 -->
        <nav
          ref="navRef"
          class="no-scrollbar relative flex-1 space-y-1 overflow-x-clip overflow-y-auto px-2"
          :class="desktopChrome ? 'pt-3' : ''"
        >
          <!-- 滑动玻璃气泡：菜单选中态底座，切换路由时按移动端同款动画滑到新项 -->
          <span
            v-if="navThumbStyle"
            class="pc-nav-bubble pointer-events-none z-0 rounded-lg"
            :style="navThumbStyle"
          ></span>

          <!-- 展开态：分组渲染。组头可折叠（持久化），归属由菜单声明决定 -->
          <template v-if="!effectiveCollapsed">
            <div v-for="group in menuGroups" :key="group.id" class="space-y-1">
              <button
                type="button"
                class="pressable flex w-full items-center justify-between rounded-md px-3 pb-1 pt-2 text-[11px] text-text-tertiary hover:text-text-secondary active:scale-[0.98]"
                :aria-label="`${isGroupCollapsed(group.id) ? '展开' : '收起'}${group.title}分组`"
                data-track="NAV_GROUP_TOGGLE"
                :data-track-detail="group.title"
                @click="toggleMenuGroup(group.id)"
              >
                <span>{{ group.title }}</span>
                <MenuIcon
                  name="chevronDown"
                  :size="12"
                  class="transition-transform duration-200"
                  :class="isGroupCollapsed(group.id) ? '-rotate-90' : ''"
                />
              </button>
              <!-- 折叠组条目高度过渡收起（参考市场总览指数卡片的展开/收起动画）。
                   离场即从 DOM 摘除（Transition 结束后），保证 data-nav-item 序列
                   与 expandedFlatItems 一一对应，滑动气泡按序号取元素才不跑位；
                   离场钩子还会先摘掉离场条目的锚点属性，过渡期内序号同样对得上 -->
              <Transition
                name="nav-group"
                @enter="onNavGroupEnter"
                @after-enter="onNavGroupAfterEnter"
                @leave="onNavGroupLeave"
                @after-leave="onNavGroupAfterLeave"
              >
                <div v-if="!isGroupCollapsed(group.id)" class="space-y-1">
                  <RouterLink
                    v-for="item in group.items"
                    :key="item.path"
                    :to="item.path"
                    data-nav-item
                    data-track="NAV_MENU_CLICK"
                    :data-track-detail="item.title"
                    class="group relative pressable flex items-center gap-3 rounded-lg px-3 py-2 text-sm active:scale-[0.98]"
                    :class="
                      isActive(item.path)
                        ? 'font-medium text-primary'
                        : 'text-text-secondary hover:bg-flat-weak'
                    "
                  >
                    <MenuIcon :name="item.icon" :size="16" />
                    <span class="truncate">{{ item.title }}</span>
                  </RouterLink>
                </div>
              </Transition>
            </div>
          </template>

          <!-- 收起态（64px 图标栏）：按分组渲染 + 组间短横线分隔（用户指定，2026-10-23）；
               顺序与展开态同源（按组序展开），不能用扁平 menuItems，否则两态顺序不一致。
               分隔线不带 data-nav-item 锚点，DOM 序列仍与 collapsedFlatItems 一一对应，
               滑动气泡按锚点序号取元素不受影响 -->
          <template v-else>
            <template v-for="(group, groupIndex) in menuGroups" :key="group.id">
              <div
                v-if="groupIndex > 0"
                role="separator"
                class="mx-auto my-1 h-px w-6 bg-flat-weak"
              ></div>
              <RouterLink
                v-for="item in group.items"
                :key="item.path"
                :to="item.path"
                data-nav-item
                data-track="NAV_MENU_CLICK"
                :data-track-detail="item.title"
                class="group relative pressable flex items-center justify-center gap-3 rounded-lg px-2 py-2 text-sm active:scale-[0.98]"
                :class="
                  isActive(item.path)
                    ? 'font-medium text-primary'
                    : 'text-text-secondary hover:bg-flat-weak'
                "
              >
                <MenuIcon :name="item.icon" :size="16" />
                <!-- 收起态无组头可读，tooltip 带「分组名-页面名」标明归属（用户指定 2026-10-23） -->
                <BaseTooltip :text="`${group.title}-${item.title}`" />
              </RouterLink>
            </template>
          </template>

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
          <!-- 设置入口：点击/hover 热区与上方菜单条目完全同形（px-3 py-2 text-sm 圆角块，用户指定 2026-10-23） -->
          <button
            type="button"
            class="group relative pressable flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm active:scale-[0.98] text-text-secondary hover:bg-flat-weak hover:text-text"
            :class="effectiveCollapsed ? 'justify-center px-2' : ''"
            aria-label="打开设置"
            data-track="NAV_SETTINGS_OPEN"
            @click="settingsOpen = true"
          >
            <MenuIcon name="settings" :size="16" />
            <span v-if="!effectiveCollapsed">设置</span>
            <BaseTooltip v-if="effectiveCollapsed" text="设置" />
          </button>
        </div>
      </aside>

      <!-- 右侧内容区（岛间隙 gap-2.5 承接页头岛与主区的间隔） -->
      <div class="relative flex min-w-0 flex-1 flex-col gap-2.5">
        <!-- 页内页头：页面全屏（详情页铺满）时隐藏（v-show，Teleport 的页级动作随之隐藏）。
             Islands（2026-10-22）：去贴边通栏的 border-b，改独立浮岛。
             与主区内容共用 max-w-[1600px] 居中约束：页头岛与页面卡片左右缘严格对齐 -->
        <header
          v-show="!pageFullscreen"
          class="mx-auto flex h-14 w-full max-w-[1600px] shrink-0 items-center justify-between rounded-2xl bg-surface px-5 shadow-island"
        >
          <div class="flex min-w-0 items-center gap-2">
            <!-- 返回上一页：仅历史栈存在 back 记录时展示（直达 / 首页不显示） -->
            <button
              v-if="hasHistoryBack"
              type="button"
              class="pressable rounded-lg p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
              aria-label="返回上一页"
              title="返回上一页"
              @click="router.back()"
            >
              <MenuIcon name="arrowLeft" :size="16" />
            </button>
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
              @open-search="commandPaletteOpen = true"
              @open-agent="openAgentAnalysis"
              @open-site-docs-in-app="openSiteDocsInApp"
              @open-site-docs-in-browser="openSiteDocsInBrowser"
            />
            <!-- 页级动作挂载点：当前激活页面经 Teleport 投射自己的动作按钮
                 （AI 分析 / 导出 Excel / 新闻源设置等，守卫见 use-page-header-slot） -->
            <div :id="PAGE_HEADER_ACTIONS_ID" class="flex items-center gap-2" />
            <!-- 插件设置：与页级动作按钮同款 ghost 样式（原裸齿轮图标与按钮群不搭，用户指定） -->
            <BaseButton
              variant="ghost"
              aria-label="插件设置"
              title="插件设置"
              data-track="PLUGIN_SETTINGS_OPEN"
              @click="pluginSettingsOpen = true"
            >
              <MenuIcon name="settings" :size="14" />
              插件设置
            </BaseButton>
          </div>
        </header>
        <main class="flex-1 overflow-y-auto" :class="pageFullscreen ? '' : 'pb-6'">
          <!-- pb-6 挂在滚动容器（main）而非内容容器（2026-10-24 双滚动条治理）：
               内容容器 h-full 定高后，「页面根 h-full 正好填满主区（无双滚动条）」与
               「长页面（市场总览等）滚动到底仍有底部留白」两者兼得——
               滚动范围含滚动容器自身的 padding-bottom。页面全屏时不加，保持 p-3 口径。
               内容上限 1600px：报价卡片栅格（quote-card-grid）在上限内按列宽公式排布；
               横向不留 padding，与页头岛共用 max-w-[1600px] 居中约束（对齐在页头岛类上），
               左右缘严格一致 -->
          <div
            class="@container h-full w-full"
            :class="pageFullscreen ? 'pc-page-fs flex min-h-0 flex-col p-3' : 'mx-auto max-w-[1600px]'"
          >
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
           挂到根上会变成纵向列项，把侧栏 / 主区高度挤没。
           页面全屏（详情页铺满）时隐藏，避免占用主区宽度 -->
      <DockPanel v-show="!pageFullscreen" />
    </div>

    <!-- 全局标的搜索弹窗（上下文选票：自选添加 / 插件选股） -->
    <StockSearchModal
      :open="searchModalOpen"
      @close="searchModalOpen = false"
      @select="onHeaderSearchSelect"
    />

    <!-- 全局命令面板（顶栏搜索按钮 + Ctrl+K：个股 / 页面 / 命令三合一） -->
    <CommandPalette
      :open="commandPaletteOpen"
      @close="commandPaletteOpen = false"
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

    <!-- 大A宝典固钉（右下角全局悬浮入口：icon 常驻、悬停展开字样，点击开口诀弹窗） -->
    <TreasuryFab />

    <!-- 插件确认弹窗（经 app:ui 的 confirm 发起，宿主渲染、答复回到插件的 Promise） -->
    <PluginConfirmHost />

    <!-- 插件选股弹窗（经 app:stock-picker 服务发起，宿主渲染、结果回到插件的 Promise） -->
    <PluginStockPickerHost />
  </div>
</template>

<style>
/* 全局氛围背景（2026-10-24 王总指定「整个界面背景太素」）：整界面叠一层与市场总览
   指数卡同方向的涨色渐变，但浓度降到 45%（color-mix 掺透明）——王总二次反馈
   「太深了，红色浅点、和指数卡片区分开」。fixed 钉在视口不随内容滚动；
   黑金主题的暖金雾按更高特异性在 theme.css 覆盖本条，互不影响。
   只放 MainLayout：官网 / 移动端 / 小组件窗口不受影响 */
body {
  background-image: linear-gradient(
    135deg,
    color-mix(in srgb, var(--color-up-weak) 45%, transparent),
    transparent 70%
  );
  background-attachment: fixed;
}
</style>

<style scoped>
/* 侧栏分组条目高度过渡：起止高度由 JS 钩子写内联（auto 不可动画），
   这里只负责过渡曲线与裁切；收尾后高度交还内容自适应 */
.nav-group-enter-active,
.nav-group-leave-active {
  overflow: hidden;
  transition: height 200ms ease;
}

/* 尊重系统「减少动态效果」偏好：直接跳变，不播过渡 */
@media (prefers-reduced-motion: reduce) {
  .nav-group-enter-active,
  .nav-group-leave-active {
    transition: none;
  }
}
</style>
