/**
 * 解析「插件页随插件撤销」后的落点
 *
 * 三级递退，每一级都取自**当前仍注册**的贡献点，因此不存在
 * 「跳到一个同样已经不存在的页面」的情况：
 * ① 声明为兜底落点的页面（如插件工坊）；② 侧栏第一个菜单；③ 宿主首页。
 */

/** 兜底落点的候选来源（优先级由高到低） */
export interface RouteFallbackCandidates {
  /** 声明为兜底落点的页面路径（只含仍注册的页面，按 `order` 升序） */
  landingPaths: readonly string[];
  /** 侧栏当前渲染顺序的路径（`orderSidebarMenu` 的结果） */
  sidebarPaths: readonly string[];
  /** 终极兜底路径（宿主首页，恒可用） */
  defaultPath: string;
}

/**
 * 挑一个仍然可用的页面作为落点
 * @param candidates 候选来源
 * @returns 要跳转到的路径（恒非空）
 */
export const resolveRouteFallback = (candidates: RouteFallbackCandidates): string => {
  const landing = candidates.landingPaths.find((path) => path.length > 0);
  if (landing) return landing;
  const firstSidebar = candidates.sidebarPaths.find((path) => path.length > 0);
  return firstSidebar ?? candidates.defaultPath;
};
