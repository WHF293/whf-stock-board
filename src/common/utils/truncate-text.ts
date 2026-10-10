/**
 * 文本截断（日志 / 提示类场景的兜底：超长内容只留前缀 + 省略号）
 * @param text 原始文本（null / undefined 返回空串）
 * @param maxLength 允许的最大长度（含省略号）
 * @returns 截断后的文本
 */
export const truncateText = (text: string | null | undefined, maxLength: number): string => {
  if (!text) return '';
  if (maxLength <= 0) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
};
