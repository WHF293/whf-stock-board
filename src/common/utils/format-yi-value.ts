import { NUMBER_PLACEHOLDER, YUAN_PER_YI } from '../constants/format.constants.ts';

/**
 * 元 → 亿元纯数值文案（不带单位后缀，单位由表头 / 卡片说明承担）
 *
 * 与 formatYuan（带「亿」后缀）的差异：表格多列场景每格重复「亿」视觉噪音大，
 * 列头统一标注单位、格内只放数字
 * @param valueYuan 金额原值（单位：元）
 * @param digits 小数位（默认 2）
 * @returns 形如 `1234.56` 的文案；无法格式化时为 `--`
 */
export const formatYiValue = (
  valueYuan: number | null | undefined,
  digits = 2,
): string => {
  if (valueYuan === null || valueYuan === undefined || !Number.isFinite(valueYuan)) {
    return NUMBER_PLACEHOLDER;
  }
  return (valueYuan / YUAN_PER_YI).toFixed(digits);
};
