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
  isEtfChip,
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
 *
 * ETF 口径（2026-11-06 王总指定放行，V1 对齐同花顺）：场内基金无「流通股本」概念，
 * 换手率分母用**基金总份额（份）**。公开行情源不提供每日份额历史（腾讯 ifzq /
 * 东财 push2his K 线只有 OHLCV；SDK 的 FundProfile.buySedemption 仅季度披露点），
 * 故与同花顺一致取**最新披露份额作整个回看窗口的固定分母**：行情源对场内基金的
 * 「流通市值」= 份额 × 现价，`estimateFloatShares` 的推演公式数学上直接还原份额，
 * 与个股共用同一条链（语义按标的类型自然切换），仅份额两级兜底为 ETF 专属。
 * 已知失真（前端警示条同步提示）：一级申赎的筹码注入 / 销毁不参与模型；份额
 * 大幅变动期（大额套利、QDII、题材 ETF）误差明显。
 * 重接口（90+ 根日 K），仅在打开详情时拉取一次，不参与轮询。
 */

/**
 * 由实时报价推演流通股本 / 基金份额（股 / 份）
 *
 * 首选「流通市值 ÷ 现价」（东财换手率分母同口径；对 ETF 该值 = 份额 × 现价，
 * 除以现价即还原份额）；缺失时退化用「成交量 ÷ 换手率」（当日累计成交量与
 * 换手率同源同刻，量纲自洽）；再缺失时用报价直出的流通股本字段（腾讯快照
 * 直出，ETF 场景部分源填基金份额）。
 * @param quote 完整报价（A 股 / 港股映射口径，volume 为手）
 * @returns 流通股本（股）或基金份额（份）；无法推演时为 null
 */
const estimateFloatShares = (quote: FullQuote | undefined): number | null => {
  if (!quote) return null;
  if (quote.circulatingMarketCap !== null && quote.price > 0) {
    return (quote.circulatingMarketCap * 1e8) / quote.price;
  }
  if (quote.volume > 0 && quote.turnoverRate !== null && quote.turnoverRate > 0) {
    return (quote.volume * 100) / (quote.turnoverRate / 100);
  }
  if (quote.circulatingShares !== null && quote.circulatingShares > 0) {
    return quote.circulatingShares;
  }
  return null;
};

/**
 * ETF 份额最终兜底：东财基金档案的季度申赎披露（pingzhongdata，浏览器端 script
 * 注入可过 WAF）
 *
 * 仅在报价推演失败时调用——该源是整包大文件请求，且季度「期末总份额」粒度粗，
 * 只保证「份额稳定品种能出分布」的底线，不追求精度。
 * @param symbol 完整符号（sh510300 / sz159915 形态）
 * @returns 基金总份额（份）；披露缺失或请求失败时为 null
 */
const estimateEtfSharesFromProfile = async (symbol: string): Promise<number | null> => {
  try {
    const profile = await sdk.fund.profile(symbol.replace(/^(sh|sz)/, ''));
    const latestQuarter = profile.buySedemption.at(-1);
    if (latestQuarter && latestQuarter.total > 0) {
      return latestQuarter.total * 1e8; // 亿份 → 份
    }
    return null;
  } catch {
    return null;
  }
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
  // 分母：个股 = 流通股本，ETF = 基金份额（同一推演公式，见顶部 ETF 口径注释）；
  // ETF 推演失败再走季度披露兜底，仍失败才空态
  let floatShares = estimateFloatShares(quotes[0]);
  if ((floatShares === null || floatShares <= 0) && isEtfChip(normalized)) {
    floatShares = await estimateEtfSharesFromProfile(normalized);
    if (floatShares !== null) {
      console.warn(
        `[chip-distribution] ${normalized} 报价推演份额失败，退用东财季度披露期末总份额（粒度粗）`,
      );
    }
  }
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
