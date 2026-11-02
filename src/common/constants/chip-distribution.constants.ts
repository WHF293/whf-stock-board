/**
 * 筹码分布模块常量（2026-11-02 王总指定新增：股票详情整页右栏「筹码分布」卡）
 *
 * 数据源（2026-11-02 改版）：日 K（A 股新浪 / 港股腾讯 ifzq，volume=股）+
 * 实时行情推演流通股本，经 stock-sdk 导出的纯函数 `calcChipDistribution`
 * 本地推演（与东财官网前端同款 CYQ 算法，服务端无现成接口）——
 * 文档 https://stock-sdk.linkdiary.cn/api/indicators
 */

import { isEtfSymbol } from '../utils/is-etf-symbol';

/** 拉取的序列长度（最近 N 个交易日；取末行作当前分布） */
export const CHIP_DISTRIBUTION_DAYS = 90;

/** 附带最新一日的筹码峰直方图（150 档价格占比） */
export const CHIP_DISTRIBUTION_HISTOGRAM = 'last' as const;

/** 日 K 拉取根数（≥ DAYS 留余量：窗口不满 90 根的次新股用实际根数推演） */
export const CHIP_DISTRIBUTION_BAR_LIMIT = 120;

/** 产出分布所需的最少日 K 根数（历史过短时分布由首日堆叠决定，无参考价值） */
export const CHIP_DISTRIBUTION_MIN_BARS = 20;

/**
 * 指数代码段（无换手率概念）：沪综指 sh000 / 上证基金指数等 sh899 / 深成指 sz399
 */
const INDEX_SYMBOL_RE = /^(sh000|sh899|sz399)/;

/**
 * 该符号是否适用筹码分布模型
 *
 * 筹码分布依赖换手率：指数（sh000 / sz399 / sh899 开头）与 ETF / LOF
 * 等场内基金无换手率概念，不适用。场内基金判定复用 isEtfSymbol 完整方案
 * （沪 50/51/52/56/58、深 15/16/18，单一事实来源——勿在本处另写前缀正则，
 * 2026-11-02 sh603005 误判事故即源于此处的重复 /^sh[56]/ 规则）。
 * @param symbol 完整符号（sh600519 / hk00700 / usAAPL 形态）
 * @returns 是否适用
 */
export const isChipApplicable = (symbol: string): boolean => {
  const normalized = symbol.toLowerCase();
  if (INDEX_SYMBOL_RE.test(normalized)) return false;
  return !isEtfSymbol(normalized);
};
