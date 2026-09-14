/**
 * 相对时间格式化（会话列表右侧灰色时间，如「3分钟前」「1小时前」「昨天」）
 * @param timestamp 毫秒时间戳
 * @returns 相对时间文案（超过 30 天显示 M-D 日期）
 */
export function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minuteMs = 60_000;
  const hourMs = 3_600_000;
  const dayMs = 86_400_000;

  if (diffMs < minuteMs) return '刚刚';
  if (diffMs < hourMs) return `${Math.floor(diffMs / minuteMs)}分钟前`;
  if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}小时前`;

  const days = Math.floor(diffMs / dayMs);
  if (days === 1) return '昨天';
  if (days === 2) return '前天';
  if (days <= 30) return `${days}天前`;

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}-${date.getDate()}`;
}
