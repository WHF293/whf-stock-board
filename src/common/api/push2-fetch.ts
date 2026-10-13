import { proxyFetch } from './proxy-fetch';

/**
 * 东财行情域请求统一收口：push2delay 主域失败回落 push2 原生域
 *
 * push2delay 是 2026-09-15 按王总 PC 网络（push2 被 TCP 断连）选的镜像；
 * 2026-10-12 真机实测（v4.6.1 同因）：手机网络下 push2delay 不可达而 push2 可达，
 * 表现为移动端一切落在 push2delay 的模块（板块日历采集 / 全球指数 / 美股 ETF）
 * 全部失败。故主域传输层 / HTTP 状态失败时回落 push2 同路径重试一次；
 * PC 网络下主域正常，回落永不触发。非 push2delay 地址原样透传。
 */

/** 回落目标域（push2 原生域） */
const PUSH2_FALLBACK_HOST = 'https://push2.eastmoney.com';

/**
 * 带域回落的东财请求
 * @param url 上游地址
 * @param init 请求初始化参数
 * @returns 上游响应（主域成功或回落成功）
 */
export const push2Fetch = async (url: string, init?: RequestInit): Promise<Response> => {
  if (!url.includes('push2delay.eastmoney.com')) {
    return proxyFetch(url, init);
  }
  const fallbackUrl = url.replace('https://push2delay.eastmoney.com', PUSH2_FALLBACK_HOST);
  return proxyFetch(url, init).then(
    (response) => (response.ok ? response : proxyFetch(fallbackUrl, init)),
    () => proxyFetch(fallbackUrl, init),
  );
};
