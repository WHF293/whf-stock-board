import { A_SHARE_MARKET_PREFIX_PATTERN } from '../constants/symbol.constants';

/**
 * 完整符号 → 裸代码（`sz300339` / `SH600519` → `300339` / `600519`）
 *
 * 上游行情接口（腾讯）返回的报价 `code` 是裸代码形态，与本地存储的完整符号
 * 不同形态；凡是「按符号取上游报价」的场景都要用它归一化，
 * 否则键永远匹配不上（表现为整列 `--`）。
 * @param symbol 任意形态符号（完整符号或裸代码）
 * @returns 去掉市场前缀的裸代码；无前缀时原样返回
 */
export const toBareCode = (symbol: string): string =>
  symbol.trim().replace(A_SHARE_MARKET_PREFIX_PATTERN, '');
