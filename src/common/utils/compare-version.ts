/**
 * 语义化版本号比较（仅 x.y.z 三段数字，与 GitHub tag / 应用版本口径一致）
 */

/**
 * 解析版本号为可比较的数字数组（'v0.1.5' -> [0, 1, 5]，缺位补 0、非法段记 0）
 * @param tag 版本 tag 或纯版本号（如 v3.0.2 / 3.0.2）
 * @returns 数字数组（长度 3）
 */
const parseVersion = (tag: string): number[] =>
  tag
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0)
    .concat([0, 0, 0])
    .slice(0, 3);

/**
 * 比较两个版本号大小
 * @param current 当前版本（如 3.0.2）
 * @param latest 远端版本（如 v3.0.3）
 * @returns 远端更新返回 1；相同返回 0；当前更高（本地未发布版）返回 -1
 */
export const compareVersion = (current: string, latest: string): number => {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  for (let i = 0; i < a.length; i += 1) {
    if (b[i] > a[i]) return 1;
    if (b[i] < a[i]) return -1;
  }
  return 0;
};
