import { NUMBER_PLACEHOLDER } from '../constants/format.constants';

/**
 * 格式化封板时间（上游 HHMMSS 数字串 -> HH:MM:SS）
 * @param raw 封板时间原值（如 '092530'）
 * @returns 形如 `09:25:30` 的文案；无法解析时为 `--`
 */
export const formatBoardTime = (raw: string | null | undefined): string => {
  if (!raw || raw.length !== 6) {
    return NUMBER_PLACEHOLDER;
  }
  return `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}`;
};
