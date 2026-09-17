/**
 * 插件 dsh-mainline（股票主线）· 扫描编排
 *
 * 一次扫描 = 板块清单 + 沪深成交额 + 每板块年度日 K（合并进本地历史）→ 落库。
 *
 * 频率红线（AGENTS/SERVER_API 硬性要求）：
 * - 同上游并发 ≤ `MAINLINE_SCAN_CONCURRENCY`（3）；
 * - 同一上游连续请求之间 `delay(MAINLINE_SCAN_DELAY_MS)`；
 * - **只在用户点击时触发**，不进轮询。
 *
 * 增量策略：年 K 文件每次全量重取（90 个板块），与本地已存历史按日期合并去重，
 * 于是「跨年」也自然衔接 —— 去年 12 月的样本留在库里，新一年的数据每次覆盖当年段。
 */
import { delay } from '../../utils/delay';
import { fetchMarketTurnover } from '../../api/turnover.api';
import { MAINLINE_SCAN_CONCURRENCY, MAINLINE_SCAN_DELAY_MS } from './constants';
import { fetchThsBoardKline, fetchThsBoardList } from './ths-data';
import type { MainlineRepo } from './storage';
import type { BoardDaily, BoardSeries, MainlineScanMeta, MarketTurnoverPoint } from './types';

/** 扫描进度回调载荷 */
export interface MainlineScanProgress {
  /** 已完成板块数 */
  done: number;
  /** 板块总数 */
  total: number;
}

/** 扫描结果 */
export interface MainlineScanResult {
  /** 落库后的主板序列 */
  boards: BoardSeries[];
  /** 沪深成交额序列 */
  market: MarketTurnoverPoint[];
  /** 扫描元信息 */
  meta: MainlineScanMeta;
  /** 取数失败的板块代码（保留其本地旧history，界面照旧展示） */
  failures: readonly string[];
}

/**
 * 合并新旧日线序列（按日期去重，新数据覆盖旧数据，升序返回）
 * @param existing 本地已有序列
 * @param incoming 本次拉取序列
 * @returns 合并后的序列
 */
export const mergeDays = (
  existing: readonly BoardDaily[],
  incoming: readonly BoardDaily[],
): BoardDaily[] => {
  const merged = new Map<string, BoardDaily>();
  for (const day of existing) merged.set(day.date, day);
  for (const day of incoming) merged.set(day.date, day);
  return [...merged.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
};

/**
 * 取一组日期里出现次数最多的日期（用于「数据截止日」）
 * @param dates 日期数组
 * @returns 众数日期；空数组返回空串
 */
export const resolveAsOf = (dates: readonly string[]): string => {
  const counter = new Map<string, number>();
  let best = '';
  let bestCount = 0;
  for (const date of dates) {
    if (!date) continue;
    const next = (counter.get(date) ?? 0) + 1;
    counter.set(date, next);
    if (next > bestCount) {
      best = date;
      bestCount = next;
    }
  }
  return best;
};

/**
 * 并发拉取全部板块的年度日 K（带并发上限与同上游间隔）
 * @param refs 板块清单
 * @param year 年份
 * @param existingByCode 本地已有序列（按代码索引，用于增量合并）
 * @param onProgress 进度回调
 * @returns 合并后的序列与失败清单
 */
const fetchAllBoardSeries = async (
  refs: readonly { code: string; name: string }[],
  year: number,
  existingByCode: ReadonlyMap<string, BoardSeries>,
  onProgress?: (progress: MainlineScanProgress) => void,
): Promise<{ boards: BoardSeries[]; failures: string[] }> => {
  const boards: BoardSeries[] = [];
  const failures: string[] = [];
  let cursor = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    while (cursor < refs.length) {
      const ref = refs[cursor];
      cursor += 1;
      try {
        const incoming = await fetchThsBoardKline(ref.code, year);
        const existing = existingByCode.get(ref.code)?.days ?? [];
        boards.push({ code: ref.code, name: ref.name, days: mergeDays(existing, incoming) });
      } catch (error) {
        // 单个板块失败不中断整轮：保留本地旧序列，代码记进 failures 由界面提示
        failures.push(ref.code);
        const existing = existingByCode.get(ref.code);
        if (existing) boards.push(existing);
        console.warn(`[plugin] dsh-mainline 板块取数失败：${ref.code}`, error);
      }
      done += 1;
      onProgress?.({ done, total: refs.length });
      await delay(MAINLINE_SCAN_DELAY_MS);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAINLINE_SCAN_CONCURRENCY, refs.length) }, () => worker()),
  );
  return { boards, failures };
};

/**
 * 执行一次主线扫描并落库
 * @param repo 快照仓储
 * @param existingBoards 当前本地板块序列（增量合并基础）
 * @param onProgress 进度回调
 * @returns 扫描结果
 */
export const runMainlineScan = async (
  repo: MainlineRepo,
  existingBoards: readonly BoardSeries[],
  onProgress?: (progress: MainlineScanProgress) => void,
): Promise<MainlineScanResult> => {
  const refs = await fetchThsBoardList();
  const market: MarketTurnoverPoint[] = (await fetchMarketTurnover()).map((item) => ({
    date: item.date,
    totalAmount: item.totalAmount,
  }));

  const existingByCode = new Map(existingBoards.map((series) => [series.code, series]));
  const year = new Date().getFullYear();
  const { boards, failures } = await fetchAllBoardSeries(refs, year, existingByCode, onProgress);

  const asOf = resolveAsOf(boards.map((series) => series.days[series.days.length - 1]?.date ?? ''));
  const latestMarket = market[market.length - 1] ?? null;
  const meta: MainlineScanMeta = {
    scannedAt: Date.now(),
    asOf,
    boardCount: boards.length,
    marketAmount: latestMarket ? latestMarket.totalAmount : null,
  };

  await repo.saveScan(boards, market, meta);
  return { boards, market, meta, failures };
};
