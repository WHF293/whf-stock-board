import type { SdkErrorCode } from 'stock-sdk/errors';

/**
 * stock-sdk 稳定错误码常量（代替 enum；取值必须为 SdkErrorCode 联合成员）
 *
 * 仅收录需要向用户展示特定文案的错误码，
 * 其余错误码（RATE_LIMITED / UPSTREAM_EMPTY 等）统一走兜底文案
 */
export const SDK_ERROR_CODE = {
  /** 请求超时 */
  TIMEOUT: 'TIMEOUT',
  /** 网络异常（代理不可达等） */
  NETWORK_ERROR: 'NETWORK_ERROR',
  /** 上游返回非 2xx */
  HTTP_ERROR: 'HTTP_ERROR',
} as const satisfies Record<string, SdkErrorCode>;

/** 未知错误的兜底文案 */
export const SDK_FALLBACK_MESSAGE = '行情数据获取失败，请稍后重试';
