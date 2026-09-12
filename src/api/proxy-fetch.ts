import { STOCK_PROXY_PATH } from '../constants/proxy.constants';

/**
 * 代理改道 fetch：将 fetch 型上游请求改道到同源 /stock-proxy，绕过浏览器 CORS
 *
 * 仅作为 stock-sdk 的 fetchImpl 注入；script 注入式源（JSONP）由 SDK 自行直连，
 * 不经过本函数，因此无需在运行时区分源类型
 *
 * @param url 上游请求地址（由 SDK 生成）
 * @param init 请求初始化参数（含 SDK 的 AbortSignal）
 * @returns 上游响应
 */
export const proxyFetch: typeof fetch = (url, init) => {
  // 统一转成字符串再编码，兼容 string / URL / Request 三种入参形态
  const target =
    typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;

  const proxiedUrl = `${STOCK_PROXY_PATH}?u=${encodeURIComponent(target)}`;

  // 透传 init（signal/headers/method），SDK 的超时与 hooks 语义保持不变
  return fetch(proxiedUrl, init);
};
