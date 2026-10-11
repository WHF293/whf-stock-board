/**
 * 官网展示格式化工具：文件大小 / 下载次数 / 日期
 */

const KB = 1024;
const MB = KB * 1024;
const COUNT_WAN = 10000;

/**
 * 字节数格式化为人类可读大小
 * @param sizeBytes 字节数
 * @returns 形如 `12.4 MB`；非法输入返回 `--`
 */
export function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return '--';
  if (sizeBytes < KB) return `${sizeBytes} B`;
  if (sizeBytes < MB) return `${(sizeBytes / KB).toFixed(1)} KB`;
  return `${(sizeBytes / MB).toFixed(1)} MB`;
}

/**
 * 下载次数格式化：万以内千分位，万以上保留 1 位小数
 * @param count 次数
 * @returns 形如 `1,234` / `1.2 万`；非法输入返回 `--`
 */
export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '--';
  if (count < COUNT_WAN) return count.toLocaleString('zh-CN');
  return `${(count / COUNT_WAN).toFixed(1)} 万`;
}

/**
 * ISO 时间串转 `YYYY-MM-DD`（GitHub published_at 为 ISO 串，前 10 位即日期）
 * @param iso ISO 时间串
 * @returns `YYYY-MM-DD`；空串原样返回
 */
export function formatDateIso(iso: string): string {
  return iso.slice(0, 10);
}
