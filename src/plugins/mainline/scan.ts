/**
 * 插件 dsh-mainline（股票主线）· 扫描编排
 *
 * 一次扫描 = 行业清单页（板块清单 + 当日结构快照）+ 沪深成交额 + 每板块年度日 K
 * + 基准日涨停池 → 统一按**基准交易日**截面落库。
 *
 * 频率红线（AGENTS/SERVER_API 硬性要求）：
 * - 同上游并发 ≤ `MAINLINE_SCAN_CONCURRENCY`（3）；
 * - 同一上游连续请求之间 `delay(MAINLINE_SCAN_DELAY_MS)`；
 * - **只在用户点击时触发**，不进轮询。
 *
 * 增量策略：年 K 文件每次全量重取（90 个板块），与本地已存历史按日期合并去重，
 * 于是「跨年」也自然衔接 —— 去年 12 月的样本留在库里，新一年的数据每次覆盖当年段。
 * 结构字段（涨停/宽度/净流入）只可能落在基准日那一行，合并时**以保留为默认**
 * （年 K 不含这些字段，直接覆盖会把上次采到的结构数据抹掉）。
 */
import { delay } from '../../utils/delay';
import { fetchMarketTurnover } from '../../api/turnover.api';
import { MAINLINE_SCAN_CONCURRENCY, MAINLINE_SCAN_DELAY_MS, MAINLINE_SCAN_RETRY_DELAY_MS } from './constants';
import { resolveBenchmark, trimAfter } from './benchmark';
import { enrichBenchmarkDay, mergeDays, type BenchmarkStructure } from './board-merge';
import { aggregateLimitUp, fetchLimitUpPool } from './limit-up';
import { fetchThsBoardKline, fetchThsBoardPage } from './ths-data';
import type { MainlineRepo } from './storage';
import type {
  BoardSeries,
  LimitUpAggregate,
  MainlineScanMeta,
  MarketTurnoverPoint,
  ThsBoardRef,
  ThsBoardSnapshot,
} from './types';

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
  /** 取数失败的板块代码（保留其本地旧 history，界面照旧展示） */
  failures: readonly string[];
  /** 基准日覆盖率是否降级（未找到覆盖率达标的交易日） */
  degraded: boolean;
  /** 结构指标是否取数失败（未能归属/未能采集） */
  structureFailed: boolean;
  /** 未能归属到板块的涨停行业名（界面提示用） */
  unmappedIndustries: readonly string[];
}

/** 空聚合（涨停池不可用时占位， 为 0 但不会被采用） */
const EMPTY_LIMIT_UP: LimitUpAggregate = {
  byCode: new Map(),
  unmappedCount: 0,
  unmappedIndustries: [],
  total: 0,
};

/**
 * 并发拉取全部板块的年度日 K（带并发上限与同上游间隔）
 *
 * 网关 502 呈「突发簇」分布：整轮跑完等 `MAINLINE_SCAN_RETRY_DELAY_MS` 再对失败板块
 * **补采一轮**（轮内间隔更稀疏），实测自愈率显著更高；两轮都失败才记入 failures。
 * @param refs 板块清单
 * @param year 年份
 * @param existingByCode 本地已有序列（按代码索引，用于增量合并）
 * @param onProgress 进度回调（只按首轮计数；补采轮不再推进进度条）
 * @returns 合并后的序列与失败清单
 */
