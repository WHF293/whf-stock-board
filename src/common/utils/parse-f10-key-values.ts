import type { F10KeyValue } from '../types/stock-f10.types.ts';

/**
 * 解析 F10 键值对列表（基本资料 dl/dt/dd 与发行相关 li>span×2 两种结构的通用解析）
 *
 * 上游为服务端直出 HTML（无 XHR 接口），经 DOMParser 解析；
 * 无值或缺字段的行被过滤
 * @param html 页面 HTML 原文
 * @param rowSelector 行元素选择器（如 `.base-info dl` / `.about-publish li`）
 * @returns 键值对列表（保持页面原文顺序）
 */
export const parseF10KeyValues = (html: string, rowSelector: string): F10KeyValue[] => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows: F10KeyValue[] = [];
  for (const row of doc.querySelectorAll(rowSelector)) {
    // 结构一：dl > dt + dd（基本资料）
    const labelEl = row.querySelector('dt');
    const valueEl = row.querySelector('dd');
    if (labelEl && valueEl) {
      rows.push({
        label: labelEl.textContent?.trim() ?? '',
        value: valueEl.textContent?.trim() ?? '',
      });
      continue;
    }
    // 结构二：li > span × 2（发行相关）
    const spans = row.querySelectorAll('span');
    if (spans.length >= 2) {
      rows.push({
        label: spans.item(0).textContent?.trim() ?? '',
        value: spans.item(1).textContent?.trim() ?? '',
      });
    }
  }
  return rows.filter((row) => row.label !== '' || row.value !== '');
};
