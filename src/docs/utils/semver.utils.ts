/**
 * 语义化版本号解析与比较（仅覆盖仓库 tag 的 v?x.y.z 口径）
 */
import type { SiteVersion } from '../types/release.types';

/** 版本 tag 形态：可选 v 前缀 + 三段数字 */
const VERSION_TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

/**
 * 解析版本 tag 为三段数字
 * @param tag 版本 tag（如 v4.1.1 / 4.1.1）
 * @returns 三段数字；不合口径返回 null（调用方按「不可下载」过滤）
 */
export function parseVersionTag(tag: string): SiteVersion | null {
  const matched = VERSION_TAG_PATTERN.exec(tag.trim());
  if (!matched) return null;
  return {
    major: Number(matched[1] ?? '0'),
    minor: Number(matched[2] ?? '0'),
    patch: Number(matched[3] ?? '0'),
  };
}

/**
 * 比较两个版本号
 * @param a 版本 a
 * @param b 版本 b
 * @returns a > b 返回正数，相等返回 0，a < b 返回负数
 */
export function compareVersion(a: SiteVersion, b: SiteVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
