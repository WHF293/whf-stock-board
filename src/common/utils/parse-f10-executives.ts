import type { F10Executive } from '../types/stock-f10.types.ts';

/**
 * 解析 F10 高管简介页（BaseExecutive）为高管条目列表
 *
 * 页面结构：`.executive-introduce` 下每位高管一个 `div.content`，
 * 内含 `ul > li > span×2`（字段名带全角冒号）+ `h3 简介：` + `p` 履历正文
 * @param html 页面 HTML 原文
 * @returns 高管条目列表（保持页面原文顺序）
 */
export const parseF10Executives = (html: string): F10Executive[] => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = doc.querySelectorAll('.executive-introduce div.content');
  const executives: F10Executive[] = [];
  for (const block of blocks) {
    const kv = new Map<string, string>();
    for (const li of block.querySelectorAll('ul li')) {
      const spans = li.querySelectorAll('span');
      if (spans.length < 2) continue;
      const key = (spans.item(0).textContent ?? '').replace(/：\s*$/, '').trim();
      const value = (spans.item(1).textContent ?? '').trim();
      if (key !== '') kv.set(key, value);
    }
    executives.push({
      name: kv.get('姓名') ?? '',
      appointDate: kv.get('任职时间') ?? '',
      gender: kv.get('性别') ?? '',
      education: kv.get('学历') ?? '',
      age: kv.get('年龄') ?? '',
      position: kv.get('职务') ?? '',
      intro: block.querySelector('p')?.textContent?.trim() ?? '',
    });
  }
  return executives.filter((item) => item.name !== '' || item.intro !== '');
};
