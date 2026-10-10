/**
 * 标的符号常量
 */

/**
 * A 股完整符号的市场前缀（sh / sz / bj）
 *
 * 上游（腾讯）返回的报价 `code` 是**裸代码**（`300339`），而自选股等本地存储
 * 用的是**完整符号**（`sz300339`）——两者做键匹配时必须先归一化，
 * 见 `utils/to-bare-code.ts` 与 `utils/find-quote-by-symbol.ts`。
 * 大小写不敏感：用户输入或历史数据里出现过 `SH600519` 形态。
 */
export const A_SHARE_MARKET_PREFIX_PATTERN = /^(sh|sz|bj)/i;
