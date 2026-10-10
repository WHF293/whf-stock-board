/**
 * 字节数格式化为人类可读文本（B / KB / MB / GB，1024 进制，保留 1 位小数）
 * @param bytes 字节数
 * @returns 格式化文本（如 '1.5 MB' / '820 B'）
 */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
};
