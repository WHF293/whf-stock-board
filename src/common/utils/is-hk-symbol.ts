/**
 * 判断符号是否为港股（`hk00700` 形态，腾讯符号前缀 + 1~5 位数字）
 *
 * 与 A 股（sh/sz/bj 前缀 + 6 位）不重叠：港股代码非 6 位定长，
 * `hk` 前缀后接 1~5 位数字（如 hk00700 / hk2715 / hk81810）
 * @param symbol 完整符号
 * @returns 是否港股符号
 */
export const isHkSymbol = (symbol: string): boolean => /^hk\d{1,5}$/i.test(symbol);
