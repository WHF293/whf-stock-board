import type { F10HoldRow } from '../types/stock-f10.types.ts';

/**
 * 解析 F10 参股控股页（BaseHold）为被参股企业行列表
 *
 * 页面结构：`.equity-hold ul > li`，首个 li 的 `p.top` 为表头行，
 * 数据行每个 li 三个 p（企业名称 / 注册资本 / 集团持股比例%）
 * @param html 页面 HTML 原文
 * @returns 参股控股行列表（保持页面原文顺序）
 */
export const parseF10HoldRows = (html: string): F10HoldRow[] => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows: F10HoldRow[] = [];
  for (const li of doc.querySelectorAll('.equity-hold ul li')) {
    const cells = li.querySelectorAll('p');
    if (cells.length < 3) continue;
    // 表头行（p 带 top 类）跳过
    if (cells.item(0).classList.contains('top')) continue;
    rows.push({
      companyName: cells.item(0).textContent?.trim() ?? '',
      registeredCapital: cells.item(1).textContent?.trim() ?? '',
      holdingRatio: cells.item(2).textContent?.trim() ?? '',
    });
  }
  return rows.filter((row) => row.companyName !== '');
};
