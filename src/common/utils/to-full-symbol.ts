import { normalizeSymbol, toTencentSymbol } from 'stock-sdk';

/**
 * 任意形态代码归一化为完整符号（sh600519 形态）
 *
 * ⚠️ `normalizeSymbol` 返回的是 **NormalizedSymbol 对象**（`{ market, exchange,
 * assetType, code, input }`，品牌类型），不是字符串——把它交给 `String()` 会得到
 * `"[object Object]"`，直接入库 / 请求上游会静默失效（自选股曾因此整列 `--`）。
 * 取回字符串必须再经 `toTencentSymbol`。
 * @param input 用户输入或上游返回的代码（sh600519 / 600519 / SH600519 等）
 * @returns 完整符号；无法解析时返回去空格后的原字符串，交由下游请求失败降级
 */
export const toFullSymbol = (input: string): string => {
  const trimmed = input.trim();
  try {
    return toTencentSymbol(normalizeSymbol(trimmed));
  } catch {
    return trimmed;
  }
};
