import dayjs from 'dayjs';
import type { KLineData } from 'klinecharts';
import { proxyFetch } from './proxy-fetch';
import type { SinaKlineFetchOptions, SinaKlinePeriod } from './sina-kline.api';

/**
 * 港股 K 线 / 分时数据源（腾讯 web.ifzq.gtimg.cn，免 Token；2026-10-30 curl 实测）
 *
 * 为什么不走 SDK 的 `sdk.kline.hk` / `sdk.kline.hkMinute`：两者实为**东财
 * push2his.eastmoney.com 源**（secid=116.x），该域族在本机出口 TCP 层被断
 * （2026-10-30 复测 000，与 2026-09-15 封禁同款），push2delay 改道域同样不可达；
 * 而腾讯域（qt.gtimg.cn / web.ifzq.gtimg.cn）长期稳定且已在代理白名单。
 *
 * 上游能力边界（实测）：
 * - 日 / 周 / 月 K：`hkfqkline/get`，复权仅支持 qfq（前复权）/ hfq，**不提供不复权**
 *   ——与 A 股新浪源「不复权」口径不同，详情页注释需按前复权说明；
 * - 分钟 K（m5/m15/m30/m60）：`hkfqkline/get` 对港股返回 bad params，**无源**；
 * - 当日分时：`minute/query?code=hk00700`，行格式 `HHMM 价 量(股) 额(元)`；
 * - 近五日分时：`day/query?code=hk00700`，按日分组的同款行格式。
 *   「5分」周期由五日 1 分钟数据**本地按 5 根聚合**（66 根/日，详情图用途足够）。
 *
 * 量纲（实测校准）：K 线行 volume=股、amount=万港元；分时行 volume=股、amount=元。
 * KLineData.turnover 统一存元；volume 保持股（与 A 股新浪源「股」口径一致，
 * 悬停联动 use-crosshair-quote 的 ÷100 股→手换算两端通用）
 */

/** 腾讯港股分时接口（当日） */
const HK_MINUTE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query';

/** 腾讯港股分时接口（近五日，按日分组） */
const HK_FIVE_DAY_MINUTE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/day/query';

/** 腾讯港股日 / 周 / 月 K 接口 */
const HK_KLINE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get';

/** 日 / 周 / 月 K 各周期请求根数（腾讯单次上限未文档化，800 实测可达，详情图深度足够） */
const HK_KLINE_BAR_COUNT = {
  daily: 800,
  weekly: 400,
  monthly: 200,
} as const;

/** hkfqkline JSONP 回调变量名（剥离响应前缀用） */
const HK_KLINE_JSONP_VAR = 'kline_hk';

/** 港股 K 线上游约定的复权方式（qfq 前复权；上游不提供不复权） */
const HK_KLINE_ADJUST = 'qfq';

/** 腾讯日 / 周 / 月 K 行：[日期, 开, 收, 高, 低, 量(股), 扩展对象, 涨跌幅, 额(万)] */
type HkHistoryKlineRaw = [
  string,
  string,
  string,
  string,
  string,
  string,
  Record<string, unknown>,
  string,
  string,
];

/** 腾讯分钟行：`HHMM 价 量(股) 额(元)`（空格分隔） */
type HkMinuteRowRaw = string;

/** hkfqkline 响应体（data 下按符号挂 qfqday / qfqweek / qfqmonth 键） */
interface HkKlineResponse {
  code: number;
  msg: string;
  data: Record<string, Record<string, HkHistoryKlineRaw[]>>;
}

/** minute/query 与 day/query 响应的 qt 行情块（第 31 位为 `YYYY/MM/DD HH:mm:ss` 行情时间串） */
interface HkQtBlock {
  qt?: Record<string, string[]>;
}

/** minute/query 响应体（data.data 为分钟行数组） */
interface HkMinuteResponse extends HkQtBlock {
  code: number;
  msg: string;
  data: Record<
    string,
    { data: { data: HkMinuteRowRaw[] } }
  >;
}

/** day/query 响应体（data.data 为按日分组的分钟行） */
interface HkFiveDayResponse extends HkQtBlock {
  code: number;
  msg: string;
  data: Record<
    string,
    { data: { date: string; data: HkMinuteRowRaw[] }[] }
  >;
}

/**
 * 解析腾讯分钟行：`HHMM 价 量 额` → KLineData
 * @param row 分钟行原文
 * @param datePrefix 交易日 `YYYY-MM-DD`（上游只给 HHMM）
 * @returns K 线 bar（volume=股，turnover=元；解析失败为 null）
 */
