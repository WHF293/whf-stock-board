import { StockSDK } from 'stock-sdk';
import { SDK_REQUEST_OPTIONS } from '../constants/sdk.constants.ts';
import { proxyFetch } from './proxy-fetch';
import { rerouteEastmoneyHost } from './eastmoney-reroute';

/**
 * SDK fetchImpl 包装：先对东财行情域做「按路径」改道，再走统一代理通道
 *
 * stock-sdk 的东财地址是硬编码常量（`7/91.push2`、`33.push2his` 等），
 * 而本机出口对这些域的连通性各不相同（`push2` 仍不通、`push2his` 已恢复），
 * 只能在此收口处按路径改写。详见 `eastmoney-reroute.ts` 的背景说明。
 *
 * 改道域失败回落（2026-10-12）：push2delay 是按本机（王总 PC）网络选的镜像，
 * 其他网络（如真机蜂窝/Wi-Fi）下 push2delay 可能不可达而 push2 系原生域可达
 * ——表现为真机上「板块资金」等一切落在 push2delay 的模块全败而 push2his
 * 直连模块正常。故改道请求传输层 / HTTP 状态失败时，回落改道前的原域名重试一次；
 * 原域名同样失败则抛出真实错误。PC 网络下 push2delay 正常可用，回落永不触发。
 * @param url 上游请求地址（由 SDK 生成）
 * @param init 请求初始化参数
 * @returns 上游响应
 */
const reroutingProxyFetch: typeof fetch = (url, init) => {
  const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  const rerouted = rerouteEastmoneyHost(target);
  if (rerouted === target) return proxyFetch(target, init);
  return proxyFetch(rerouted, init).then(
    (response) => (response.ok ? response : proxyFetch(target, init)),
    () => proxyFetch(target, init),
  );
};

/**
 * stock-sdk 全局单例
 *
 * 实例级缓存（代码表 / 交易日历 / 板块映射）按实例隔离，
 * 必须模块顶层创建一份并全站复用；需要强刷时调用 sdk.clearCaches()
 */
export const sdk = new StockSDK({
  fetchImpl: reroutingProxyFetch,
  ...SDK_REQUEST_OPTIONS,
});
