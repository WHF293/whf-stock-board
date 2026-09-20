/**
 * 插件路由桥：把插件路由注册表同步到 vue-router 实例
 *
 * 为什么不让插件直接 `router.addRoute()`：路由实例在 `main.ts` 里创建，
 * 而插件在创建之前就已挂载（贡献点需要先于首个导航就绪）。桥接层订阅
 * 路由注册表的版本号，把「插件注册 / 卸载路由」翻译成 `addRoute` 与其撤销函数，
 * 插件因此完全不需要知道 router 的存在。
 *
 * 附带一件事：**用户正停在被撤销的那个页面上**时把上下文交给宿主收尾
 * （`onVanishedRoute`）——插件被关掉后页面其实已经不存在了，得有人把用户接走。
 */
import { watch } from 'vue';
import { LAYOUT_ROUTE_NAME } from '../constants/router-meta.constants';
import { findVanishedRoute } from '../utils/find-vanished-route';
import { pluginKernel } from './index';
import type { RouteRecordRaw, Router } from 'vue-router';
import type {
  PluginRouteBridgeOptions,
  RegisteredRoute,
  VanishedRouteInfo,
} from '../types/plugin.types';

/** 已挂载的插件路由条目 */
interface MountedRoute {
  /** 注册时的路由声明快照（撤销后注册表里就查不到了，归属信息只能靠它） */
  route: RegisteredRoute;
  /** `addRoute` 返回的移除函数 */
  remove: () => void;
}

/**
 * 插件路由声明 → vue-router 路由记录
 * @param route 已注册的插件路由
 * @returns vue-router 路由记录（不含 children）
 */
const toRouteRecord = (route: RegisteredRoute): RouteRecordRaw => {
  const record = {
    path: route.path,
    component: route.component,
    props: route.props,
    meta: route.meta,
  } as RouteRecordRaw;
  if (route.name) {
    record.name = route.name;
  }
  return record;
};

/**
 * 把插件路由挂到 router 上，并持续跟随注册表增删
 *
 * 已挂载的路由按 key 记账；注册表里消失的 key 会调用 `addRoute` 返回的撤销函数，
 * 因此「禁用插件」＝「它的页面路径立刻失效」。若被撤销的正是用户当前停留的页面，
 * 则把上下文交给宿主策略处理（缺省不处理）。
 * @param router vue-router 实例
 * @param options 宿主策略（当前停留页随插件撤销时的收尾）
 * @returns 停止同步的撤销函数（仅测试 / 热更新场景需要）
 */
export const attachPluginRoutes = (
  router: Router,
  options: PluginRouteBridgeOptions = {},
): (() => void) => {
  /** 已挂载的插件路由：key → 路由声明 + 移除函数 */
  const mounted = new Map<string, MountedRoute>();

  /**
   * 当前停留的页面随插件撤销时的收尾（检测 + 交给宿主）
   * @param vanished 本次被撤销的全部插件路由
   */
  const handleVanishedRoutes = (vanished: readonly RegisteredRoute[]): void => {
    const onVanishedRoute = options.onVanishedRoute;
    if (!onVanishedRoute) return;
    const current = router.currentRoute.value;
    const matchedPath = findVanishedRoute(
      current.matched.map((record) => record.path),
      vanished.map((route) => route.path),
    );
    if (!matchedPath) return;
    const owner = vanished.find((route) => route.path === matchedPath);
    if (!owner) return;
    const info: VanishedRouteInfo = {
      path: current.path,
      title: typeof current.meta.title === 'string' ? current.meta.title : '',
      pluginId: owner.pluginId,
      // 插件可能已整体注销（用户插件卸载），此时退回 id 而不是空串
      pluginName: pluginKernel.get(owner.pluginId)?.name ?? owner.pluginId,
    };
    onVanishedRoute(info);
  };

  /** 按当前注册表同步一次（新增缺失的、移除已消失的） */
  const sync = (): void => {
    const wanted = new Set<string>();
    for (const route of pluginKernel.contributions.routes.routes) {
      wanted.add(route.key);
      if (mounted.has(route.key)) continue;
      mounted.set(route.key, {
        route,
        remove: route.underLayout
          ? router.addRoute(LAYOUT_ROUTE_NAME, toRouteRecord(route))
          : router.addRoute(toRouteRecord(route)),
      });
    }
    const vanished: RegisteredRoute[] = [];
    for (const [key, entry] of [...mounted]) {
      if (wanted.has(key)) continue;
      entry.remove();
      mounted.delete(key);
      vanished.push(entry.route);
    }
    // 撤销之后再判定：兜底落点必须来自「撤销后仍注册」的页面，否则会跳进另一个空页
    if (vanished.length > 0) handleVanishedRoutes(vanished);
  };

  sync();
  const stop = watch(() => pluginKernel.contributions.routes.version.value, sync);
  return () => {
    stop();
    for (const entry of mounted.values()) entry.remove();
    mounted.clear();
  };
};