const parseHkMinuteRow = (row: string, datePrefix: string): KLineData | null => {
  const [hhmm, price, volume, amount] = row.split(' ');
  const timestamp = dayjs(`${datePrefix} ${hhmm.replace(/(\d{2})(\d{2})/, '$1:$2')}`).valueOf();
  if (!Number.isFinite(timestamp)) return null;
  const close = Number(price);
  return {
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    volume: Number(volume),
    turnover: Number(amount),
  };
};

/**
 * 给分钟序列补均价（累计额 / 累计量），写入 avgPrice 自定义字段
 *
 * 腾讯分时行自带成交额（元），无需像新浪那样从 turnover 反推；
 * 口径与新浪 applyAvgPrice 一致：累计成交额 / 累计成交量（股）
 * @param bars 分钟序列（原对象上补字段）
 */
const applyAvgPrice = (bars: KLineData[]): void => {
  let cumAmount = 0;
  let cumVolume = 0;
  let prevAvg = Number.NaN;
  for (const bar of bars) {
    cumVolume += bar.volume ?? 0;
    cumAmount += (bar.turnover as number | undefined) ?? 0;
    if (cumVolume > 0) {
      prevAvg = cumAmount / cumVolume;
    }
    bar.avgPrice = prevAvg;
  }
};

/**
 * 从 minute / day/query 响应解析数据日期基准（`YYYY-MM-DD`）
 *
 * 分钟行只带 HHMM 无日期；qt 块第 31 位为行情时间串（`YYYY/MM/DD HH:mm:ss`，
 * 港股时区与本地同为 UTC+8，直接解析日期部分），非交易时段拉到上一交易日
 * 分时也能正确落位。解析失败回退当天
 * @param parsed 响应体
 * @param symbol 腾讯港股符号
 * @returns 日期前缀 `YYYY-MM-DD`
 */
const resolveMinuteDatePrefix = (
  parsed: HkQtBlock,
  symbol: string,
): string => {
  const quoteTime = parsed.qt?.[symbol]?.[30];
  const match = typeof quoteTime === 'string' ? /^(\d{4})\/(\d{2})\/(\d{2})/.exec(quoteTime) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : dayjs().format('YYYY-MM-DD');
};

/**
 * 拉取港股当日分时
 * @param symbol 腾讯港股符号（hk00700）
 * @returns 分钟序列（时间升序，附 avgPrice 均价）
 * @throws 上游请求失败 / 响应 code 非 0 / 无数据时抛错
 */
const fetchHkMinuteTimeline = async (symbol: string): Promise<KLineData[]> => {
  const response = await proxyFetch(`${HK_MINUTE_URL}?code=${symbol}`);
  if (!response.ok) {
    throw new Error(`港股分时请求失败：HTTP ${response.status}`);
  }
  const parsed = (await response.json()) as HkMinuteResponse;
  if (parsed.code !== 0) {
    throw new Error(`港股分时上游返回异常：${parsed.msg || parsed.code}`);
  }
  const day = Object.values(parsed.data)[0];
  const rows = day?.data?.data ?? [];
  const datePrefix = resolveMinuteDatePrefix(parsed, symbol);
  return rows
    .map((row) => parseHkMinuteRow(row, datePrefix))
    .filter((bar): bar is KLineData => bar !== null && bar.open > 0);
};

/**
 * 拉取港股近五日分时（按日分组的 1 分钟数据）
 * @param symbol 腾讯港股符号
 * @returns 分钟序列（时间升序，附 avgPrice 均价）
 * @throws 上游请求失败 / 响应 code 非 0 / 无数据时抛错
 */
const fetchHkFiveDayMinute = async (symbol: string): Promise<KLineData[]> => {
  const response = await proxyFetch(`${HK_FIVE_DAY_MINUTE_URL}?code=${symbol}`);
  if (!response.ok) {
    throw new Error(`港股五日分时请求失败：HTTP ${response.status}`);
  }
  const parsed = (await response.json()) as HkFiveDayResponse;
  if (parsed.code !== 0) {
    throw new Error(`港股五日分时上游返回异常：${parsed.msg || parsed.code}`);
  }
  const days = Object.values(parsed.data)[0]?.data ?? [];
  const bars: KLineData[] = [];
  for (const day of days) {
    const datePrefix = dayjs(day.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')).format(
      'YYYY-MM-DD',
    );
    for (const row of day.data) {
      const bar = parseHkMinuteRow(row, datePrefix);
      if (bar && bar.open > 0) {
        bars.push(bar);
      }
    }
  }
  return bars;
};

