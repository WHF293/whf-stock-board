import dayjs from 'dayjs';
import { proxyFetch } from './proxy-fetch.ts';
import {
  CCPM_CACHE_TTL_MS,
  CCPM_CSV_URL_TEMPLATE,
  CCPM_FETCH_CONCURRENCY,
  CCPM_SERIES_DAYS,
  CCPM_SERIES_MAX_PROBE_DAYS,
} from '../constants/futures.constants.ts';
import type {
  CcpmMemberSeries,
  CcpmMemberDayPoint,
  CcpmProductDayData,
} from '../types/futures.types.ts';
import { parseCcpmCsv } from '../utils/parse-ccpm-csv.ts';
import { aggregateCcpmByMember } from '../utils/ccpm-compute.ts';
import { mapWithConcurrency } from '../utils/map-with-concurrency.ts';
import { readCcpmDayCache, writeCcpmDayCache } from './futures-db.api.ts';

/**
 * 中金所 CCPM 数据接口层
 *
 * 上游：`http://www.cffex.com.cn/sj/ccpm/{yyyymm}/{dd}/{product}_1.csv`（GBK 编码，
 * 静态文件，非披露日 302 到错误页）。通道走 proxy-fetch 体系：
 * 浏览器经 /stock-proxy 转发（白名单含 www.cffex.com.cn），Tauri Rust 直连。
 * 响应体按原始字节读入后 TextDecoder('gbk') 解码——上游为 GBK，任何按 UTF-8
 * 的解码都会中文乱码。
 */

/** 会话内缓存条目（TTL 内直接命中，避免重复拉同一披露文件） */
interface CcpmCacheEntry {
  /** 写入时刻（毫秒时间戳） */
  at: number;
  /** 拉取结果（null = 非披露日 / 无数据，负缓存同样生效） */
  data: CcpmProductDayData | null;
}

/** 会话内数据缓存（key = product|yyyyMMdd） */
const dayCache = new Map<string, CcpmCacheEntry>();

/**
 * 读 SQLite 持久缓存并判定是否可用
 *
 * 正缓存（披露日定稿数据）永久有效；负缓存按 TTL 过期（当天盘后披露时点
 * 前后都会探测同一天）。库不可用 / 无记录 / 负缓存过期统一返回 null。
 * @param product 品种代码
 * @param day 交易日 yyyyMMdd
 * @returns 可用缓存数据；null = 无可用缓存（回源）
 */
const readPersistentCache = async (product: string, day: string): Promise<CcpmProductDayData | null | undefined> => {
  const record = await readCcpmDayCache(product, day).catch(() => null);
  if (!record) {
    return undefined;
  }
  if (record.data !== null) {
    return record.data;
  }
  return Date.now() - record.fetchedAt < CCPM_CACHE_TTL_MS ? null : undefined;
};

/**
 * 构造上游 CSV 地址
 * @param product 品种代码
 * @param day 交易日 yyyyMMdd
 * @returns 完整 URL
 */
const buildCcpmUrl = (product: string, day: string): string =>
  CCPM_CSV_URL_TEMPLATE.replace('{yyyymm}', day.slice(0, 6)).replace('{dd}', day.slice(6, 8))
    .replace('{product}', product);

/**
 * 拉取并解析某品种某披露日的 CCPM 数据（带会话缓存）
 * @param product 品种代码（IF / IH / IC / IM / T / TF / TS / TL）
 * @param day 交易日 yyyyMMdd
 * @param forceRefresh 跳过缓存强制回源（手动刷新用）
 * @returns 品种单日数据；非披露日 / 上游异常返回 null
 */
export const fetchCcpmProductDay = async (
  product: string,
  day: string,
  forceRefresh = false,
): Promise<CcpmProductDayData | null> => {
  const cacheKey = `${product}|${day}`;
  const cached = dayCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.at < CCPM_CACHE_TTL_MS) {
    return cached.data;
  }

  // SQLite 持久层（仅 Tauri；重启 / 回看历史不走网络）。正缓存永久有效，
  // 负缓存 TTL 内命中 —— 两者都直接回填会话缓存返回
  if (!forceRefresh) {
    const persisted = await readPersistentCache(product, day);
    if (persisted !== undefined) {
      dayCache.set(cacheKey, { at: Date.now(), data: persisted });
      return persisted;
    }
  }

  let data: CcpmProductDayData | null = null;
  // 是否真正触达上游（区分「上游明确无披露」可落负缓存 与 「网络异常」不可落库）
  let reached = false;
  try {
    const response = await proxyFetch(buildCcpmUrl(product, day), {
      headers: { Accept: 'text/csv,*/*' },
    });
    reached = true;
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      const text = new TextDecoder('gbk').decode(buffer);
      data = parseCcpmCsv(text, product);
    }
  } catch {
    // 网络 / 上游异常按「无数据」处理，由调用方走空态 + 重试
    data = null;
  }

  const at = Date.now();
  dayCache.set(cacheKey, { at, data });
  // 写透持久层：仅触达上游的结果才落库（网络异常不污染负缓存，下次启动仍会重试）
  if (reached) {
    void writeCcpmDayCache({ product, tradingDay: day, data, fetchedAt: at }).catch(
      () => undefined,
    );
  }
  return data;
};

