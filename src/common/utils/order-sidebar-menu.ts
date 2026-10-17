/**
 * 合并宿主与插件菜单，按用户编排顺序输出侧栏渲染序列
 *
 * 顺序规则必须只有一份实现：界面渲染用它、「插件页随插件撤销」的兜底落点
 * 也用它（`resolveRouteFallback` 要退到「侧栏第一个菜单」）——两处各写一遍
 * 迟早会漂移成「界面上的第一个」和「兜底跳去的第一个」不是同一个页面。
 */
import { SIDEBAR_MENU_GROUP_DEFAULT, SIDEBAR_MENU_GROUP_TITLES } from '../constants/sidebar-group.constants.ts';

/** 侧栏菜单项的渲染形态（宿主菜单与插件菜单合并后的统一形状） */
export interface SidebarMenuEntry {
  /** 路由路径 */
  path: string;
  /** 菜单标题 */
  title: string;
  /** 图标 key（MenuIcon 渲染） */
  icon: string;
  /**
   * 所属分组 id（缺省归「插件」组，见 `SIDEBAR_MENU_GROUP_DEFAULT`）
   *
   * 分组归属由声明决定、与排序正交：用户只能调组顺序与组内顺序，
   * 不能把页面拖进别的组（那等于改宿主的信息架构）。
   */
  group?: string;
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

/** 侧栏菜单分组的渲染形态（组内条目已按扁平 menuOrder 排好） */
export interface SidebarMenuGroupOf<T extends SidebarMenuEntry> {
  /** 分组 id（`SIDEBAR_MENU_GROUP` 之一，或插件声明的自定义 id） */
  id: string;
  /** 组头展示标题（内置组取 `SIDEBAR_MENU_GROUP_TITLES`，自定义组以 id 兜底） */
  title: string;
  /** 组内菜单项（已按扁平顺序排好；隐藏页在传入前就已被过滤） */
  items: T[];
}

/** 侧栏菜单分组（条目即 `SidebarMenuEntry` 的默认形态） */
export type SidebarMenuGroup = SidebarMenuGroupOf<SidebarMenuEntry>;

/**
 * 把扁平菜单按声明分组归桶，并按用户编排的组顺序输出
 *
 * 归组只看条目自己的 `group` 声明（缺省归「插件」组），与条目在扁平顺序里的
 * 位置无关——所以组内相对顺序天然继承扁平 menuOrder，旧用户的编排数据无需迁移。
 * `groupOrder` 里没有的分组 id（插件声明的新组）按首次出现顺序追加到末尾。
 * 泛型条目（如编排弹窗的草稿项）原样保留扩展字段，不收缩回 `SidebarMenuEntry`。
 * @param items 扁平菜单项（应是 `orderSidebarMenu` 的输出，已排序已过滤隐藏页）
 * @param groupOrder 用户编排的分组 id 顺序（settings.menuGroupOrder）
 * @returns 按组顺序排列的分组列表（空组不产出）
 */
export const groupSidebarMenu = <T extends SidebarMenuEntry>(
  items: readonly T[],
  groupOrder: readonly string[],
): SidebarMenuGroupOf<T>[] => {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const id = item.group ?? SIDEBAR_MENU_GROUP_DEFAULT;
    const bucket = buckets.get(id);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(id, [item]);
    }
  }
  const ordered: SidebarMenuGroupOf<T>[] = [];
  const taken = new Set<string>();
  for (const id of groupOrder) {
    const bucket = buckets.get(id);
    if (!bucket) continue;
    ordered.push({ id, title: SIDEBAR_MENU_GROUP_TITLES[id] ?? id, items: bucket });
    taken.add(id);
  }
  for (const [id, bucket] of buckets) {
    if (!taken.has(id)) {
      ordered.push({ id, title: SIDEBAR_MENU_GROUP_TITLES[id] ?? id, items: bucket });
    }
  }
  return ordered;
};

/**
 * 把分组列表拍平回扁平菜单（组顺序 + 组内顺序 = 视觉顺序）
 *
 * 给「插件页撤销兜底」这类只认扁平 path 序列的消费方用：侧栏视觉顺序
 * 已经是两级了，兜底落点「侧栏第一个菜单」必须跟界面同源，所以先分组
 * 再拍平，而不是直接用未分组的扁平序。
 * @param groups 分组列表（`groupSidebarMenu` 的输出）
 * @returns 拍平后的菜单项（组间按组顺序、组内按传入顺序）
 */
export const flattenSidebarMenuGroups = <T extends SidebarMenuEntry>(
  groups: readonly SidebarMenuGroupOf<T>[],
): T[] => groups.flatMap((group) => group.items);
