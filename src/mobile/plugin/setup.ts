/**
 * 移动端插件装配（宿主启动入口，2026-10-30 起移动端具备插件体系）
 *
 * 与 PC（`pc/plugin/setup.ts`）共用同一条内核（common/plugin），装配顺序一致：
 * 1. 运行时桥先挂 —— 第三方产物模块求值时要拿 vue 运行时；
 * 2. 宿主服务进服务容器 —— 只提供移动端有意义的**子集**：缺席
 *    `panel:open` / `panel:close`（无侧栏与停靠面板）、`app:agent-ask`（无 Agent）、
 *    `app:stock-picker` / `app:watch-widget-settings`（无对应宿主 UI）；
 * 3. 插件路由顶层注册（移动端无主布局路由，`layoutRouteName: null`）；
 * 4. 只挂声明了 `devices` 含 mobile 的用户插件（内置插件清单不进移动包；
 *    未声明 devices 的历史安装记录视作仅 PC，直接不挂）。
 */
import * as vueRuntime from 'vue';
import { computed } from 'vue';
import { closeNotify, showConfirmDialog, showNotify, showToast } from 'vant';
import { APP_VERSION } from '../../common/constants/app-info.constants.ts';
import {
  NOTIFY_TONE,
} from '../../common/constants/notify.constants.ts';
import {
  PLUGIN_DEVICE_DEFAULT,
  PLUGIN_RUNTIME_BRIDGE_KEY,
  PLUGIN_VANISHED_NOTICE_BODY,
  PLUGIN_VANISHED_NOTICE_SOURCE,
  PLUGIN_VANISHED_NOTICE_TITLE,
} from '../../common/constants/plugin.constants.ts';
import { MARKET_STATUS_REFRESH_INTERVAL_MS } from '../../common/constants/polling.constants.ts';
import { STOCK_PROXY_ALLOWED_HOSTS } from '../../common/constants/proxy.constants.ts';
import { searchStocks } from '../../common/api/search.api.ts';
import { fetchFullQuotes } from '../../common/api/quotes.api.ts';
import { proxyFetch } from '../../common/api/proxy-fetch';
import { pluginKernel } from '../../common/plugin/index';
import {
  createFormatService,
  createMarketDataService,
  createMarketService,
  createPollingService,
  createWatchlistService,
} from '../../common/plugin/app-services';
import { mountUserPluginRecord } from '../../common/plugin/user-plugin-loader';
import { attachPluginRoutes } from '../../common/plugin/router-bridge';
import { useMarketStatusStore } from '../../common/stores/market-status';
import { usePluginStore } from '../../common/stores/plugin';
import { useSettingsStore } from '../../common/stores/settings';
import { useUserPluginsStore } from '../../common/stores/user-plugins';
import { useTheme } from '../../common/composables/use-theme';
import { useTabConfig } from '../../common/composables/use-tab-config';
import { openExternalUrl } from '../../common/utils/open-external-url';
import { isUrlInAllowedHosts } from '../../common/utils/url-in-allowed-hosts';
import { toFullSymbol } from '../../common/utils/to-full-symbol';
import BaseButton from '../../pc/components/ui/BaseButton.vue';
import BaseCard from '../../pc/components/ui/BaseCard.vue';
import BaseEmpty from '../../pc/components/ui/BaseEmpty.vue';
import BaseInput from '../../pc/components/ui/BaseInput.vue';
import BaseSwitch from '../../pc/components/ui/BaseSwitch.vue';
import BaseTabs from '../../pc/components/ui/BaseTabs.vue';
import BaseTag from '../../pc/components/ui/BaseTag.vue';
import BaseTable from '../../pc/components/ui/BaseTable.vue';
import BaseModal from '../../pc/components/ui/BaseModal.vue';
import BaseDrawer from '../../pc/components/ui/BaseDrawer.vue';
import BaseSkeleton from '../../pc/components/ui/BaseSkeleton.vue';
import MenuIcon from '../../pc/components/ui/MenuIcon.vue';
import TabConfigButton from '../../pc/components/ui/TabConfigButton.vue';
import { MOBILE_MARKET_STATUS_TICK_MS, MOBILE_STOCK_DETAIL_PATH_PREFIX } from '../constants';
import { mobileRouter } from '../router';
import type { NotifyTone } from '../../common/types/notify.types.ts';
import type {
  UiConfirmOptions,
  VanishedRouteInfo,
} from '../../common/types/plugin.types.ts';
import type { Pinia } from 'pinia';

/** 是否已装配（重复调用直接返回，避免热更新时重复挂载） */
let installed = false;

/** 浮窗自增序号（`app:notify.notify` 返回值的 id 来源；Vant 无单条关闭句柄，id 仅作契约占位） */
let notifySeq = 0;

/** 宿主浮窗语气 → Vant Notify 类型（Vant 无涨跌主题概念，按 A 股默认红涨绿跌取语义色） */
const NOTIFY_TONE_TO_VANT = {
  flat: 'primary',
  up: 'danger',
  down: 'success',
  primary: 'primary',
} as const satisfies Record<NotifyTone, string>;

