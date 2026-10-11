/**
 * 访问端平台识别（仅用于下载推荐排序，不做功能降级）
 */

/** 访问端平台：识别不了归 other（不打扰默认排序） */
export type VisitorPlatform = 'windows' | 'android' | 'other';

/** Windows UA 标识 */
const WINDOWS_UA_PATTERN = /windows nt/i;

/** Android UA 标识 */
const ANDROID_UA_PATTERN = /android/i;

/**
 * 按 UA 识别访问端平台
 * @param userAgent UA 串（默认取 navigator.userAgent）
 * @returns windows / android / other
 */
export function detectVisitorPlatform(userAgent: string = navigator.userAgent): VisitorPlatform {
  if (ANDROID_UA_PATTERN.test(userAgent)) return 'android';
  if (WINDOWS_UA_PATTERN.test(userAgent)) return 'windows';
  return 'other';
}
