/**
 * 插件 dsh-mainline（股票主线）· 取数层
 *
 * 两个纯解析函数（`parseBoardListHtml` / `parseKlineJsonp`）+ 两个 fetch 包装：
 * 解析全部收在纯函数里，冒烟测试可直接喂固定文本断言（不联网）。
 *
 * 数据源与编码（实测）：
 * - 清单页 `q.10jqka.com.cn/thshy/` 是 **GBK** HTML，链接形如
 *   `…/thshy/detail/code/881121/`；必须按 GBK 解码，否则板块名全是乱码。
 * - 板块年 K `d.10jqka.com.cn/v6/line/48_<code>/01/<year>.js` 是 JSONP 文
 *   `quotebridge_v6_line_48_881121_01_2026({"data":"日期,开,高,低,收,量,额,…;…"})`，
 *   行内字段序为 `日期,开,高,低,收,成交量(股),成交额(元),…`。
 * - 两处都要带同花顺 Referer；请求统一经 `proxyFetch`（Tauri 走 Rust 直连 /
 *   浏览器走同源 `/stock-proxy`，域名 `10jqka.com.cn` 已在白名单内）。
 */
import { proxyFetch } from '../../api/proxy-fetch';
import {
  THS_BOARD_KLINE_ADJUST_FALLBACK,
  THS_BOARD_KLINE_ADJUST_PRIMARY,
  THS_BOARD_KLINE_URL_BASE,
  THS_BOARD_KLINE_URL_MIDDLE,
  THS_BOARD_KLINE_YEAR_FALLBACK,
  THS_BOARD_LIST_URL,
  THS_INDUSTRY_CODE_PREFIX,
  THS_REFERER,
} from './constants';
import type { BoardDaily, ThsBoardRef } from './types';

/** 清单页里板块链接的代码提取（`detail/code/<6 位数字>/`） */
const BOARD_LIST_CODE_PATTERN = /\/thshy\/detail\/code\/(\d{6})\//g;

/** 清单页里 `…/detail/code/881121/" … >半导体</a>` 的名称提取 */
const BOARD_LIST_ANCHOR_PATTERN =
  /href="[^"]*\/thshy\/detail\/code\/(\d{6})\/"[^>]*>([^<]{1,20})<\/a>/g;

/** 年 K 行内字段下标（0 起）：日期 / 开 / 高 / 低 / 收 / 成交量 / 成交额 */
const KLINE_FIELD = {
  DATE: 0,
  OPEN: 1,
  HIGH: 2,
  LOW: 3,
  CLOSE: 4,
  VOLUME: 5,
  AMOUNT: 6,
} as const;

/** 年 K 行的最少字段数（少于 7 段视为脏行丢弃） */
const KLINE_MIN_FIELDS = 7;

/** 年 K 日期字段形态：YYYYMMDD */
const KLINE_DATE_LENGTH = 8;

/** 一日涨跌幅计算基数（百分比） */
const PERCENT_SCALE = 100;

/**
 * 按 GBK 解码响应体（同花顺清单页为 GBK；Node 侧无 TextDecoder('gbk') 时退回 UTF-8）
 * @param buffer 响应原始字节
 * @returns 解码后的文本
 */
