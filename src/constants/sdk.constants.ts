/**
 * stock-sdk 构造选项（对应 v2.4.3 的 RequestClientOptions）
 *
 * 通过展开合入 `new StockSDK({ fetchImpl, ...SDK_REQUEST_OPTIONS })`
 */
export const SDK_REQUEST_OPTIONS = {
  /** 单请求超时（毫秒） */
  timeout: 10_000,
  /**
   * 重试策略：上游为公共接口，对限频敏感，
   * 仅重试 1 次以避免失败时放大流量
   */
  retry: {
    maxRetries: 1,
  },
} as const;
