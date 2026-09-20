/**
 * 在当前页面的路由匹配链里找出「刚被撤销」的那条插件路由
 *
 * 用于判断「用户是不是正停在一个刚刚消失的插件页上」——插件的路由被摘掉后，
 * vue-router 不会自动把用户挪走（`currentRoute` 仍指向那条已经不存在的记录），
 * 所以必须由宿主主动识别并接走，否则用户会停在一个「下次导航就 404」的页面上。
 */

/**
 * 找出覆盖当前页面的那条已撤销路由
 *
 * 先认等值：插件注册的页面（菜单页 / 隐藏页 / 带参详情页）都会在匹配链里
 * 原样占一条记录，等值命中即最精确；再认子路径：插件撤掉 `/x` 时，
 * 停在 `/x/1` 的用户同样该被接走。
 * @param matchedPaths 当前路由的匹配记录路径（根 → 叶，取 `route.matched.map(r => r.path)`）
 * @param removedPaths 本次被撤销的插件路由路径
 * @returns 命中的**被撤销**路由路径（可直接用于定位归属插件）；未命中返回空串
 */
export const findVanishedRoute = (
  matchedPaths: readonly string[],
  removedPaths: readonly string[],
): string => {
  const exact = removedPaths.find((removed) => matchedPaths.includes(removed));
  if (exact) return exact;
  return (
    removedPaths.find((removed) =>
      matchedPaths.some((path) => path.startsWith(`${removed}/`)),
    ) ?? ''
  );
};
