/**
 * 历史牛熊（移动端）· 取数与回算
 *
 * 数据与判定逻辑复用 PC 单源模块（panorama-review 的 history-data / judge / rounds / bears，
 * 均为纯 TS，无桌面 UI 依赖——移动端只写渲染层，PC 端零改动）：
 * - 月K：新浪源 monthly 一次拉全历史（fetchIndexMonthlyBars，串行 500ms 错峰）；
 * - 缓存：appStorage 持久快照（syncedAt + 各指数月K），进入页面读缓存秒出、
 *   「更新到最新」手动强制重拉；不做自动过期（月K 低频，官方口径为手动补最新）。
 * - 统计：buildRoundStats / buildBearStats 从月K回算，页面所有数字的来源。
 */
import { appStorage } from '../../common/utils/app-local-storage';
import { STORAGE_NS_MOBILE_BULL_REVIEW } from '../../common/constants/storage-key.constants';
import { fetchAllIndexMonthlies } from '../../pc/components/business/panorama-review/history-data';
import { buildBearStats, buildRoundStats } from '../../pc/components/business/panorama-review/judge';
import { BULL_ROUNDS } from '../../pc/components/business/panorama-review/rounds';
import { BEAR_ROUNDS } from '../../pc/components/business/panorama-review/bears';
import type { MonthlyBar } from '../../pc/components/business/panorama-review/types';
import type { ReviewBearStats, ReviewRoundStats } from '../../pc/components/business/panorama-review/types';

/** 月K快照的持久化形态 */
interface BullReviewSnapshot {
  syncedAt: number;
  bars: Record<string, MonthlyBar[]>;
}

/** 装载结果：同步时间 + 各轮统计（数据不足的轮次缺项）+ 各指数月K（阶段色带绘图用） */
export interface BullReviewData {
  syncedAt: number;
  bullStats: Record<string, ReviewRoundStats>;
  bearStats: Record<string, ReviewBearStats>;
  /** 指数符号 → 全量月K（升序）；色带图消费 */
  bars: Record<string, MonthlyBar[]>;
}

const SNAPSHOT_KEY = STORAGE_NS_MOBILE_BULL_REVIEW;

/**
 * 读持久化月K快照（坏包静默回落空）
 * @returns 快照；无缓存为 null
 */
function readSnapshot(): BullReviewSnapshot | null {
  try {
    const raw = appStorage.getItem(SNAPSHOT_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<BullReviewSnapshot>;
    if (typeof parsed.syncedAt !== 'number' || !parsed.bars) return null;
    return parsed as BullReviewSnapshot;
  } catch {
    return null;
  }
}

/**
 * 由月K快照回算全部轮次统计
 * @param snapshot 月K快照
 * @returns 装载结果（bullStats / bearStats 按 roundId 索引）
 */
function computeStats(snapshot: BullReviewSnapshot): BullReviewData {
  const bullStats: Record<string, ReviewRoundStats> = {};
  for (const round of BULL_ROUNDS) {
    const bars = snapshot.bars[round.indexSymbol];
    if (!bars) continue;
    const stats = buildRoundStats(bars, round);
    if (stats) bullStats[round.id] = stats;
  }
  const bearStats: Record<string, ReviewBearStats> = {};
  for (const round of BEAR_ROUNDS) {
    const bars = snapshot.bars[round.indexSymbol];
    if (!bars) continue;
    const stats = buildBearStats(bars, round);
    if (stats) bearStats[round.id] = stats;
  }
  return { syncedAt: snapshot.syncedAt, bullStats, bearStats, bars: snapshot.bars };
}

/**
 * 装载历史牛熊数据（缓存优先；首次无缓存自动同步全部指数月K）
 * @param options 拉取选项
 * @param options.force 为 true 时强制重拉全部指数月K（「更新到最新」）
 * @returns 装载结果；fromCache 标识是否来自本地缓存；拉取失败且无缓存时抛错
 */
export async function loadBullReview(options?: { force?: boolean }): Promise<BullReviewData & { fromCache: boolean }> {
  if (!options?.force) {
    const cached = readSnapshot();
    if (cached) return { ...computeStats(cached), fromCache: true };
  }
  const bars = await fetchAllIndexMonthlies();
  const snapshot: BullReviewSnapshot = { syncedAt: Date.now(), bars };
  try {
    appStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // 持久化失败不阻塞（本次会话仍可用）
  }
  return { ...computeStats(snapshot), fromCache: false };
}