/**
 * 确认弹窗：Vant showConfirmDialog 承载（移动端无 PC 的 PluginConfirmHost 宿主）
 *
 * `okVariant`（primary/danger）不映射 —— Vant Dialog 无单按钮配色入参，文案语义已足够。
 * @param options 确认弹窗参数（缺省全默认）
 * @returns 用户是否点了确认
 */
const confirmViaVant = async (options?: UiConfirmOptions): Promise<boolean> => {
  try {
    await showConfirmDialog({
      title: options?.title,
      message: options?.content,
      confirmButtonText: options?.okText,
      cancelButtonText: options?.cancelText,
      showCancelButton: true,
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * 用户正停留的插件页随插件撤销时的收尾（移动端版）
 *
 * 移动端没有宿主菜单与 `fallbackLanding` 落点体系，统一送回首页并轻提示。
 * 用 `replace` 而不是 `push`：原页面已不存在，留在历史里只会让「后退」再撞一次。
 * @param info 消失页面的上下文（由路由桥在撤销路由时给出）
 */
const recoverVanishedRoute = (info: VanishedRouteInfo): void => {
  void mobileRouter.replace('/');
  showToast(
    `${PLUGIN_VANISHED_NOTICE_TITLE(info.pluginName)}，`
    + `${PLUGIN_VANISHED_NOTICE_BODY(info.title, '首页')}`,
  );
};

/**
 * 异步挂载声明了 mobile 支持端的用户插件，并还原「直刷插件路由」的启动路径
 *
 * 与 PC 版的差异：
 * - 无内置插件可接管，occupiedIds 恒空；
 * - 未声明 `devices` 含 mobile 的记录（含历史安装的缺省记录）直接跳过不挂；
 * - hash 路由：启动路径取 `location.hash` 的路径段（去 `#` 与查询串）；
 * - 移动路由无 404 catch-all：直刷插件路由时当前路由 matched 为空，
 *   挂载完成后只要启动路径可解析且未正确落位，就 replace 回去。
 * @param userPluginsStore 用户插件 store（持久化记录）
 * @param pluginStore 插件偏好 store（启停判定）
 */
const mountUserPluginsLater = async (
  userPluginsStore: ReturnType<typeof useUserPluginsStore>,
  pluginStore: ReturnType<typeof usePluginStore>,
): Promise<void> => {
  const bootPath = window.location.hash.slice(1).split('?')[0] || '/';

  for (const record of userPluginsStore.records) {
    // 未声明 devices 视作仅 PC（缺省契约），移动端不挂
    if (!(record.devices ?? PLUGIN_DEVICE_DEFAULT).includes('mobile')) continue;
    const result = await mountUserPluginRecord(
      record,
      pluginStore.isPluginEnabled(record.id),
      [],
    );
    if (!result.ok) {
      console.error(`[plugin] 用户插件 ${record.id} 启动挂载失败：${result.error}`);
    }
  }

  const resolved = mobileRouter.resolve(bootPath);
  const current = mobileRouter.currentRoute.value;
  const landedOnBootPath = current.matched.length > 0 && current.path === bootPath;
  if (resolved.matched.length > 0 && !landedOnBootPath) {
    void mobileRouter.replace(bootPath);
  }
};

/**
 * 装配移动端插件体系（幂等）
 *
 * 必须在 `app.use(pinia)` 之后、`app.use(mobileRouter)` 之前调用：
 * 插件路由要在首个导航就绪，否则直刷插件页会先落空。
 * 用户插件（应用内安装）是动态 import，挂载是异步的：见 `mountUserPluginsLater`。
 * @param pinia 应用 pinia 实例（缺省时用当前活动实例）
 */
export const installMobilePlugins = (pinia?: Pinia): void => {
  if (installed) return;
  installed = true;

  // 0. 运行时桥必须在**任何插件模块求值之前**挂好（与 PC 同一条约定）
  (globalThis as unknown as Record<string, unknown>)[PLUGIN_RUNTIME_BRIDGE_KEY] =
    Object.freeze({ vue: vueRuntime });

  const pluginStore = pinia ? usePluginStore(pinia) : usePluginStore();
  const userPluginsStore = pinia ? useUserPluginsStore(pinia) : useUserPluginsStore();

  // 1. 宿主服务进服务容器（移动端子集；缺席服务见文件头注释）
  pluginKernel.services.provide('app:version', APP_VERSION);
  pluginKernel.services.provide('kernel:runtime', pluginKernel.reader());
  pluginKernel.services.provide('app:navigate', (path: string): void => {
    void mobileRouter.push(path);
  });
  // 外链打开：插件 import 不了 tauri plugin-opener，系统浏览器跳转统一由宿主代办
  pluginKernel.services.provide('app:open-url', openExternalUrl);
  // 标的搜索：宿主封装 stock-sdk 的腾讯搜索，插件自建 UI 消费（调用方自行防抖）
  pluginKernel.services.provide('app:stock-search', { search: searchStocks });

  // 受控网络请求：走宿主的上游通道（Tauri 由 Rust 直连 / 浏览器走 /stock-proxy），
  // 域名白名单与宿主完全同源
  pluginKernel.services.provide('app:http', {
    fetch: proxyFetch,
    allowedHosts: STOCK_PROXY_ALLOWED_HOSTS,
    isAllowed: isUrlInAllowedHosts,
  });
  // 行情报价：宿主封装腾讯源，插件不必自己拼上游 URL、处理转码与频率红线
  pluginKernel.services.provide('app:quotes', { fetchFullQuotes });

  // 格式化 / 涨跌语义 / 限速节拍：宿主口径（红涨绿跌、符号互转），common 工厂两端同源
  pluginKernel.services.provide('app:format', createFormatService());
  pluginKernel.services.provide('app:market', createMarketService());
  pluginKernel.services.provide('app:market-data', createMarketDataService());
  pluginKernel.services.provide('app:polling', createPollingService());
  pluginKernel.services.provide('app:watchlist', createWatchlistService(pinia));

  // 打开个股：移动端没有右侧侧栏，单击 / 双击两条语义都落详情二级页；
  // 来源列表无处承载，忽略（详情页本就以单标的为心智）
  const openStockDetail = (symbol: string): void => {
    void mobileRouter.push(`${MOBILE_STOCK_DETAIL_PATH_PREFIX}/${toFullSymbol(symbol)}`);
  };
  pluginKernel.services.provide('app:stock-open', {
    openSidebar: openStockDetail,
    openPage: openStockDetail,
  });

  // 市场状态：A 股盘中判定（交易日历 + 分钟级时钟）只有宿主一份实现。
  // 移动端此前从不驱动该 store（PC 由 MainLayout 驱动），装配层补上
  // 挂载即刷新 + 分钟级 tick + 周期刷新，交易窗口 getter 两端同源
  const marketStatusStore = pinia ? useMarketStatusStore(pinia) : useMarketStatusStore();
  pluginKernel.services.provide('app:market-status', {
    isIntraday: computed(() => marketStatusStore.isAShareIntraday),
  });
  void marketStatusStore.refresh();
  setInterval(() => marketStatusStore.refresh(), MARKET_STATUS_REFRESH_INTERVAL_MS);
  setInterval(() => marketStatusStore.tick(), MOBILE_MARKET_STATUS_TICK_MS);

  // 主题实时快照：三值与宿主页面完全同源（settings store 持久化，移动端共用同一份）
  const settingsStore = pinia ? useSettingsStore(pinia) : useSettingsStore();
  const { isDark } = useTheme();
  pluginKernel.services.provide('app:theme', {
    isDark,
    themeColor: computed(() => settingsStore.themeColor),
    trendTheme: computed(() => settingsStore.trendTheme),
  });

  // UI Kit：PC 基础组件原样下发（Tailwind token 两端共享同一份 theme.css），
  // confirm 走 Vant 弹窗 —— 组件风格与原生页面一致，插件无需自备 UI
  pluginKernel.services.provide('app:ui', {
    Button: BaseButton,
    Card: BaseCard,
    Empty: BaseEmpty,
    Input: BaseInput,
    Switch: BaseSwitch,
    Tabs: BaseTabs,
    Tag: BaseTag,
    Table: BaseTable,
    Modal: BaseModal,
    Drawer: BaseDrawer,
    Skeleton: BaseSkeleton,
    Icon: MenuIcon,
    TabConfigButton,
    useTabConfig,
    confirm: confirmViaVant,
  });

  // 应用级浮窗：Vant Notify 承载（timeoutMs 0 = 常驻，与宿主 NotifyOptions 语义一致）。
  // Vant 无单条关闭句柄：dismiss 降级为关闭全部，dismissBySource 无对应能力降级 no-op
  pluginKernel.services.provide('app:notify', {
    notify: (options) => {
      notifySeq += 1;
      const heading = options.source
        ? `【${options.source}】${options.title}`
        : options.title;
      showNotify({
        type: NOTIFY_TONE_TO_VANT[options.tone ?? NOTIFY_TONE.FLAT],
        message: options.body ? `${heading}\n${options.body}` : heading,
        duration: options.timeoutMs,
        onClick: options.onClick,
      });
      return `${PLUGIN_VANISHED_NOTICE_SOURCE}-${notifySeq}`;
    },
    dismiss: () => closeNotify(),
    dismissBySource: (): void => undefined,
  });

  // 2. 清理已下线插件的残留偏好（移动端无内置插件，存活名单只有用户插件）
  pluginStore.pruneUnknownPlugins(userPluginsStore.records.map((record) => record.id));

  // 3. 插件路由挂到移动 router（顶层注册；后续启停插件时由版本号驱动的桥持续同步）
  attachPluginRoutes(mobileRouter, {
    layoutRouteName: null,
    onVanishedRoute: recoverVanishedRoute,
  });

  // 4. 用户插件异步挂载（不阻塞首屏；路由由 router-bridge 的版本号机制补挂）
  void mountUserPluginsLater(userPluginsStore, pluginStore);

  /** 路由切换对外广播，插件可据此做「离开页面时保存」之类的联动 */
  mobileRouter.afterEach((to, from) => {
    pluginKernel.events.emit('route:changed', [to.path, from.path], 'router');
  });
};
