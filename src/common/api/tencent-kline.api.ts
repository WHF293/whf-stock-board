import dayjs from 'dayjs';
import type { KLineData } from 'klinecharts';
import { proxyFetch } from './proxy-fetch';
import type { SinaKlineFetchOptions, SinaKlinePeriod } from './sina-kline.api.ts';

/**
 * 腾讯 A 股历史 K 线数据源（web.ifzq.gtimg.cn `newfqkline/get`，2026-11-02 curl 实测）
 *
 * A 股日 / 周 / 月 K 统一切换到腾讯源 **前复权（qfq）** 口径：
 * - 行为分析模块（操作贡献度反事实推演 / 买卖点评分）要求前复权序列，新浪源不复权
 *   无法跨除权日计算（10 送 10 相邻收盘比会算出 -50% 假跌幅）；
 * - 港股 K 线此前已走腾讯 qfq（hk-kline.api.ts），本次对齐后全站历史 K 线口径统一；
 * - 分钟级（minute / fiveDay / min5）无复权概念，仍走新浪源（sina-kline.api.ts）。
 *
 * 上游能力边界（2026-11-02 实测）：
 * - day datalen 上限 **800**（900+ 返回 `param error`）→ 日 K 历史深度 ≈3.2 年；
 * - week 400 / month 200 可用；month 前复权早年价格可能为负（除权缩放固有现象，
 *   如茅台 2010 年为 -191），如实展示不做修饰；
 * - 响应键 `qfqday` / `qfqweek` / `qfqmonth`（与港股 hkfqkline 一致），数组外另有
 *   `market` 行情状态块，按键取数组即可；
 * - 行结构 10 列：`[日期, 开, 收, 高, 低, 量(手), {}, 涨跌幅, 额(万), 保留位]`
 *   （比港股多一个尾部保留位，下标 0-8 与港股一致）。
 *
 * 量纲（实测校准，茅台 2023-07-12：量 13285 / 额 228078.54 万 → 22.8 亿）：
 * - volume 上游为**手**，×100 转「股」口径（与新浪 A 股 / 港股一致，
 *   悬停联动 use-crosshair-quote 的 ÷100 股→手换算两端通用）；
 * - turnover 上游为**万元**，×1e4 转元（KLineData 统一存元）。
 */

/** 腾讯 A 股日 / 周 / 月 K 接口 */
const TENCENT_KLINE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get';

/** 各周期请求根数（day 上限 800 实测可达；week / month 一次取全量历史） */
const TENCENT_KLINE_BAR_COUNT = {
  daily: 800,
  weekly: 400,
  monthly: 200,
} as const;

/** 周期 → 上游 param 周期参数与响应数据键（day/qfqday 形态） */
const TENCENT_KLINE_PERIOD_PARAM = {
  daily: { param: 'day', dataKey: 'qfqday' },
  weekly: { param: 'week', dataKey: 'qfqweek' },
  monthly: { param: 'month', dataKey: 'qfqmonth' },
} as const;

/** 腾讯日 / 周 / 月 K 行：[日期, 开, 收, 高, 低, 量(手), 扩展对象, 涨跌幅, 额(万), 保留位] */
type TencentKlineRaw = [
  string,
  string,
  string,
  string,
  string,
  string,
  Record<string, unknown>,
  string,
  string,
  string?,
];

/** newfqkline 响应体（data 下按符号挂 qfqday / qfqweek / qfqmonth 键） */
interface TencentKlineResponse {
  code: number;
  msg: string;
  data: Record<string, Record<string, TencentKlineRaw[]>>;
}

/**
 * 拉取 A 股日 / 周 / 月 K（腾讯 qfq 前复权）
 *
 * barLimit 与新浪源共用调用约定：仅用于收窄单次请求根数（缓存层补尾部场景），
 * 会被各周期上限收敛
 * @param symbol 完整符号（sh600519 形态，腾讯接口直接可用）
 * @param period K 线周期（仅 daily / weekly / monthly；分钟级走新浪源）
 * @param options 可选请求参数（见 SinaKlineFetchOptions）
 * @returns klinecharts KLineData 序列（时间升序，volume=股、turnover=元）
 * @throws 上游请求失败 / 响应 code 非 0（含 param error）/ 数据为空时抛错
 */
export const fetchTencentKline = async (
  symbol: string,
  period: Extract<SinaKlinePeriod, 'daily' | 'weekly' | 'monthly'>,
  options?: SinaKlineFetchOptions,
): Promise<KLineData[]> => {
  const { param, dataKey } = TENCENT_KLINE_PERIOD_PARAM[period];
  const maxBars = TENCENT_KLINE_BAR_COUNT[period];
  const requestBars = Math.min(Math.max(options?.barLimit ?? maxBars, 1), maxBars);
  // param 五段形态与 curl 实测一致：symbol,period,起,止,根数,qfq（起止留空 = 最近 N 根）
  const url = `${TENCENT_KLINE_URL}?param=${symbol},${param},,,${requestBars},qfq`;

  const response = await proxyFetch(url);
  if (!response.ok) {
    throw new Error(`腾讯 K 线请求失败：HTTP ${response.status}`);
  }
  const text = await response.text();
  const jsonStart = text.indexOf('{');
  if (jsonStart === -1) {
    throw new Error(`腾讯 K 线响应解析失败：${text.slice(0, 80)}`);
  }
  const parsed = JSON.parse(text.slice(jsonStart)) as TencentKlineResponse;
  if (parsed.code !== 0) {
    throw new Error(`腾讯 K 线上游返回异常：${parsed.msg || parsed.code}`);
  }
  const rows = parsed.data[symbol]?.[dataKey] ?? [];
  if (rows.length === 0) {
    throw new Error(`腾讯 K 线无数据（${symbol} ${period}，上游 200 但序列为空）`);
  }
  return rows
    .map((row): KLineData | null => {
      const timestamp = dayjs(row[0].replace(/-/g, '/')).valueOf();
      if (!Number.isFinite(timestamp)) return null;
      return {
        timestamp,
        open: Number(row[1]),
        high: Number(row[3]),
        low: Number(row[4]),
        close: Number(row[2]),
        volume: Number(row[5]) * 100,
        turnover: Number(row[8]) * 10_000,
      } satisfies KLineData;
    })
    .filter((bar): bar is KLineData => bar !== null && bar.open > 0);
};
