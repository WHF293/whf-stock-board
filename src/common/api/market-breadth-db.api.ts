/**
 * 市场宽度本地积累库（appStorage 持久化，浏览器 / Tauri 同构）
 *
 * 历史无免费上游源（见 .ai/开发方案/2026-10-21-市场宽度与ARMS曲线开发方案.md §0），
 * 日线由本地按日落库自积累：
 * - 分钟点：每轮全市场快照 ingest 一点（同分钟去重），按日滚存最近 3 日；
 * - 日 bar：快照行情时间 ≥ 15:00 视为收盘定稿，用当日最后一个分钟点聚合
 *   upsert 落库（幂等），滚存 250 日；周末/节假日打开页面时行情时间落在
 *   最近交易日，同样触发该日定稿，天然补齐断档。
 *
 * appStorage 为「单 key 整包 + 合并回写」，分钟点写入做 60s 节流
 * （bar 定稿时强制写，避免丢当日序列）。
 */
import dayjs from 'dayjs';
import {
  BREADTH_BAR_CLOSE_MINUTE,
  BREADTH_BAR_KEEP_DAYS,
  BREADTH_DAY_SERIES_KEEP_DAYS,
  BREADTH_PERSIST_THROTTLE_MS,
} from '../constants/market-breadth.constants.ts';
import {
  STORAGE_NS_MARKET_BREADTH_BARS,
  STORAGE_NS_MARKET_BREADTH_DAYS,
} from '../constants/storage-key.constants.ts';
import type { BreadthDayBar, BreadthPoint, MarketBreadth } from '../types/market-breadth.types.ts';
import type { FullQuote } from '../types/stock-quote.types.ts';
import { appendBreadthPoint } from '../utils/append-breadth-point';
import { appStorage } from '../utils/app-local-storage';
import { computeMarketBreadth } from '../utils/compute-market-breadth';
import { toDayKey } from '../utils/to-day-key';

/** 分钟点按日序列集合（date → 升序点列） */
type BreadthDayMap = Record<string, BreadthPoint[]>;

/** 上次分钟点落盘时刻（节流用，模块级） */
let lastPersistAt = 0;

/**
 * 解析 JSON 数组并做结构校验（坏包返回 null，由调用方按空处理）
 * @param raw appStorage 原始串
 * @returns 解析结果；缺失/坏包为 null
 */
