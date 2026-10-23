import type { PaletteItem } from '../types/command-palette.types';

/**
 * 命令面板前端过滤：按关键词给候选打分并排序
 *
 * 打分口径（越高越靠前）：
 * - 前缀命中（不区分大小写）= 2 分；包含命中 = 1 分；未命中 = 淘汰；
 * - label 命中权重高于 detail（搜「茅」应命中「贵州茅台」而不是代码注释）：
 *   label 得分乘 2；
 * - 同分按原始声明顺序稳定排序（sort 的浏览器实现是稳定的，ES2019+）。
 *
 * 个股组来自远程搜索（上游已按相关度排序），不走本函数，score 恒为 0。
 * @param keyword 用户输入（原样，函数内部做 trim / 大小写归一）
 * @param candidates 参与过滤的候选（页面 / 命令两组的并集即可）
 * @param limit 每组返回上限（调用方按组传，见 PALETTE_FILTERED_GROUP_MAX）
 * @returns 得分降序、同分保序的前 limit 条
 */
export const matchPaletteItems = (
  keyword: string,
  candidates: PaletteItem[],
  limit: number,
): PaletteItem[] => {
  const query = keyword.trim().toLowerCase();
  if (query.length === 0) return [];
  const scored: { item: PaletteItem; score: number }[] = [];
  for (const item of candidates) {
    const label = item.label.toLowerCase();
    const detail = item.detail.toLowerCase();
    let score = 0;
    if (label.startsWith(query)) {
      score = 4;
    } else if (label.includes(query)) {
      score = 2;
    } else if (detail.startsWith(query)) {
      score = 1;
    } else if (detail.includes(query)) {
      score = 0.5;
    }
    if (score > 0) scored.push({ item, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({ ...entry.item, score: entry.score }));
};
