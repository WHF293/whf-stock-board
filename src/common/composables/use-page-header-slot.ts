import { onActivated, onBeforeUnmount, onDeactivated, ref, type Ref } from 'vue';

/** 页级动作挂载点的 DOM id（MainLayout 页头右侧容器，Teleport 目标） */
export const PAGE_HEADER_ACTIONS_ID = 'page-header-actions';

/** Teleport 目标选择器：`#page-header-actions` */
export const PAGE_HEADER_ACTIONS_TARGET = `#${PAGE_HEADER_ACTIONS_ID}`;

/**
 * 页级动作挂载守卫
 *
 * 背景：页级动作按钮（AI 分析 / 导出 Excel / 新闻源设置等）从页面内工具条
 * 上移到 MainLayout 页头右侧，视图经 `<Teleport :to="PAGE_HEADER_ACTIONS_TARGET">`
 * 投射过去。被路由 KeepAlive 缓存的页面在离开时组件并不卸载，Teleport
 * 内容也不会自动撤离挂载点——不守卫的话，上一页的按钮会一直留在页头，
 * 与当前页的按钮叠在一起。
 *
 * 用法：页面视图（或其子组件，KeepAlive 的 activated / deactivated 会下发
 * 到整个子树）里取 `active`，套在 Teleport 的 `v-if` 上：
 *
 * ```vue
 * <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">…</Teleport>
 * ```
 *
 * @returns active 当前页面是否处于激活态（首次挂载即为 true，切走即 false）；
 *          仅对挂在路由 KeepAlive 下的组件有意义
 */
export const usePageHeaderSlot = (): { active: Ref<boolean> } => {
  const active = ref(false);
  onActivated(() => {
    active.value = true;
  });
  onDeactivated(() => {
    active.value = false;
  });
  onBeforeUnmount(() => {
    active.value = false;
  });
  return { active };
};