export const decodeGbk = (buffer: ArrayBuffer): string => {
  try {
    return new TextDecoder('gbk').decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
};

/**
 * 解析同花顺行业板块清单 HTML（纯函数）
 *
 * 同一板块会在页面里出现多次（字母分组导航 + 内容区），按代码去重后返回。
 * 只保留 88 开头（行业板块）的代码，概念板块（885xxx / 30xxxx）不在本期范围。
 * @param html 清单页 HTML 文本（已按 GBK 解码）
 * @returns 板块清单（按页面出现顺序去重）
 */
export const parseBoardListHtml = (html: string): ThsBoardRef[] => {
  const seen = new Set<string>();
  const boards: ThsBoardRef[] = [];

  for (const match of html.matchAll(BOARD_LIST_ANCHOR_PATTERN)) {
    const code = match[1];
    const name = match[2].trim();
    if (!code.startsWith(THS_INDUSTRY_CODE_PREFIX) || !name || seen.has(code)) {
      continue;
    }
    seen.add(code);
    boards.push({ code, name });
  }

  // 兜底：锚点文本缺失时，至少保证代码清单可用（名称以代码占位）
  if (boards.length === 0) {
    for (const match of html.matchAll(BOARD_LIST_CODE_PATTERN)) {
      const code = match[1];
      if (!code.startsWith(THS_INDUSTRY_CODE_PREFIX) || seen.has(code)) continue;
      seen.add(code);
      boards.push({ code, name: code });
    }
  }

  return boards;
};

/**
 * 解析同花顺板块年 K 的 JSONP 文本（纯函数）
 *
 * 涨跌幅不取接口字段（该接口里为空），一律由**相邻收盘价比值**算出，
 * 首日无前收 → 涨跌幅记 0，避免污染累计涨幅。
 * @param text 年 K JSONP 文本
 * @returns 逐日行情（升序）；空数据返回空数组
 */
export const parseKlineJsonp = (text: string): BoardDaily[] => {
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end <= start) return [];

  let payload: { data?: unknown };
  try {
    payload = JSON.parse(text.slice(start + 1, end)) as { data?: unknown };
  } catch {
    return [];
  }
  if (typeof payload.data !== 'string' || payload.data.length === 0) return [];

  const days: BoardDaily[] = [];
  let previousClose: number | null = null;

  for (const row of payload.data.split(';')) {
    const fields = row.split(',');
    if (fields.length < KLINE_MIN_FIELDS) continue;

    const rawDate = fields[KLINE_FIELD.DATE];
    const close = Number(fields[KLINE_FIELD.CLOSE]);
    const amount = Number(fields[KLINE_FIELD.AMOUNT]);
    if (rawDate.length !== KLINE_DATE_LENGTH || !Number.isFinite(close) || close <= 0) continue;

    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    const changePercent =
      previousClose !== null && previousClose > 0
        ? ((close - previousClose) / previousClose) * PERCENT_SCALE
        : 0;
    previousClose = close;

    days.push({
      date,
      close,
      changePercent,
      amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    });
  }

  return days;
};

/**
 * 拉取同花顺行业板块清单
 * @returns 板块清单（约 90 个行业板块）
 */
export const fetchThsBoardList = async (): Promise<ThsBoardRef[]> => {
  const response = await proxyFetch(THS_BOARD_LIST_URL, {
    headers: { Referer: THS_REFERER },
  });
  if (!response.ok) {
    throw new Error(`同花顺板块清单 HTTP ${response.status}`);
  }
  const boards = parseBoardListHtml(decodeGbk(await response.arrayBuffer()));
  if (boards.length === 0) {
    throw new Error('同花顺板块清单解析为空');
  }
  return boards;
};

/**
 * 拉取单个板块的年度日 K（同花顺）
 *
 * 回退链：当年 前复权 → 当年 不复权 → 去年 前复权 → 去年 不复权，
 * 首个解析出行的胜出（`01` / `00` 各自都有取不到的板块，实测见 constants 注释）。
 * @param code 板块代码（88xxxx）
 * @param year 年份（如 2026）
 * @returns 逐日行情（升序）；全部候选都取不到时抛错
 */
export const fetchThsBoardKline = async (code: string, year: number): Promise<BoardDaily[]> => {
  const candidates: { year: number; adjust: string }[] = [
    { year, adjust: THS_BOARD_KLINE_ADJUST_PRIMARY },
    { year, adjust: THS_BOARD_KLINE_ADJUST_FALLBACK },
  ];
  for (let back = 1; back <= THS_BOARD_KLINE_YEAR_FALLBACK; back += 1) {
    candidates.push(
      { year: year - back, adjust: THS_BOARD_KLINE_ADJUST_PRIMARY },
      { year: year - back, adjust: THS_BOARD_KLINE_ADJUST_FALLBACK },
    );
  }

  let lastError = '';
  for (const candidate of candidates) {
    const url = `${THS_BOARD_KLINE_URL_BASE}${code}${THS_BOARD_KLINE_URL_MIDDLE}${candidate.adjust}/${candidate.year}.js`;
    try {
      const response = await proxyFetch(url, { headers: { Referer: THS_REFERER } });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const days = parseKlineJsonp(decodeGbk(await response.arrayBuffer()));
      if (days.length > 0) return days;
      lastError = '空数据';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`同花顺板块日K不可用：${code}（${lastError}）`);
};
