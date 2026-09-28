/**
 * 语义化版本比较（全项目唯一收口）
 *
 * 以前 `SettingsView` 里有一份 `parseVersion`，插件更新再写一份就会在「1.2 与 1.10 谁大」
 * 这种地方写岔 —— 版本比较看着简单，字符串比较会得出 `1.10 < 1.2` 的错误结论。
 * 所以这里是唯一实现，禁止各处自己 `split('.')`。
 */

/** 参与比较的版本段数（major.minor.patch；多出来的段忽略） */
const VERSION_SEGMENTS = 3;

/** 缺位时补的零（长度与 VERSION_SEGMENTS 一致） */
const ZERO_PADDING: readonly number[] = [0, 0, 0];

/**
 * 解析版本号为可比较的数字数组（'v0.1.5' -> [0, 1, 5]，缺位补 0）
 *
 * 行为与 `SettingsView` 里原本那一份**逐字一致**（含 `Number.parseInt(...) || 0`
 * 把非数字段当 0），抽过来只为收口，不修行为。
 * @param tag 版本 tag 或纯版本号
 * @returns 数字数组（长度 3）
 */
export const parseVersion = (tag: string): number[] =>
  tag
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
    .concat([...ZERO_PADDING])
    .slice(0, VERSION_SEGMENTS);

/**
 * 三段语义化版本比较（**数字比较**，不是字符串比较）
 *
 * `compareVersion('1.2.0', '1.10.0')` 返回 `-1`（第二段 2 < 10）。
 * @param left 左侧版本号（可带 `v` 前缀）
 * @param right 右侧版本号（可带 `v` 前缀）
 * @returns left > right 返回 1，相等返回 0，否则 -1
 */
export const compareVersion = (left: string, right: string): number => {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < VERSION_SEGMENTS; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
};

/**
 * 远端版本是否严格比本地新（本地更高视为不更新）
 *
 * 「本地更高」发生在开发者装了未发布的版本：此时不该提示降级。
 * @param latest 远端版本
 * @param current 本地已安装版本
 * @returns 是否应提示更新
 */
export const isNewerVersion = (latest: string, current: string): boolean =>
  compareVersion(latest, current) > 0;
