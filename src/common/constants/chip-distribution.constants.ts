/**
 * 筹码分布模块常量（2026-11-02 王总指定新增：股票详情整页右栏「筹码分布」卡）
 *
 * 数据源：stock-sdk `chips.cn / hk / us`（东财 CYQ 算法本地推演，
 * 原料为东财日 K + 换手率，无新增上游依赖）——文档 https://stock-sdk.linkdiary.cn/api/chips
 */

/** 拉取的序列长度（最近 N 个交易日；取末行作当前分布） */
export const CHIP_DISTRIBUTION_DAYS = 90;

/** 附带最新一日的筹码峰直方图（150 档价格占比） */
export const CHIP_DISTRIBUTION_HISTOGRAM = 'last' as const;

/**
 * 该符号是否适用筹码分布模型
 *
 * 筹码分布依赖换手率：指数（sh000 / sz399 / sh899 开头）与 ETF / LOF
 * （A 股场内基金 5 / 15 / 16 开头）无换手率概念，不适用。
 * @param symbol 完整符号（sh600519 / hk00700 / usAAPL 形态）
 * @returns 是否适用
 */
export const isChipApplicable = (symbol: string): boolean => {
  const normalized = symbol.toLowerCase();
  if (/^(sh000|sh899|sz399)/.test(normalized)) return false;
  if (/^sh[56]/.test(normalized) || /^sz1[56]/.test(normalized)) return false;
  return true;
};
