import { StockSDK } from 'stock-sdk';
import { SDK_REQUEST_OPTIONS } from '../constants/sdk.constants';
import { proxyFetch } from './proxy-fetch';

/**
 * stock-sdk 全局单例
 *
 * 实例级缓存（代码表 / 交易日历 / 板块映射）按实例隔离，
 * 必须模块顶层创建一份并全站复用；需要强刷时调用 sdk.clearCaches()
 */
export const sdk = new StockSDK({
  fetchImpl: proxyFetch,
  ...SDK_REQUEST_OPTIONS,
});
