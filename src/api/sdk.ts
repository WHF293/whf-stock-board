import { StockSDK } from 'stock-sdk';
import { SDK_REQUEST_OPTIONS } from '../constants/sdk.constants';
import { proxyFetch } from './proxy-fetch';
import { rerouteEastmoneyHost } from './eastmoney-reroute';

/**
 * SDK fetchImpl 包装：先对东财行情域做「按路径」改道，再走统一代理通道
 *
 * stock-sdk 的东财地址是硬编码常量（`7/91.push2`、`33.push2his` 等），
 * 而本机出口对这些域的连通性各不相同（`push2` 仍不通、`push2his` 已恢复），
 * 只能在此收口处按路径改写。详见 `eastmoney-reroute.ts` 的背景说明。
 * @param url 上游请求地址（由 SDK 生成）
 * @param init 请求初始化参数
 * @returns 上游响应
 */
const reroutingProxyFetch: typeof fetch = (url, init) => {
  const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  return proxyFetch(rerouteEastmoneyHost(target), init);
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
