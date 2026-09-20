/**
 * 插件路由桥：把插件路由注册表同步到 vue-router 实例
 *
 * 为什么不让插件直接 `router.addRoute()`：路由实例在 `main.ts` 里创建，
 * 而插件在创建之前就已挂载（贡献点需要先于首个导航就绪）。桥接层订阅
 * 路由注册表的版本号，把「插件注册 / 卸载路由」翻译成 `addRoute` 与其撤销函数，
 * 插件因此完全不需要知道 router 的存在。
 */
import { watch } from 'vue';
import { LAYOUT_ROUTE_NAME } from '../constants/router-meta.constants';
import { pluginKernel } from './index';
import type { RouteRecordRaw, Router } from 'vue-router';
import type { RegisteredRoute } from '../types/plugin.types';

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
 * 因此「禁用插件」＝「它的页面路径立刻落到 404 兜底页」。
 * @param router vue-router 实例
 * @returns 停止同步的撤销函数（仅测试 / 热更新场景需要）
 */
export const attachPluginRoutes = (router: Router): (() => void) => {
  /** 已挂载的插件路由：key → addRoute 返回的移除函数 */
  const mounted = new Map<string, () => void>();

  /** 按当前注册表同步一次（新增缺失的、移除已消失的） */
  const sync = (): void => {
    const wanted = new Set<string>();
    for (const route of pluginKernel.contributions.routes.routes) {
      wanted.add(route.key);
      if (mounted.has(route.key)) continue;
      const record = toRouteRecord(route);
      mounted.set(
        route.key,
        route.underLayout
          ? router.addRoute(LAYOUT_ROUTE_NAME, record)
          : router.addRoute(record),
      );
    }
    for (const [key, remove] of [...mounted]) {
      if (wanted.has(key)) continue;
      remove();
      mounted.delete(key);
    }
  };

  sync();
  const stop = watch(() => pluginKernel.contributions.routes.version.value, sync);
  return () => {
    stop();
    for (const remove of mounted.values()) remove();
    mounted.clear();
  };
};