/**
 * 从某天起向前探测最近一个有披露的交易日（跳过周末；节假日按无数据自然跳过）
 * @param product 品种代码
 * @param fromDay 起始日 yyyyMMdd（含当天）
 * @param maxProbeDays 最多向前探测的自然日数
 * @returns 最近披露日（yyyyMMdd）及其数据；窗口内全无数据时返回 null
 */
export const findLatestCcpmDay = async (
  product: string,
  fromDay: string,
  maxProbeDays = CCPM_SERIES_MAX_PROBE_DAYS,
): Promise<{ day: string; data: CcpmProductDayData } | null> => {
  let cursor = dayjs(fromDay, 'YYYYMMDD');
  for (let i = 0; i < maxProbeDays; i += 1) {
    const day = cursor.format('YYYYMMDD');
    const data = await fetchCcpmProductDay(product, day);
    if (data) {
      return { day, data };
    }
    cursor = cursor.subtract(1, 'day');
  }
  return null;
};

/**
 * 席位合并净持仓时序：向前找最近 N 个披露日，逐日拉取并按会员聚合
 *
 * 逐日探测以「最近披露日」为锚点回退，非披露日自动跳过；任一日聚合结果
 * 都带 coveredCount / totalCount，前端据此渲染「部分头寸」提示。
 *
 * @param memberName 席位（会员）名称，如 `中信期货(代客)`
 * @param products 参与聚合的品种列表（同品种传单元素数组；全股指传四个股指）
 * @param endDay 锚点交易日 yyyyMMdd（含）
 * @param days 回看披露日数量
 * @returns 时序数据（点列按交易日升序）；一个披露日都拉不到时 points 为空
 */
export const fetchCcpmMemberSeries = async (
  memberName: string,
  products: readonly string[],
  endDay: string,
  days = CCPM_SERIES_DAYS,
): Promise<CcpmMemberSeries> => {
  // 以第一个品种为日历锚点探测披露日序列（各品种披露日历一致）
  const anchor = await findLatestCcpmDay(products[0] ?? 'IF', endDay);
  if (!anchor) {
    return { memberName, products, points: [] };
  }

  // 从锚点继续向前收齐 days 个披露日（同一次探测循环，复用已拉数据）
  const dayList: string[] = [anchor.day];
  let cursor = dayjs(anchor.day, 'YYYYMMDD').subtract(1, 'day');
  let probed = 1;
  while (dayList.length < days && probed < CCPM_SERIES_MAX_PROBE_DAYS) {
    const day = cursor.format('YYYYMMDD');
    const data = await fetchCcpmProductDay(products[0] ?? 'IF', day);
    if (data) {
      dayList.push(day);
    }
    cursor = cursor.subtract(1, 'day');
    probed += 1;
  }

  // 逐披露日 × 逐品种拉取后按会员聚合（并发受限，避免对上游突发压力）
  const perDay = await mapWithConcurrency(
    dayList,
    async (day) => {
      const dayDataList = await mapWithConcurrency(
        products,
        (product) => fetchCcpmProductDay(product, day),
        { concurrency: CCPM_FETCH_CONCURRENCY },
      );
      const valid = dayDataList.filter((item): item is CcpmProductDayData => item !== null);
      const aggregated = aggregateCcpmByMember(valid, memberName);
      const point: CcpmMemberDayPoint | null = aggregated[0]
        ? {
            tradingDay: day,
            totalBuy: aggregated[0].totalBuy,
            totalSell: aggregated[0].totalSell,
            totalNet: aggregated[0].totalNet,
            totalNetChg: aggregated[0].totalNetChg,
            coveredCount: aggregated[0].coveredCount,
            totalCount: aggregated[0].totalCount,
          }
        : null;
      return point;
    },
    { concurrency: CCPM_FETCH_CONCURRENCY },
  );

  const points = perDay
    .filter((point): point is CcpmMemberDayPoint => point !== null)
    .sort((a, b) => a.tradingDay.localeCompare(b.tradingDay));
  return { memberName, products, points };
};