const fetchAllBoardSeries = async (
  refs: readonly ThsBoardRef[],
  year: number,
  existingByCode: ReadonlyMap<string, BoardSeries>,
  onProgress?: (progress: MainlineScanProgress) => void,
): Promise<{ boards: BoardSeries[]; failures: string[] }> => {
  const results = new Map<string, BoardSeries>();
  const failed = new Set<string>();
  let done = 0;

  const runPass = async (
    passRefs: readonly ThsBoardRef[],
    delayMs: number,
    reportProgress: boolean,
  ): Promise<void> => {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < passRefs.length) {
        const ref = passRefs[cursor];
        cursor += 1;
        try {
          const incoming = await fetchThsBoardKline(ref.code, year);
          const existing = existingByCode.get(ref.code)?.days ?? [];
          results.set(ref.code, {
            code: ref.code,
            name: ref.name,
            days: mergeDays(existing, incoming),
          });
          failed.delete(ref.code);
        } catch (error) {
          // 单个板块失败不中断整轮：代码记进 failed，两轮都失败才由界面提示
          failed.add(ref.code);
          console.warn(`[plugin] dsh-mainline 板块取数失败：${ref.code}`, error);
        }
        done += 1;
        if (reportProgress) onProgress?.({ done, total: refs.length });
        await delay(delayMs);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAINLINE_SCAN_CONCURRENCY, passRefs.length) }, () => worker()),
    );
  };

  await runPass(refs, MAINLINE_SCAN_DELAY_MS, true);
  if (failed.size > 0) {
    const retryRefs = refs.filter((ref) => failed.has(ref.code));
    await delay(MAINLINE_SCAN_RETRY_DELAY_MS);
    await runPass(retryRefs, MAINLINE_SCAN_RETRY_DELAY_MS, false);
  }

  const boards = [...results.values()];
  // 补采仍失败的板块兜底本地旧序列（界面照旧展示，只是数据变旧）
  for (const code of failed) {
    const existing = existingByCode.get(code);
    if (existing) boards.push(existing);
  }
  return { boards, failures: [...failed] };
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
  // 1) 清单页：一次请求给出板块清单 + 当日结构快照（涨跌家数 / 净流入 / 领涨股）
  const page = await fetchThsBoardPage();

  // 2) 沪深两市成交额（成交占比的分母）
  const market: MarketTurnoverPoint[] = (await fetchMarketTurnover()).map((item) => ({
    date: item.date,
    totalAmount: item.totalAmount,
  }));

  // 3) 各板块年度日 K（与本地历史增量合并）
  const existingByCode = new Map(existingBoards.map((series) => [series.code, series]));
  const year = new Date().getFullYear();
  const { boards: fetched, failures } = await fetchAllBoardSeries(
    page.refs,
    year,
    existingByCode,
    onProgress,
  );

  // 4) 基准日：全板块统一口径日；未落定日的半日 bar 一律裁掉（不写进历史）
  const benchmark = resolveBenchmark(fetched, market, new Date());
  const benchmarkDate = benchmark.date;
  const boards = trimAfter(fetched, benchmarkDate);

  // 5) 涨停池取「基准日」的池子（实测 date 参数生效，可回头取近端历史日）
  let limitUp = EMPTY_LIMIT_UP;
  let limitUpOk = false;
  if (benchmarkDate.length > 0) {
    try {
      const pool = await fetchLimitUpPool(benchmarkDate);
      // 空池一律视为取数失败：正常交易日不可能全市场零涨停，
      // 若当作「0 家」会把所有板块的涨停字段静默写成 0（宁可留空并提示）
      if (pool.length > 0) {
        limitUp = aggregateLimitUp(pool, page.refs);
        limitUpOk = true;
      }
    } catch (error) {
      console.warn('[plugin] dsh-mainline 涨停池取数失败', error);
    }
  }

  // 6) 结构富化：清单页是「当前」截面，只有基准日 = 最新交易日且当日未被排除时才同源
  const latestMarketDate = market[market.length - 1]?.date ?? '';
  const snapshotMatches =
    benchmarkDate.length > 0 && benchmark.excludedDate === '' && benchmarkDate === latestMarketDate;
  const structure: BenchmarkStructure = {
    snapshots: snapshotMatches
      ? new Map(page.rows.map((row) => [row.code, row]))
      : new Map<string, ThsBoardSnapshot>(),
    limitUp: limitUpOk ? limitUp.byCode : null,
  };
  const enriched = boards.map((series) => enrichBenchmarkDay(series, benchmarkDate, structure));

  const benchmarkMarket = market.find((point) => point.date === benchmarkDate) ?? null;
  const meta: MainlineScanMeta = {
    scannedAt: Date.now(),
    asOf: benchmarkDate,
    boardCount: enriched.length,
    coverage: benchmark.coverage,
    degraded: benchmark.degraded,
    excludedDate: benchmark.excludedDate,
    marketAmount: benchmarkMarket ? benchmarkMarket.totalAmount : null,
    limitUpTotal: limitUpOk ? limitUp.total : null,
    limitUpUnmapped: limitUpOk ? limitUp.unmappedCount : null,
    structureReady: snapshotMatches || limitUpOk,
  };

  await repo.saveScan(enriched, market, meta);
  return {
    boards: enriched,
    market,
    meta,
    failures,
    degraded: benchmark.degraded,
    structureFailed: !snapshotMatches || !limitUpOk,
    unmappedIndustries: limitUp.unmappedIndustries,
  };
};
