import { isTauri } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { STOCK_PROXY_PATH } from '../constants/proxy.constants';

/**
 * 上游数据请求适配层（SDK fetchImpl 注入点），按运行环境自动选通道：
 *
 * - Tauri PC 客户端：经 tauri-plugin-http 由 Rust 层直连上游（无 CORS 限制，
 *   域名白名单在 src-tauri/capabilities/default.json 配置），无需本地代理
 * - 浏览器（dev / Pages）：同源 /stock-proxy 转发，绕过 CORS
 *   （dev 由 vite 中间件承载；GitHub Pages 静态托管无后端，仅 JSONP 源可用）
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

  // Tauri：Rust 层直连（插件 scope 白名单校验域名），字节透传语义与标准 fetch 一致
  if (isTauri()) {
    return tauriFetch(target, init);
  }

  const proxiedUrl = `${STOCK_PROXY_PATH}?u=${encodeURIComponent(target)}`;

  // 透传 init（signal/headers/method），SDK 的超时与 hooks 语义保持不变
  return fetch(proxiedUrl, init);
};
