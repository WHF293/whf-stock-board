import type { HotNewsItem } from '../../api/news.api';

/**
 * 新闻时间展示（ctime 为秒级 Unix 时间戳字符串）
 *
 * 当天显示 HH:mm，跨天显示 MM-DD HH:mm
 * @param ctime 秒级时间戳字符串（空 / 非法返回空串）
 * @returns 展示文案
 */
export const formatNewsTime = (ctime: string): string => {
  const seconds = Number(ctime);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const date = new Date(seconds * 1000);
  const now = new Date();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (date.toDateString() === now.toDateString()) return `${hh}:${mm}`;
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mo}-${dd} ${hh}:${mm}`;
};

/**
 * 快照时刻展示（HH:mm；空值返回 `--`）
 * @param at 快照生成时刻（毫秒），null 表示从未抓取
 * @returns HH:mm 文案
 */
export const formatSnapshotTime = (at: number | null): string => {
  if (at === null) return '--';
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/**
 * 涨跌幅展示文案（带正负号与百分号；null 返回 `--`）
 * @param pct 涨跌幅百分比
 * @returns 如 `+2.31%` / `-1.05%` / `--`
 */
export const formatPct = (pct: number | null): string => {
  if (pct === null) return '--';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
};

/**
 * 涨跌幅语义类名（红涨绿跌跟随 data-trend 的变量覆盖）
 * @param pct 涨跌幅百分比
 * @returns `m-up` / `m-down` / `m-flat`
 */
export const pctClass = (pct: number | null): string => {
  if (pct === null || pct === 0) return 'm-flat';
  return pct > 0 ? 'm-up' : 'm-down';
};

/**
 * 排名变化展示（↑n / ↓n；null 显示 `—`）
 * @param rankChange 排名变化（正 = 上升）
 * @returns 展示文案
 */
export const formatRankChange = (rankChange: number | null): string => {
  if (rankChange === null || rankChange === 0) return '—';
  return rankChange > 0 ? `↑${rankChange}` : `↓${Math.abs(rankChange)}`;
};

/**
 * 排名变化语义类名
 * @param rankChange 排名变化（正 = 上升）
 * @returns `m-up` / `m-down` / `m-flat`
 */
export const rankChangeClass = (rankChange: number | null): string => {
  if (rankChange === null || rankChange === 0) return 'm-flat';
  return rankChange > 0 ? 'm-up' : 'm-down';
};

/**
 * 榜单排名徽标是否用强调底色（前三名）
 * @param rank 名次（1 起）
 * @returns 是否前三
 */
export const isTopRank = (rank: number): boolean => rank >= 1 && rank <= 3;

/** 静态展示的新闻条目兜底（缓存坏数据时的占位） */
export const EMPTY_NEWS_LIST: readonly HotNewsItem[] = [];
