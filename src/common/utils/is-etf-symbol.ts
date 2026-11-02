import { ETF_CODE_PREFIXES } from '../constants/etf.constants.ts';

/** 纯 6 位代码（剥离 sh/sz/bj 前缀后） */
const BARE_CODE_RE = /^\d{6}$/;

/** 完整符号的市场前缀（sh600519 / SZ000001 等） */
const MARKET_PREFIX_RE = /^(sh|sz|bj)/i;

/** 按市场分组的前缀（仅注释展示用，判定统一走 ETF_CODE_PREFIXES）：
 * 沪市 = 50 / 51 / 52 / 56 / 58，深市 = 15 / 16 / 18 */

/** 前缀按长度降序排列（当前全为 2 位；未来若混入 3 位段如 '588'，
 * 长前缀优先匹配才不会被子串前缀遮蔽） */
const SORTED_PREFIXES = [...ETF_CODE_PREFIXES].sort((a, b) => b.length - a.length);

/**
 * 判断当前标的是否为场内基金（ETF / LOF / 封基 / 分级）
 *
 * 行情接口对 A 股场内基金不区分 assetType，按交易所代码段判定（完整方案：
 * 沪市 50/51/52/56/58，深市 15/16/18，见 ETF_CODE_PREFIXES 注释）。
 *
 * @param symbol 完整符号（sh512760）或 6 位代码；大小写不敏感，容忍首尾空白
 * @returns 是否场内基金
 */
export const isEtfSymbol = (symbol: string): boolean => {
  const code = symbol.trim().replace(MARKET_PREFIX_RE, '');
  if (!BARE_CODE_RE.test(code)) return false;
  return SORTED_PREFIXES.some((prefix) => code.startsWith(prefix));
};
