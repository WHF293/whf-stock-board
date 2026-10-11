/**
 * A 股 6 位纯代码归一化为完整符号（sh/sz/bj 前缀）
 *
 * 规则：6 开头（含 688/689 科创）为沪市；0/3 开头为深市；
 * 4/8/9 开头（含 920 新段）为北交所
 */

/** 指数符号前缀规则（沪市 000 段 + 深市 399 段），编译期正则 */
const INDEX_SYMBOL_PATTERN = /^(sh000|sz399)\d{3}$/;

/**
 * 是否为指数符号（指数分时/五日无「均价」概念，图表不绘制均价线）
 *
 * 规则：沪市 000 段（sh000001 上证指数 / sh000300 沪深300 / sh000688 科创50 等）
 * 与深市 399 段（sz399001 深证成指 / sz399006 创业板指 等）均为指数；
 * 个股为 sh6 / sz0 / sz3 / bj4|8|9 段，不会命中
 * @param symbol 完整符号（sh600519 形态）
 * @returns true 表示指数
 */
export const isIndexSymbol = (symbol: string): boolean =>
  INDEX_SYMBOL_PATTERN.test(symbol);

/**
 * 6 位纯代码归一化为完整符号
 * @param code 6 位纯代码（如 600519）
 * @returns 完整符号（如 sh600519）；无法识别时原样返回
 */
export const normalizeAShareCode = (code: string): string => {
  if (!/^\d{6}$/.test(code)) {
    return code;
  }
  if (code.startsWith('6')) {
    return `sh${code}`;
  }
  if (code.startsWith('0') || code.startsWith('3')) {
    return `sz${code}`;
  }
  return `bj${code}`;
};
