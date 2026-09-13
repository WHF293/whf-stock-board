import { TURNOVER_INDEX_SECIDS } from '../constants/turnover.constants';
import type { TurnoverDayItem } from '../types/turnover.types';
import { proxyFetch } from './proxy-fetch';

/**
 * 沪深两市总成交额历史（成交额变化模块数据源）
 *
 * 数据源：东方财富 push2 kline（push2.eastmoney.com，经 proxyFetch 同源代理转发，
 * 与 panorama / sdk 共用同一可达域；返回真实成交金额 f57，无需 volume×收盘价近似）
 * —— 直接取上证指数(1.000001) + 深证成指(0.399001) 日 K 的成交额字段，同交易日相加。
 *
 * 为什么不走新浪：新浪指数日 K 仅返回 volume（成交量，单位手），无成交额字段；
 * 且「成交额 = 成交量 × 收盘价」对指数不成立（指数是成分股加权聚合，非单一证券，
 * 实测上证该式结果约为真实成交额的 235 倍），故不采用新浪源。
 *
 * ⚠️ 重接口（K 线 × 2）：仅挂载时拉取一次，不参与轮询；
 * 数据不变性强，30 / 60 / 180 交易日窗口由调用方本地切片
 */

/** 东财 kline 公共 ut 参数（与 sdk / panorama 一致） */
const EM_UT = '7eea3edcaed734bea9cbfc24409ed989';

/**
 * kline 候选 host：push2 为主，push2delay 为兜底
 * （两者同属 eastmoney.com，已在代理白名单内；push2 为 kline 标准实时域）
 */
const KLINE_HOSTS = [
  'https://push2.eastmoney.com/api/qt/stock/kline/get',
  'https://push2delay.eastmoney.com/api/qt/stock/kline/get',
] as const;

/** 东财 kline 上游响应体（仅取成交额所需字段） */
interface EmKlineResponse {
  data: {
    /** 每行为「日期,开,收,高,低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率」逗号串 */
    klines: string[];
  } | null;
}

/**
 * 拉取单指数逐日成交额（元），返回 日期 -> 成交额 映射
 *
 * 依次尝试 KLINE_HOSTS，任一成功即用；全部失败抛出（便于上层空态提示）
 * @param secid 东财 secid（如 1.000001）
 * @returns 日期 -> 成交额（元）映射
 */
const fetchIndexAmountMap = async (secid: string): Promise<Map<string, number>> => {
  const query = [
    'fields1=f1,f2,f3,f4,f5,f6',
    // f51 日期 … f57 成交额(元) … f61 换手率
    'fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    `ut=${EM_UT}`,
    'klt=101', // 日 K
    'fqt=0', // 不复权
    `secid=${secid}`,
    'beg=20250901',
    'end=20500101',
    'smplmt=400',
    'lmt=400',
  ].join('&');

  let lastErr: unknown;
  for (const host of KLINE_HOSTS) {
    try {
      const response = await proxyFetch(`${host}?${query}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = (await response.json()) as EmKlineResponse;
      const map = new Map<string, number>();
      for (const line of body.data?.klines ?? []) {
        const parts = line.split(',');
        // [0] 日期；[6] 成交额(元)
        map.set(parts[0], Number(parts[6]) || 0);
      }
      return map;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`东财成交额拉取失败：${String(lastErr)}`);
};

/**
 * 拉取沪深两市总成交额历史（升序）
 *
 * 以两指数交易日并集为基准，同日期的成交额相加（任一缺失按 0 计，保证日期轴连续）
 * @returns 逐日 { 日期, 总成交额, 上证成交额, 深证成交额 } 序列（按日期升序）
 */
export const fetchMarketTurnover = async (): Promise<TurnoverDayItem[]> => {
  const shMap = await fetchIndexAmountMap(TURNOVER_INDEX_SECIDS.SH);
  const szMap = await fetchIndexAmountMap(TURNOVER_INDEX_SECIDS.SZ);

  // 两指数交易日历基本一致，取并集按日期升序遍历
  const dates = [...new Set([...shMap.keys(), ...szMap.keys()])].sort();
  return dates.map((date) => {
    const shanghaiAmount = shMap.get(date) ?? 0;
    const shenzhenAmount = szMap.get(date) ?? 0;
    return {
      date,
      shanghaiAmount,
      shenzhenAmount,
      totalAmount: shanghaiAmount + shenzhenAmount,
    };
  });
};