/**
 * 把 1 分钟序列按连续 5 根聚合为 5 分钟 K（港股上游无分钟 K 源，本地聚合）
 *
 * 按日内顺序每 5 根一组（开=首根开、收=末根收、高低=组内极值、量额=组内求和），
 * 时间戳取组内首根；跨日不合并（五日数据按日边界天然分组）
 * @param bars 分钟序列（时间升序）
 * @returns 5 分钟 K 序列
 */
const aggregateTo5Min = (bars: KLineData[]): KLineData[] => {
  const result: KLineData[] = [];
  for (let i = 0; i < bars.length; i += 5) {
    const group = bars.slice(i, i + 5);
    if (group.length === 0) continue;
    result.push({
      timestamp: group[0].timestamp,
      open: group[0].open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, bar) => sum + (bar.volume ?? 0), 0),
      turnover: group.reduce((sum, bar) => sum + ((bar.turnover as number) ?? 0), 0),
    });
  }
  return result;
};

/**
 * 拉取港股日 / 周 / 月 K（腾讯 qfq 前复权；上游不提供不复权，与 A 股新浪口径不同）
 * @param symbol 腾讯港股符号
 * @param period 周期（daily / weekly / monthly）
 * @returns K 线序列（volume=股，turnover=元）
 * @throws 上游请求失败 / 响应 code 非 0 / 无数据时抛错
 */
const fetchHkHistoryKline = async (
  symbol: string,
  period: Extract<SinaKlinePeriod, 'daily' | 'weekly' | 'monthly'>,
): Promise<KLineData[]> => {
  const periodParam = period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month';
  const dataKey = `qfq${periodParam}`;
  const url =
    `${HK_KLINE_URL}?_var=${HK_KLINE_JSONP_VAR}` +
    `&param=${symbol},${periodParam},,,${HK_KLINE_BAR_COUNT[period]},${HK_KLINE_ADJUST}`;
  const response = await proxyFetch(url);
  if (!response.ok) {
    throw new Error(`港股 K 线请求失败：HTTP ${response.status}`);
  }
  const text = await response.text();
  const jsonStart = text.indexOf('{');
  if (jsonStart === -1) {
    throw new Error(`港股 K 线响应解析失败：${text.slice(0, 80)}`);
  }
  const parsed = JSON.parse(text.slice(jsonStart)) as HkKlineResponse;
  if (parsed.code !== 0) {
    throw new Error(`港股 K 线上游返回异常：${parsed.msg || parsed.code}`);
  }
  const rows = Object.values(parsed.data)[0]?.[dataKey] ?? [];
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
        volume: Number(row[5]),
        turnover: Number(row[8]) * 10_000,
      } satisfies KLineData;
    })
    .filter((bar): bar is KLineData => bar !== null && bar.open > 0);
};

/**
 * 拉取港股 K 线并转为 klinecharts 数据结构（时间升序）
 *
 * 周期 → 上游映射见文件头；「5分」由五日 1 分钟数据本地聚合。
 * barLimit 参数与新浪源共用调用约定：仅用于收窄分钟级窗口根数，
 * 日 / 周 / 月 K 一次取满不参与收窄
 * @param symbol 完整符号（hk00700 形态，腾讯接口直接可用）
 * @param period K 线周期
 * @param options 可选请求参数（与新浪源共用调用约定；港股各周期全量下发，不参与收窄）
 * @returns klinecharts KLineData 序列（分钟级附 avgPrice 均价字段）
 */
export const fetchHkKline = async (
  symbol: string,
  period: SinaKlinePeriod,
  options?: SinaKlineFetchOptions,
): Promise<KLineData[]> => {
  // barLimit 为新浪源「按根收窄」约定：港股分时 / 五日按日全量下发、日K一次取满，均不参与收窄
  void options;
  switch (period) {
    case 'minute': {
      const bars = await fetchHkMinuteTimeline(symbol);
      applyAvgPrice(bars);
      return bars;
    }
    case 'fiveDay': {
      const all = await fetchHkFiveDayMinute(symbol);
      // 收窄到最近 5 个交易日（上游按日全量下发，防止假日多的窗口超 5 日）
      const dayPrefixes = [
        ...new Set(all.map((bar) => dayjs(bar.timestamp).format('YYYY-MM-DD'))),
      ].slice(-5);
      const kept = new Set(dayPrefixes);
      const bars = all.filter((bar) => kept.has(dayjs(bar.timestamp).format('YYYY-MM-DD')));
      applyAvgPrice(bars);
      return bars;
    }
    case 'min5': {
      const all = await fetchHkFiveDayMinute(symbol);
      return aggregateTo5Min(all);
    }
    case 'daily':
    case 'weekly':
    case 'monthly':
      return fetchHkHistoryKline(symbol, period);
  }
};
