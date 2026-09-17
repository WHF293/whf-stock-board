/**
 * 插件装配（宿主启动入口）
 *
 * 启动顺序（`main.ts` 在 `app.use(pinia)` 之后调用）：
 * 1. 宿主能力先登记进服务容器 —— 插件的 `apply` 里就能 `consume` 到；
 * 2. 按持久化黑名单逐个 `use()` 内置插件（依赖关系由内核自行收敛）；
 * 3. 把插件路由同步到 vue-router；
 * 4. 异步挂载用户插件（应用内安装，动态 import，见 `mountUserPluginsLater`）。
 *
 * 停止 / 重启插件不在这里做：用户在「设置 → 插件」里切换时，
 * `usePlugins()` 会直接调 `pluginKernel.setEnabled()`，内核即时卸载 / 重挂。
 */
import { APP_VERSION } from '../constants/app-info.constants';
import { BUILTIN_PLUGINS } from '../plugins';
import { pluginKernel } from './index';
import { mountUserPluginRecord } from './user-plugin-loader';
import { attachPluginRoutes } from './router-bridge';
import { router } from '../router';
import { usePluginPanelsStore } from '../stores/plugin-panels';
import { usePluginStore } from '../stores/plugin';
import { useNotificationsStore } from '../stores/notifications';
import { useUserPluginsStore } from '../stores/user-plugins';
import type { Pinia } from 'pinia';

/** 是否已装配（重复调用直接返回，避免热更新时重复挂载） */
let installed = false;

/**
 * 打开一个插件面板（宿主能力，作为 `panel:open` 服务提供给插件）
 *
 * drawer 面板 → 打开右侧抽屉；inline 面板 → 取消折叠并滚动到可视区。
 * @param panelKey 面板全局键（`<pluginId>#<panelId>`）
 */
const openPanelByKey = (panelKey: string): void => {
  const panel = pluginKernel.contributions.sidebar.panels.find(
    (item) => item.key === panelKey,
  );
  if (!panel) {
    console.warn(`[plugin] 面板不存在：${panelKey}`);
    return;
  }
  const panelsStore = usePluginPanelsStore();
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
  attachPluginRoutes(router);

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
 * 直刷 `/xxx`（插件页面）会被 404 兜底重定向走。挂载完成后用启动时快照的
 * 路径重解析一次：解析结果与快照完全一致（排除重定向路由）且当前不在这条
 * 路径上，才 replace 回去——普通启动路径不受影响。
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
  if (
    resolved.href === bootPath
    && router.currentRoute.value.fullPath !== bootPath
  ) {
    void router.replace(bootPath);
  }
};
