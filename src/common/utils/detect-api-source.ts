import {
  API_SOURCE_FALLBACK_LABEL,
  API_SOURCE_RULES,
} from '../constants/api-source.constants.ts';

/**
 * 识别请求 URL 所属数据源（调试网络面板的条目标注）
 *
 * 从 URL 取 hostname，按 API_SOURCE_RULES 的域名后缀表先后匹配；
 * URL 解析失败时对原串做同样的后缀匹配（等价于按整串匹配，仍可命中）。
 * @param url 请求地址（上游真实 URL）
 * @returns 数据源展示名（腾讯 / 东财 / 同花顺…），未命中返回兜底名
 */
export const detectApiSource = (url: string): string => {
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    // 非标准 URL（如纯域名串）：沿用原串做后缀匹配
  }
  for (const rule of API_SOURCE_RULES) {
    if (host === rule.pattern || host.endsWith(`.${rule.pattern}`)) return rule.label;
  }
  return API_SOURCE_FALLBACK_LABEL;
};
