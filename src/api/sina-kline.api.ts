import dayjs from 'dayjs';
import type { KLineData } from 'klinecharts';
import { proxyFetch } from './proxy-fetch';

/**
 * 新浪财经 K 线数据源（quotes.sina.cn，免 Token；接口文档见 .ai/项目资源/新浪接口文档.md）
 *
 * stock-sdk 的东财日K/周K 实测无数据，统一改走新浪源；
 * 返回价格均为不复权，K 线图侧不再提供复权切换
 */

/**
 * K 线周期
 *
 * minute / fiveDay 为 1 分钟线（分时 / 五日），其余对应新浪 scale 周期
 */
export type SinaKlinePeriod =
  | 'minute'
  | 'fiveDay'
  | 'min5'
  | 'daily'
  | 'weekly'
  | 'monthly';

/** 新浪 K 线请求参数（scale 周期分钟数 / 拉取根数 / 保留交易日数） */
const SINA_KLINE_CONFIG: Record<
  SinaKlinePeriod,
  { scale: number; datalen: number; keepDays: number }
> = {
  // 1 分钟线窗口有限（约最近若干交易日），按根数覆盖所需交易日后本地截取
  minute: { scale: 1, datalen: 320, keepDays: 1 },
  fiveDay: { scale: 1, datalen: 700, keepDays: 5 },
  min5: { scale: 5, datalen: 500, keepDays: Number.MAX_SAFE_INTEGER },
  daily: { scale: 240, datalen: 400, keepDays: Number.MAX_SAFE_INTEGER },
  weekly: { scale: 1200, datalen: 200, keepDays: Number.MAX_SAFE_INTEGER },
  monthly: { scale: 7200, datalen: 120, keepDays: Number.MAX_SAFE_INTEGER },
};

/** 新浪上游要求的 Referer（缺失返回 403） */
const SINA_REFERER = 'https://finance.sina.com.cn';

/** 新浪 K 线原始记录（数值均为字符串） */
interface SinaKlineRaw {
  /** 日/周/月K 为 YYYY-MM-DD；分钟K 为 YYYY-MM-DD HH:MM:00（该段结束时间） */
  day: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  /** 成交额（元），仅分钟级返回 */
  amount?: string;
}

/**
 * 解析新浪 JSONP 文本：剥离首行注释、`var _=(` 前缀与尾部 `);`
 * @param text 响应原文
 * @returns 解析后的原始记录数组
 */
const parseJsonp = (text: string): SinaKlineRaw[] => {
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`新浪 K 线响应解析失败：${text.slice(0, 80)}`);
  }
  return JSON.parse(text.slice(start + 1, end)) as SinaKlineRaw[];
};

/**
 * 计算分时均价（累计成交额 / 累计成交量），写入 avgPrice 自定义字段
 * @param bars 分钟线序列（原对象上补字段）
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
 * 拉取新浪 K 线并转为 klinecharts 数据结构（时间升序）
 * @param symbol 完整符号（sh600519 形态，新浪前缀一致可直接使用）
 * @param period K 线周期
 * @returns klinecharts KLineData 序列（分钟级附 avgPrice 均价字段）
 */
export const fetchSinaKline = async (
  symbol: string,
  period: SinaKlinePeriod,
): Promise<KLineData[]> => {
  const { scale, datalen, keepDays } = SINA_KLINE_CONFIG[period];
  const url =
    `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_=` +
    `/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=${scale}&ma=no&datalen=${datalen}`;

  // 浏览器态经 /stock-proxy 转发（中间件补 Referer）；Tauri 态 Rust 层直连需自带 Referer
  const response = await proxyFetch(url, {
    headers: { Referer: SINA_REFERER },
  });
  if (!response.ok) {
    throw new Error(`新浪 K 线请求失败：${response.status}`);
  }
  const rawList = parseJsonp(await response.text());

  const bars: KLineData[] = rawList
    .map((raw) => ({
      // 空格为本地时区解析，与 A 股交易日口径一致
      timestamp: dayjs(raw.day.replace(/-/g, '/')).valueOf(),
      open: Number(raw.open),
      high: Number(raw.high),
      low: Number(raw.low),
      close: Number(raw.close),
      volume: Number(raw.volume),
      turnover: Number(raw.amount ?? '0'),
    }))
    .filter((bar) => !Number.isNaN(bar.timestamp) && bar.open > 0);

  // 按交易日截取窗口（1 分钟线上游无法按起始时间取数）
  const dayPrefixes = [
    ...new Set(bars.map((bar) => dayjs(bar.timestamp).format('YYYY-MM-DD'))),
  ].slice(-keepDays);
  const kept = new Set(dayPrefixes);
  const result = bars.filter((bar) => kept.has(dayjs(bar.timestamp).format('YYYY-MM-DD')));

  if (scale === 1) {
    applyAvgPrice(result);
  }
  return result;
};
