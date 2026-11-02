import dayjs from 'dayjs';
import { calcChipDistribution, type ChipDistributionItem } from 'stock-sdk';
import { fetchKlineCached } from './kline-cache.api';
import { fetchFullQuotes } from './quotes.api';
import { sdk } from './sdk';
import {
  CHIP_DISTRIBUTION_DAYS,
  CHIP_DISTRIBUTION_HISTOGRAM,
  CHIP_DISTRIBUTION_BAR_LIMIT,
  CHIP_DISTRIBUTION_MIN_BARS,
} from '../constants/chip-distribution.constants.ts';
import type { FullQuote } from '../types/stock-quote.types.ts';

export type { ChipDistributionItem };

/**
 * 筹码分布 api（2026-11-02 王总指定新增：股票详情整页右栏「筹码分布」卡）
 *
 * ⚠️ 数据源（2026-11-02 改版，原 SDK `chips.cn / hk` 已弃用）：
 * 东财官网的筹码分布图同样是**前端本地推演**（efinance 作者抓包实锤，
 * 服务端无 CYQ 接口），原料 = 日 K（OHLC + 成交量）+ 换手率。而 SDK 的
 * `chips.cn / hk` 固定从东财 push2his 拉日 K——该域对本机出口按 TLS 指纹
 * 掐连接（curl / node / Rust 直连全 RST，浏览器指纹可过），导致筹码卡全票空态。
 * 故改为：**日 K 走可达源（A 股新浪 / 港股腾讯 ifzq，均经既有 kline-cache 通道，
 * volume 单位为股）+ 实时行情推演流通股本 + SDK 导出的纯函数
 * `calcChipDistribution` 本地推演**（与 SDK chips 内部用的是同一套东财算法）。
 *
 * 口径说明：
 * - 换手率按「当日成交量 / 当前流通股本」重算（东财 f61 为逐日真实换手率，
 *   股本变动期间有微小漂移，对 90 日窗口影响可忽略）；
 * - 日 K 为前复权（腾讯源，2026-11-02 起与全站 K 线口径一致；除权日台阶消失，东财前复权
 *   口径下同样存在，仅为形状差异）；
 * - 美股仍走 SDK `chips.us`（东财源，本机不可达时随上游恢复，无替代源）。
 * 重接口（90+ 根日 K），仅在打开详情时拉取一次，不参与轮询。
 */

/**
 * 由实时报价推演流通股本（股）
 *
 * 首选「流通市值 ÷ 现价」（东财换手率分母同口径）；缺失时退化用
 * 「成交量 ÷ 换手率」（当日累计成交量与换手率同源同刻，量纲自洽）。
 * @param quote 完整报价（A 股 / 港股映射口径，volume 为手）
 * @returns 流通股本（股）；无法推演时为 null
 */
const estimateFloatShares = (quote: FullQuote | undefined): number | null => {
  if (!quote) return null;
  if (quote.circulatingMarketCap !== null && quote.price > 0) {
    return (quote.circulatingMarketCap * 1e8) / quote.price;
  }
  if (quote.volume > 0 && quote.turnoverRate !== null && quote.turnoverRate > 0) {
    return (quote.volume * 100) / (quote.turnoverRate / 100);
  }
  return null;
};

/**
 * 按完整符号拉取筹码分布序列
 * @param symbol 完整符号（sh600519 / hk00700 / 美股 ticker 形态）
 * @returns 序列（日期升序；末行含最新一日筹码峰直方图）；无法推演时为空数组
 * @throws 日 K / 报价拉取失败时抛出（由调用方空态兜底）
 */
export const fetchChipDistribution = async (symbol: string): Promise<ChipDistributionItem[]> => {
  const normalized = symbol.toLowerCase();
  // 美股：SDK `chips.us`（东财源）——本机直连被掐时随上游恢复，无替代源兜底
  if (!normalized.startsWith('hk') && !/^(sh|sz)/.test(normalized)) {
    return sdk.chips.us(normalized.replace(/^us/, ''), {
      days: CHIP_DISTRIBUTION_DAYS,
      includeHistogram: CHIP_DISTRIBUTION_HISTOGRAM,
    });
  }

  // 日 K（A 股新浪 / 港股腾讯 ifzq，volume 均为股）与实时报价并行拉取
  const [bars, quotes] = await Promise.all([
    fetchKlineCached(normalized, 'daily', { barLimit: CHIP_DISTRIBUTION_BAR_LIMIT }),
    fetchFullQuotes([normalized]),
  ]);
  const floatShares = estimateFloatShares(quotes[0]);
  // 股本推演失败（如港股快照缺市值）或历史过短（次新股不足最小窗口）不出分布
  if (floatShares === null || floatShares <= 0 || bars.length < CHIP_DISTRIBUTION_MIN_BARS) {
    return [];
  }

  // 逐日换手率 = 当日成交量(股) / 流通股本(股) × 100（%）
  const chipKlines = bars.map((bar) => ({
    date: dayjs(bar.timestamp).format('YYYY-MM-DD'),
    open: bar.open ?? null,
    high: bar.high ?? null,
    low: bar.low ?? null,
    close: bar.close ?? null,
    turnoverRate: ((bar.volume ?? 0) / floatShares) * 100,
  }));
  // 只对末根产出统计行（tail: 1），前序 bar 仅参与分布推演暖机
  return calcChipDistribution(chipKlines, {
    range: CHIP_DISTRIBUTION_DAYS,
    tail: 1,
    includeHistogram: CHIP_DISTRIBUTION_HISTOGRAM,
  });
};
