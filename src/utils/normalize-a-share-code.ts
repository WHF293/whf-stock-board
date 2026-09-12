/**
 * A 股 6 位纯代码归一化为完整符号（sh/sz/bj 前缀）
 *
 * 规则：6 开头（含 688/689 科创）为沪市；0/3 开头为深市；
 * 4/8/9 开头（含 920 新段）为北交所
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
