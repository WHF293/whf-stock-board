import { NUMBER_PLACEHOLDER } from '../constants/format.constants';

/**
 * 格式化成交量（入参单位为手，按量级自动切万手 / 手展示）
 * @param valueShou 成交量原值（单位：手）
 * @returns 形如 `1.23万手` / `9800手` 的文案；无法格式化时为 `--`
 */
export const formatVolume = (valueShou: number | null | undefined): string => {
  if (valueShou === null || valueShou === undefined || Number.isNaN(valueShou)) {
    return NUMBER_PLACEHOLDER;
  }
  if (Math.abs(valueShou) >= 10_000) {
    return `${(valueShou / 10_000).toFixed(2)}万手`;
  }
  return `${valueShou.toFixed(0)}手`;
};
