/**
 * 剥掉 JSONP 外壳（`cb({...})` / `cb([...])` → 内层 JSON 文本）
 * @param text 原始响应文本
 * @returns 内层 JSON 文本
 */
export const stripJsonp = (text: string): string =>
  text.replace(/^[\w$]+\(/, '').replace(/\)\s*;?\s*$/, '');
