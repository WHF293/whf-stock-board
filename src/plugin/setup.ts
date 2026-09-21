/**
 * 插件装配（宿主启动入口）
 *
 * 启动顺序（`main.ts` 在 `app.use(pinia)` 之后调用）：
 * 1. 宿主能力先登记进服务容器 —— 插件的 `apply` 里就能 `consume` 到；
 * 2. 按持久化黑名单逐个 `use()` 内置插件（依赖关系由内核自行收敛）；
 * 3. 把插件路由同步到 vue-router（并接住「用户正停在被撤销的插件页上」的情况）；
 * 4. 异步挂载用户插件（应用内安装，动态 import，见 `mountUserPluginsLater`）。
 *
 * 停止 / 重启插件不在这里做：用户在「设置 → 插件」里切换时，
 * `usePlugins()` 会直接调 `pluginKernel.setEnabled()`，内核即时卸载 / 重挂。
 */
import { APP_VERSION } from '../constants/app-info.constants';
import { NOTIFY_TONE } from '../constants/notify.constants';
import {
  PLUGIN_VANISHED_NOTICE_BODY,
  PLUGIN_VANISHED_NOTICE_SOURCE,
  PLUGIN_VANISHED_NOTICE_TITLE,
} from '../constants/plugin.constants';
import {
  MENU_ITEMS,
  NOT_FOUND_ROUTE_NAME,
  ROUTE_PATH,
} from '../constants/router-meta.constants';
import { orderSidebarMenu } from '../utils/order-sidebar-menu';
import { resolveRouteFallback } from '../utils/resolve-route-fallback';
import { searchStocks } from '../api/search.api';
import { BUILTIN_PLUGINS } from '../plugins';
import { pluginKernel } from './index';
import { mountUserPluginRecord } from './user-plugin-loader';
import { attachPluginRoutes } from './router-bridge';
import { router } from '../router';
import { usePluginPanelsStore } from '../stores/plugin-panels';
import { usePluginStore } from '../stores/plugin';
import { useNotificationsStore } from '../stores/notifications';
import { useSettingsStore } from '../stores/settings';
import { useUserPluginsStore } from '../stores/user-plugins';
import type { VanishedRouteInfo } from '../types/plugin.types';
import type { Pinia } from 'pinia';

/** 是否已装配（重复调用直接返回，避免热更新时重复挂载） */
let installed = false;

/**
 * 打开一个插件面板（宿主能力，作为 `panel:open` 服务提供给插件）
 *
 * 三种承载形态统一走这一个入口，调用方不必知道面板挂在哪：
 * - drawer 面板 → 打开右侧抽屉；
 * - inline 面板 → 取消折叠并滚动到可视区；
 * - 顶栏条目 → 展开它的下拉面板（`HeaderItemHost` 消费请求）。
 * @param panelKey 面板全局键（`<pluginId>#<panelId>`）
 */
const openPanelByKey = (panelKey: string): void => {
  const panelsStore = usePluginPanelsStore();
  const headerItem = pluginKernel.contributions.header.items.find(
    (item) => item.key === panelKey,
  );
  if (headerItem) {
    panelsStore.requestHeaderOpen(panelKey);
    return;
  }
  const panel = pluginKernel.contributions.sidebar.panels.find(
    (item) => item.key === panelKey,
  );
  if (!panel) {
    console.warn(`[plugin] 面板不存在：${panelKey}`);
    return;
  }
  if (panel.mode === 'drawer') {
    panelsStore.openDrawer(panelKey);
    return;
  }
  const pluginStore = usePluginStore();
  if (pluginStore.isPanelCollapsed(panelKey)) {
    pluginStore.togglePanelCollapsed(panelKey);
  }
  panelsStore.requestReveal(panelKey);
};

/**
 * 用户正停留的插件页随插件撤销时的收尾：把他送到一个**仍然存在**的页面，并说明原因
 *
 * 三级落点全部取自「撤销之后」的注册表，所以不会跳进另一个刚消失的页面；
 * 第一级「兜底落点」两处来源并存：宿主自带的正式页面（如插件工坊，在
 * `MENU_ITEMS` 里声明）与插件自己声明的贡献点（`ctx.menu.add` 的 `fallbackLanding`）。
 * ② 侧栏第一个菜单（顺序与界面完全同源：`orderSidebarMenu`）；
 * ③ 宿主首页（侧栏菜单全被用户隐藏时的最后一道）。
 *
 * 用 `replace` 而不是 `push`：原页面已不存在，留在历史里只会让「后退」撞上 404 兜底。
 * @param info 消失页面的上下文（由路由桥在撤销路由时给出）
 */
const recoverVanishedRoute = (info: VanishedRouteInfo): void => {
  const settingsStore = useSettingsStore();
  const sidebar = orderSidebarMenu(
    MENU_ITEMS,
    pluginKernel.contributions.menu.items,
    settingsStore.menuOrder,
    settingsStore.hiddenMenus,
  );
  const target = resolveRouteFallback({
    landingPaths: [
      // 宿主自带页面的声明优先（恒可用），再是插件声明的落点
      ...MENU_ITEMS.filter((item) => item.fallbackLanding === true).map((item) => item.path),
      ...pluginKernel.contributions.menu.items
        .filter((item) => item.fallbackLanding)
        .map((item) => item.path),
    ],
    sidebarPaths: sidebar.map((item) => item.path),
    defaultPath: ROUTE_PATH.DASHBOARD,
  });
  void router.replace(target);

  const targetTitle = router.resolve(target).meta.title;
  useNotificationsStore().push({
    source: PLUGIN_VANISHED_NOTICE_SOURCE,
    tone: NOTIFY_TONE.FLAT,
    title: PLUGIN_VANISHED_NOTICE_TITLE(info.pluginName),
    body: PLUGIN_VANISHED_NOTICE_BODY(
      info.title,
      typeof targetTitle === 'string' ? targetTitle : target,
    ),
  });
};

