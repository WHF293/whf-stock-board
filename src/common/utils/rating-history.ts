import { appStorage } from './app-local-storage';
import { STORAGE_NS_THS_RATING_HISTORY } from '../constants/storage-key.constants.ts';
import { toDayKey } from './to-day-key';

/**
 * 大盘评分历史（按本地日积累，供「近 5 日评分柱」消费）
 *
 * indexflash 接口只有当日值，历史柱靠本地按日落 appStorage：
 * 每日首次拉到评分时写一条 { date, score }，同日重复拉取覆盖更新（盘中分数会变）；
 * 只保留最近 5 条，凑不满 5 天按实有天数画。
 * PC / 移动端共用（common 层，无组件依赖）
 */

/** 单日评分记录 */
export interface RatingHistoryEntry {
  /** 本地日键 YYYY-MM-DD */
  date: string;
  /** 大盘评分（0-10） */
  score: number;
}

/** 保留的最多天数（近 5 日柱） */
const RATING_HISTORY_KEEP = 5;

/**
 * 读取评分历史（升序，最多 5 条）
 * @returns 评分记录列表（无记录为空数组）
 */
export const getRatingHistory = (): RatingHistoryEntry[] => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_THS_RATING_HISTORY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RatingHistoryEntry =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as RatingHistoryEntry).date === 'string' &&
          typeof (item as RatingHistoryEntry).score === 'number',
      )
      .slice(-RATING_HISTORY_KEEP);
  } catch {
    return [];
  }
};

/**
 * 记录当日评分（同日覆盖更新；持久化保留最近 5 条）
 * @param score 当日大盘评分
 * @returns 更新后的历史（升序）
 */
export const recordRatingToday = (score: number): RatingHistoryEntry[] => {
  const date = toDayKey(Date.now());
  const history = getRatingHistory().filter((item) => item.date !== date);
  history.push({ date, score });
  const trimmed = history.slice(-RATING_HISTORY_KEEP);
  try {
    appStorage.setItem(STORAGE_NS_THS_RATING_HISTORY, JSON.stringify(trimmed));
  } catch {
    // 写失败不影响当次展示（下次再积累）
  }
  return trimmed;
};
