import { ETF_CODE_PREFIXES } from '../constants/etf.constants.ts';

/** 纯 6 位代码（剥离 sh/sz/bj 前缀后） */
const BARE_CODE_RE = /^\d{6}$/;

/** 完整符号的市场前缀（sh600519 / SZ000001 等） */
const MARKET_PREFIX_RE = /^(sh|sz|bj)/i;

/**
 * 判断当前标的是否为场内基金（ETF / LOF）
 *
 * 行情接口对 A 股场内基金不区分 assetType，按交易所代码段判定：
 * 沪市 5 开头（51x/56x/58x ETF、501/502 LOF 等），深市 15/16/18 开头。
 * @param symbol 完整符号（sh512760）或 6 位代码
 * @returns 是否场内基金
 */
export const isEtfSymbol = (symbol: string): boolean => {
  const code = symbol.trim().replace(MARKET_PREFIX_RE, '');
  if (!BARE_CODE_RE.test(code)) return false;
  return ETF_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
};