/**
 * 装配插件体系（幂等）
 *
 * 必须在 `app.use(pinia)` 之后、首个导航之前调用：
 * 插件路由要在首个导航就绪，否则直接命中 404 兜底。
 * 用户插件（应用内安装）是动态 import，挂载是异步的：见 `mountUserPluginsLater`。
 * @param pinia 应用 pinia 实例（缺省时用当前活动实例）
 */
export const installPlugins = (pinia?: Pinia): void => {
  if (installed) return;
  installed = true;

  const pluginStore = pinia ? usePluginStore(pinia) : usePluginStore();
  const userPluginsStore = pinia
    ? useUserPluginsStore(pinia)
    : useUserPluginsStore();

  // 1. 宿主能力进服务容器（这些副作用的生命周期 = 应用进程，不进任何插件的作用域）
  pluginKernel.services.provide('app:version', APP_VERSION);
  pluginKernel.services.provide('kernel:runtime', pluginKernel.reader());
  pluginKernel.services.provide('app:navigate', (path: string): void => {
    void router.push(path);
  });
  // 标的搜索：宿主封装 stock-sdk 的腾讯搜索，插件自建 UI 消费（调用方自行防抖）
  pluginKernel.services.provide('app:stock-search', { search: searchStocks });
  pluginKernel.services.provide('panel:open', openPanelByKey);

  // 应用级浮窗：插件发起、宿主渲染（承载组件在 MainLayout，与插件面板挂载状态无关）
  const notificationsStore = pinia
    ? useNotificationsStore(pinia)
    : useNotificationsStore();
  pluginKernel.services.provide('app:notify', {
    notify: (options) => notificationsStore.push(options),
    dismiss: (id) => notificationsStore.dismiss(id),
    dismissBySource: (source) => notificationsStore.dismissBySource(source),
  });

  // 2. 清理已下线插件的残留偏好，再按黑名单挂载
  //    存活名单要包含用户插件：它们此刻还没进内核，但持久化记录已经在了
  const builtinIds = BUILTIN_PLUGINS.map((plugin) => plugin.id);
  pluginStore.pruneUnknownPlugins([...builtinIds, ...userPluginsStore.records.map((record) => record.id)]);
  for (const plugin of BUILTIN_PLUGINS) {
    pluginKernel.use(plugin, { enabled: pluginStore.isPluginEnabled(plugin.id) });
  }

  // 3. 插件路由挂到 router（后续启停插件时由版本号驱动的桥持续同步）
  attachPluginRoutes(router, { onVanishedRoute: recoverVanishedRoute });

  // 4. 用户插件异步挂载（不阻塞首屏；路由由 router-bridge 的版本号机制补挂）
  void mountUserPluginsLater(userPluginsStore, pluginStore);

  /**
   * 路由切换对外广播，插件可据此做「离开页面时保存」之类的联动
   */
  router.afterEach((to, from) => {
    pluginKernel.events.emit('route:changed', [to.path, from.path], 'router');
  });
};

/**
 * 异步挂载全部用户插件，并在必要时还原「直接刷新到插件路由」的启动路径
 *
 * 动态 import 无法同步完成，因此首个导航发生时用户插件路由可能还没注册，
 * 直刷 `/xxx`（插件页面）会先落到 404 兜底页。挂载完成后用启动时快照的
 * 路径重解析一次：解析结果与快照完全一致（排除重定向路由）且当前不在这条
 * 路径上（含正停在 404 兜底页的情况），才 replace 回去——普通启动路径不受影响。
 * @param userPluginsStore 用户插件 store（持久化记录）
 * @param pluginStore 插件偏好 store（黑名单判定）
 */
const mountUserPluginsLater = async (
  userPluginsStore: ReturnType<typeof useUserPluginsStore>,
  pluginStore: ReturnType<typeof usePluginStore>,
): Promise<void> => {
  const bootPath = window.location.pathname;
  const builtinIds = BUILTIN_PLUGINS.map((plugin) => plugin.id);

  for (const record of userPluginsStore.records) {
    const result = await mountUserPluginRecord(
      record,
      pluginStore.isPluginEnabled(record.id),
      builtinIds,
    );
    if (!result.ok) {
      console.error(`[plugin] 用户插件 ${record.id} 启动挂载失败：${result.error}`);
    }
  }

  const resolved = router.resolve(bootPath);
  // 404 兜底页与目标路径同 path（catch-all 匹配），此时 fullPath 判定失效，
  // 需按路由 name 识别「正停在兜底页」
  const onNotFoundRoute = router.currentRoute.value.name === NOT_FOUND_ROUTE_NAME;
  if (
    resolved.href === bootPath
    && (onNotFoundRoute || router.currentRoute.value.fullPath !== bootPath)
  ) {
    void router.replace(bootPath);
  }
};
