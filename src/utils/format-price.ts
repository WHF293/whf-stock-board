import { NUMBER_PLACEHOLDER, PRICE_DEFAULT_DIGITS } from '../constants/format.constants';

/**
 * 格式化价格（保留两位小数，空值展示占位符）
 * @param value 价格原值
 * @returns 形如 `1234.56` 的文案；无法格式化时为 `--`
 */
export const formatPrice = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NUMBER_PLACEHOLDER;
  }
  return value.toFixed(PRICE_DEFAULT_DIGITS);
};
