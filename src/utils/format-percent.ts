import { NUMBER_PLACEHOLDER, PRICE_DEFAULT_DIGITS } from '../constants/format.constants';

/**
 * 格式化百分数（带符号，正值补 +）
 * @param value 百分数原值（如 2.35 表示 +2.35%）
 * @returns 形如 `+2.35%` 的文案；无法格式化时为 `--`
 */
export const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NUMBER_PLACEHOLDER;
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(PRICE_DEFAULT_DIGITS)}%`;
};

/**
 * 格式化百分数（不带符号，用于换手率等非涨跌语义的百分比）
 * @param value 百分数原值
 * @returns 形如 `1.71%` 的文案；无法格式化时为 `--`
 */
export const formatPercentUnsigned = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return NUMBER_PLACEHOLDER;
  }
  return `${value.toFixed(PRICE_DEFAULT_DIGITS)}%`;
};
