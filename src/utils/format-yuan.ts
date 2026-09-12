import { AMOUNT_UNITS, NUMBER_PLACEHOLDER, YUAN_PER_YI } from '../constants/format.constants';

/**
 * 格式化资金净额（入参单位为元，换算为亿展示，正值补 +）
 * @param valueYuan 资金额原值（单位：元）
 * @returns 形如 `+12.34亿` 的文案；无法格式化时为 `--`
 */
export const formatYuanWithSign = (valueYuan: number | null | undefined): string => {
  if (valueYuan === null || valueYuan === undefined || Number.isNaN(valueYuan)) {
    return NUMBER_PLACEHOLDER;
  }
  const sign = valueYuan > 0 ? '+' : '';
  return `${sign}${(valueYuan / YUAN_PER_YI).toFixed(2)}${AMOUNT_UNITS.YI}`;
};

/**
 * 格式化金额（入参单位为元，换算为亿展示，不带符号）
 * @param valueYuan 金额原值（单位：元）
 * @returns 形如 `1234.56亿` 的文案；无法格式化时为 `--`
 */
export const formatYuan = (valueYuan: number | null | undefined): string => {
  if (valueYuan === null || valueYuan === undefined || Number.isNaN(valueYuan)) {
    return NUMBER_PLACEHOLDER;
  }
  return `${(valueYuan / YUAN_PER_YI).toFixed(2)}${AMOUNT_UNITS.YI}`;
};
