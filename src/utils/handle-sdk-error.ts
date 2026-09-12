import { SdkError } from 'stock-sdk/errors';
import { SDK_ERROR_CODE, SDK_FALLBACK_MESSAGE } from '../constants/sdk-error.constants';

/** SdkError 稳定 code 到用户可读文案的映射表 */
const ERROR_MESSAGE_MAP: Record<string, string> = {
  [SDK_ERROR_CODE.TIMEOUT]: '请求超时，行情源响应缓慢',
  [SDK_ERROR_CODE.NETWORK_ERROR]: '网络异常，请检查代理服务是否可用',
  [SDK_ERROR_CODE.HTTP_ERROR]: '行情源返回错误，可能触发限频',
};

/**
 * 将任意抛出值转换为用户可读文案（错误只降级展示，不阻断轮询）
 * @param error 捕获到的抛出值
 * @returns 展示给用户的中文文案
 */
export const handleSdkError = (error: unknown): string => {
  if (error instanceof SdkError) {
    return ERROR_MESSAGE_MAP[error.code] ?? SDK_FALLBACK_MESSAGE;
  }
  return SDK_FALLBACK_MESSAGE;
};
