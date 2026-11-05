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
 * ETF 筹码口径警示（2026-11-06 王总指定新增：ETF 筹码分布卡顶部提示条）
 *
 * V1 对齐同花顺的行业妥协口径：换手率分母 = 最新披露基金份额（固定值近似），
 * 未含一级市场申赎的筹码注入 / 销毁；份额大幅变动期（大额套利、QDII、题材 ETF）
 * 失真明显，仅作参考。
 */
export const ETF_CHIP_NOTICE =
  '⚠️ ETF 筹码按场内成交推演，份额取最新披露值近似，未含一级申赎；份额大幅变动期失真较大，仅作参考';

/**
 * 指数代码段（无换手率概念）：沪综指 sh000 / 上证基金指数等 sh899 / 深成指 sz399
 */
const INDEX_SYMBOL_RE = /^(sh000|sh899|sz399)/;

/**
 * 该符号是否适用筹码分布模型
 *
 * 指数（sh000 / sz399 / sh899 开头）无换手率概念，不适用。ETF / LOF 等场内基金
 * 自 2026-11-06 起放行：换手率分母用行情源「流通市值 ÷ 现价」推演的基金份额
 * （场内基金份额口径，见 chip-distribution.api.ts 的 ETF 段注释），与个股共用
 * 同一套推演与计算链，仅前端加失真警示条。场内基金判定复用 isEtfSymbol 完整
 * 方案（沪 50/51/52/56/58、深 15/16/18，单一事实来源——勿在本处另写前缀正则，
 * 2026-11-02 sh603005 误判事故即源于此处的重复 /^sh[56]/ 规则）。
 * @param symbol 完整符号（sh600519 / hk00700 / usAAPL 形态）
 * @returns 是否适用
 */
export const isChipApplicable = (symbol: string): boolean => {
  const normalized = symbol.toLowerCase();
  return !INDEX_SYMBOL_RE.test(normalized);
};

/**
 * 该符号是否走 ETF 筹码口径（用于前端警示条等差异化展示）
 *
 * 判定复用 isEtfSymbol（单一事实来源），与 isChipApplicable 的放行范围一致；
 * 港股无场内基金识别函数，维持个股口径不在此列。
 * @param symbol 完整符号（sh600519 / sh510300 / hk00700 形态）
 * @returns 是否 ETF 筹码口径
 */
export const isEtfChip = (symbol: string): boolean => isEtfSymbol(symbol.toLowerCase());