const parseJson = <T>(raw: string | null): T | null => {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/**
 * 读取分钟点按日序列集合（坏包静默回落空表）
 * @returns date → BreadthPoint[] 映射
 */
const readDayMap = (): BreadthDayMap => {
  const parsed = parseJson<BreadthDayMap>(appStorage.getItem(STORAGE_NS_MARKET_BREADTH_DAYS));
  if (parsed === null || typeof parsed !== 'object') return {};
  const map: BreadthDayMap = {};
  for (const [date, points] of Object.entries(parsed)) {
    if (Array.isArray(points)) map[date] = points;
  }
  return map;
};

/**
 * 读取日 bar 序列（升序；坏行剔除）
 * @returns 日 bar 列表（日期升序）
 */
export const readBreadthBars = (): BreadthDayBar[] =>
  (parseJson<BreadthDayBar[]>(appStorage.getItem(STORAGE_NS_MARKET_BREADTH_BARS)) ?? []).filter(
    (bar): bar is BreadthDayBar =>
      typeof bar?.date === 'string' &&
      typeof bar.upCount === 'number' &&
      typeof bar.downCount === 'number',
  );

/**
 * 读取指定交易日的分钟点序列
 * @param date 本地日键 YYYY-MM-DD
 * @returns 升序分钟点（无记录为空数组）
 */
export const readBreadthDay = (date: string): BreadthPoint[] => readDayMap()[date] ?? [];

/**
 * 判断一分钟点是否已收盘定稿（本地时区分钟数 ≥ 15:00）
 * @param point 分钟点
 * @returns 是否收盘定稿
 */
const isPointClosed = (point: BreadthPoint): boolean => {
  const time = dayjs(point.time);
  return time.hour() * 60 + time.minute() >= BREADTH_BAR_CLOSE_MINUTE;
};

/**
 * 分钟点 → 日 bar（取点列最后一点的统计）
 * @param date 本地日键
 * @param point 收盘分钟点
 * @returns 日 bar
 */
const toBar = (date: string, point: BreadthPoint): BreadthDayBar => ({
  date,
  upCount: point.upCount,
  downCount: point.downCount,
  upVol: point.upVol,
  downVol: point.downVol,
  arms: point.arms,
});

/**
 * 日 bar 是否与既有记录一致（幂等判定，避免无意义回写）
 * @param a bar A
 * @param b bar B
 * @returns 统计字段是否完全一致
 */
const isSameBar = (a: BreadthDayBar, b: BreadthDayBar): boolean =>
  a.upCount === b.upCount &&
  a.downCount === b.downCount &&
  a.upVol === b.upVol &&
  a.downVol === b.downVol &&
  a.arms === b.arms;

/**
 * 消化一轮全市场快照：计算宽度统计 + 积累分钟点 + 收盘定稿日 bar
 *
 * PC / 移动端轮询到快照后各调一次（同一时刻两端各记一份，互不冲突，后写覆盖同值）。
 * 行情时间不在本地的周末/节假日，只算不落分钟点，但会触发最近交易日的 bar 定稿。
 * @param quotes 全市场完整报价列表
 * @returns 当轮市场宽度统计（供 UI 直接消费）
 */
export const ingestBreadthSnapshot = (quotes: readonly FullQuote[]): MarketBreadth => {
  const breadth = computeMarketBreadth(quotes);

  // 行情时间取快照最大时间戳（缺省回退当前时间）
  let quoteTs = 0;
  for (const quote of quotes) {
    if (quote.timestamp !== null && quote.timestamp > quoteTs) quoteTs = quote.timestamp;
  }
  if (quoteTs === 0) quoteTs = Date.now();
  const quoteDay = toDayKey(quoteTs);
  const today = toDayKey(Date.now());

  const dayMap = readDayMap();
  if (quoteDay === today) {
    const point: BreadthPoint = {
      time: Math.floor(quoteTs / 60_000) * 60_000,
      upCount: breadth.upCount,
      downCount: breadth.downCount,
      flatCount: breadth.flatCount,
      upVol: breadth.upVol,
      downVol: breadth.downVol,
      arms: breadth.arms,
    };
    dayMap[today] = appendBreadthPoint(dayMap[today] ?? [], point);
    // 滚存最近 N 日（bar 落库后旧分时无用）
    const dates = Object.keys(dayMap).sort();
    while (dates.length > BREADTH_DAY_SERIES_KEEP_DAYS) {
      const stale = dates.shift();
      if (stale !== undefined) delete dayMap[stale];
    }
  }

  // 收盘定稿：所有已存日期里「最后一点 ≥ 15:00」的都 upsert 日 bar（幂等）
  const bars = readBreadthBars();
  let barsDirty = false;
  for (const [date, points] of Object.entries(dayMap)) {
    const last = points.at(-1);
    if (!last || !isPointClosed(last)) continue;
    const bar = toBar(date, last);
    const index = bars.findIndex((item) => item.date === date);
    if (index >= 0) {
      if (!isSameBar(bars[index]!, bar)) {
        bars[index] = bar;
        barsDirty = true;
      }
    } else {
      bars.push(bar);
      barsDirty = true;
    }
  }
  if (barsDirty) {
    bars.sort((a, b) => a.date.localeCompare(b.date));
    appStorage.setItem(STORAGE_NS_MARKET_BREADTH_BARS, JSON.stringify(bars.slice(-BREADTH_BAR_KEEP_DAYS)));
  }

  // 分钟点节流落盘（bar 定稿时强制写，避免当日序列丢失）
  const now = Date.now();
  if (barsDirty || now - lastPersistAt >= BREADTH_PERSIST_THROTTLE_MS) {
    lastPersistAt = now;
    appStorage.setItem(STORAGE_NS_MARKET_BREADTH_DAYS, JSON.stringify(dayMap));
  }
  return breadth;
};
