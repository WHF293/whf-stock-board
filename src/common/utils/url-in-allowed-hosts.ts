import { STOCK_PROXY_ALLOWED_HOSTS } from '../constants/proxy.constants.ts';

/**
 * 判断目标地址是否在数据源代理白名单内（与代理中间件同一套后缀匹配规则）
 *
 * PC 与移动端的插件装配层共用：作为 `app:http` 的 `isAllowed` 自检手段，
 * 与其请求被拒后才发现，不如发起前就知道行不行。
 * 相对路径 / 非法 URL 一律不允许（插件不应该访问应用自身接口之外的相对地址）。
 * @param url 目标地址
 * @returns 是否允许访问
 */
export const isUrlInAllowedHosts = (url: string): boolean => {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return STOCK_PROXY_ALLOWED_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
};
