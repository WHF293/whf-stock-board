/**
 * 合并宿主与插件菜单，按用户编排顺序输出侧栏渲染序列
 *
 * 顺序规则必须只有一份实现：界面渲染用它、「插件页随插件撤销」的兜底落点
 * 也用它（`resolveRouteFallback` 要退到「侧栏第一个菜单」）——两处各写一遍
 * 迟早会漂移成「界面上的第一个」和「兜底跳去的第一个」不是同一个页面。
 */

/** 侧栏菜单项的渲染形态（宿主菜单与插件菜单合并后的统一形状） */
export interface SidebarMenuEntry {
  /** 路由路径 */
  path: string;
  /** 菜单标题 */
  title: string;
  /** 图标 key（MenuIcon 渲染） */
  icon: string;
  /**
   * 是否声明为「插件页随插件撤销」的兜底落点（宿主自带页面用）
   *
   * 插件侧的同名声明在 `ctx.menu.add()` 参数里；这里给宿主的正式页面用同一套语义，
   * 于是「落点」永远只有一个来源：**看谁声明了它**，而不是在某个常量里硬编码路径。
   */
  fallbackLanding?: boolean;
}

/**
 * 按用户编排顺序合并菜单
 *
 * `menuOrder` 里没有的页面（版本升级新增、新装插件贡献的菜单）追加到末尾，
 * 保证入口不丢失；`hiddenMenus` 里被用户关掉的页面不参与渲染（路由仍可达）。
 * 同 path 时插件声明覆盖宿主声明（插件注册即生效，且插件路径本就不该与宿主撞车）。
 * @param hostItems 宿主内置菜单（声明顺序即默认顺序）
 * @param pluginItems 插件贡献的菜单项（内核注册表顺序）
 * @param menuOrder 用户编排的路径顺序
 * @param hiddenMenus 用户在编排时关掉的路径
 * @returns 侧栏渲染顺序的菜单项
 */
export const orderSidebarMenu = (
  hostItems: readonly SidebarMenuEntry[],
  pluginItems: readonly SidebarMenuEntry[],
  menuOrder: readonly string[],
  hiddenMenus: readonly string[],
): SidebarMenuEntry[] => {
  const hidden = new Set(hiddenMenus);
  // 先按路径归并：同 path 时后声明者覆盖（宿主在前、插件在后），Map 的键序即声明顺序
  const byPath = new Map<string, SidebarMenuEntry>();
  for (const item of [...hostItems, ...pluginItems]) {
    if (!hidden.has(item.path)) byPath.set(item.path, item);
  }
  // 再按用户编排取出；取走的从 Map 删掉，避免同 path 被追加第二次
  const ordered: SidebarMenuEntry[] = [];
  for (const path of menuOrder) {
    const item = byPath.get(path);
    if (!item) continue;
    ordered.push(item);
    byPath.delete(path);
  }
  // 用户编排里没有的页面（升级新增 / 新装插件贡献）按声明顺序追加到末尾，入口不丢
  ordered.push(...byPath.values());
  return ordered;
};
