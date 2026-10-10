/**
 * 新闻正文页 HTML → 文章正文文本（DOM 容器级抽取）
 *
 * 相比整体剥标签，先按「文章类容器」选择器圈定候选节点、取文本最长者，
 * 可剔除站点导航 / 侧栏推荐等噪声，让截断后的前几百字符就是正文本体；
 * 无 DOM 可用（node 冒烟环境）时回退到整体剥标签的 htmlToText。
 */

import { htmlToText } from './html-to-text';

/**
 * 文章正文候选容器选择器
 *
 * 覆盖各新闻源实测的正文容器：新浪 artibody、东财 txtinfos / article-body、
 * 同花顺 article-body、澎湃 / 财联社 article 标签，外加大众 CMS 的
 * class / id 含 article / content / detail 的节点；取文本最长者为准
 */
const BODY_CANDIDATE_SELECTOR = [
  'article',
  '[class*="artibody"]',
  '[id*="artibody"]',
  '[class*="article"]',
  '[id*="article"]',
  '[class*="content"]',
  '[id*="content"]',
  '[class*="detail"]',
  '[id*="detail"]',
].join(',');

/** 抽取前整块移除的噪声元素（不参与候选文本统计） */
const NOISE_SELECTOR =
  'script,style,noscript,iframe,svg,nav,header,footer,aside,form,button';

/**
 * 从 DOM 文档中抽取正文文本
 * @param doc 已解析的文档
 * @returns 压缩空白后的正文文本（无有效内容返回空串）
 */
const extractFromDocument = (doc: Document): string => {
  doc.querySelectorAll(NOISE_SELECTOR).forEach((el) => el.remove());
  let best = '';
  doc.querySelectorAll(BODY_CANDIDATE_SELECTOR).forEach((el) => {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length > best.length) best = text;
  });
  if (best === '') {
    best = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }
  return best;
};

/**
 * 抽取新闻正文（纯函数，无网络请求）
 *
 * @param html 新闻正文页 HTML 源码
 * @returns 正文纯文本（可能残留少量推荐位文本；抓不出有效正文返回空串）
 */
export const extractNewsBody = (html: string): string => {
  if (typeof DOMParser === 'undefined') return htmlToText(html);
  try {
    return extractFromDocument(new DOMParser().parseFromString(html, 'text/html'));
  } catch {
    return htmlToText(html);
  }
};
