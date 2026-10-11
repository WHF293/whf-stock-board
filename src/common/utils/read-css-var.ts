/**
 * 读取当前文档根元素上的 CSS 变量值（如主题色），供 ECharts 等非 CSS 上下文消费
 * @param name CSS 变量名（含 -- 前缀）
 * @returns 变量值；变量不存在时返回空字符串
 */
export const readCssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
