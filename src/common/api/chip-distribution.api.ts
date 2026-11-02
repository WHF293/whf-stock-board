import { sdk } from './sdk';
import {
  CHIP_DISTRIBUTION_DAYS,
  CHIP_DISTRIBUTION_HISTOGRAM,
} from '../constants/chip-distribution.constants.ts';
import type { ChipDistributionItem } from 'stock-sdk';

export type { ChipDistributionItem };

/**
 * 筹码分布 api（2026-11-02 王总指定新增：股票详情整页右栏「筹码分布」卡）
 *
 * stock-sdk `chips.cn / hk / us`：移植东财前端 CYQ 算法在本地推演
 * （日 K + 换手率 → 获利比例 / 平均成本 / 90%·70% 成本区间与集中度 / 筹码峰），
 * 数据原料为东财日 K（走既有代理通道），无新增上游依赖。
 * 重接口（A 股约 120+ 根日 K），仅在打开详情页时拉取一次，不参与轮询。
 */

/**
 * 按完整符号分市场拉取筹码分布序列
 * @param symbol 完整符号（sh600519 / hk00700 / 美股 ticker 形态）
 * @returns 序列（日期升序；末行含最新一日筹码峰直方图）
 * @throws 上游日 K 拉取失败时抛出（由调用方空态兜底）
 */
export const fetchChipDistribution = async (symbol: string): Promise<ChipDistributionItem[]> => {
  const normalized = symbol.toLowerCase();
  // 港股：剥 hk 前缀传 5 位代码（'00700'，SDK 也接受 hk00700，统一剥掉更直白）
  if (normalized.startsWith('hk')) {
    return sdk.chips.hk(normalized.slice(2), {
      days: CHIP_DISTRIBUTION_DAYS,
      includeHistogram: CHIP_DISTRIBUTION_HISTOGRAM,
    });
  }
  // A 股：sh / sz 前缀 SDK 直接识别（'sh600519'）
  if (/^(sh|sz)/.test(normalized)) {
    return sdk.chips.cn(normalized, {
      days: CHIP_DISTRIBUTION_DAYS,
      includeHistogram: CHIP_DISTRIBUTION_HISTOGRAM,
    });
  }
  // 美股：剥可能存在的 us 前缀传裸 ticker（腾讯符号形态 usAAPL → AAPL）
  return sdk.chips.us(normalized.replace(/^us/, ''), {
    days: CHIP_DISTRIBUTION_DAYS,
    includeHistogram: CHIP_DISTRIBUTION_HISTOGRAM,
  });
};
