import { isTauri } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { STOCK_PROXY_PATH } from '../constants/proxy.constants';
import { trackApiRequest } from '../weblog/weblogActions';

/**
 * 给上游请求挂上行为埋点（成功与失败都记，失败另行落一条报错日志）
 *
 * 不消费 / 不改写响应体：保持「原始字节透传」语义（见上方说明）。
 * @param request 已发起的请求
 * @param target 上游原始地址
 * @param method 请求方法（大写）
 * @param startedAt 发起时刻（performance.now / Date.now 均可）
 * @returns 原样透传的响应 Promise
 */
const withApiTracking = (
  request: Promise<Response>,
  target: string,
  method: string,
  startedAt: number,
): Promise<Response> =>
  request.then(
    (response) => {
      trackApiRequest({
        url: target,
        method,
        durationMs: Date.now() - startedAt,
        status: response.status,
        ok: response.ok,
      });
      return response;
    },
    (error: unknown) => {
      trackApiRequest({
        url: target,
        method,
        durationMs: Date.now() - startedAt,
        status: null,
        ok: false,
        error,
      });
      throw error;
    },
  );

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
 * 全部上游请求在这里统一埋点（行为日志 category=api），失败再落一条报错日志 ——
 * 这里是「接口请求」的单一收口处，新增数据源无需各写一遍埋点
 *
 * @param url 上游请求地址（由 SDK 生成）
 * @param init 请求初始化参数（含 SDK 的 AbortSignal）
 * @returns 上游响应
 */
export const proxyFetch: typeof fetch = (url, init) => {
  // 统一转成字符串再编码，兼容 string / URL / Request 三种入参形态
  const target =
    typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  const method = (init?.method ?? 'GET').toUpperCase();
  const startedAt = Date.now();

  // Tauri：Rust 层直连（插件 scope 白名单校验域名），字节透传语义与标准 fetch 一致
  if (isTauri()) {
    return withApiTracking(tauriFetch(target, init), target, method, startedAt);
  }

  // Referer 是浏览器 forbidden header，无法经 fetch 头透传；
  // 改用查询参数 ?r= 携带给代理中间件（中间件转发上游时优先使用）
  const referer =
    init?.headers instanceof Headers
      ? init.headers.get('Referer')
      : Array.isArray(init?.headers)
        ? init.headers.find(([key]) => key.toLowerCase() === 'referer')?.[1] ?? null
        : (init?.headers as Record<string, string> | undefined)?.Referer ?? null;

  let proxiedUrl = `${STOCK_PROXY_PATH}?u=${encodeURIComponent(target)}`;
  if (referer) {
    proxiedUrl += `&r=${encodeURIComponent(referer)}`;
  }

  // 透传 init（signal/headers/method），SDK 的超时与 hooks 语义保持不变
  return withApiTracking(fetch(proxiedUrl, init), target, method, startedAt);
};
