/**
 * 连续活跃天数计算（使用统计看板）
 *
 * 输入是有活动的本地日键集合（`YYYY-MM-DD`）与今天的日键，输出当前连续
 * 与历史最长。日差计算按公历日走（Date.UTC 毫秒差 ÷ 一天），不涉时区与
 * 夏令时；`YYYY-MM-DD` 的字典序即时间序，直接排序后扫描。
 */

/** 连续天数统计结果 */
export interface UsageStreaks {
  /** 当前连续天数：今天有活动从今天起算，否则从昨天起算（今天还没用不断签） */
  current: number;
  /** 历史最长连续天数 */
  longest: number;
}

/** 一天的毫秒数（公历日差值口径，忽略闰秒） */
const DAY_MS = 86_400_000;

/**
 * 日键 → UTC 毫秒（仅用于算两个日期相差几天）
 * @param key `YYYY-MM-DD` 日键
 * @returns UTC 零点毫秒时间戳
 */
const dayKeyToUtc = (key: string): number => {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
};

/**
 * UTC 毫秒 → 日键（dayKeyToUtc 的逆运算）
 * @param utcMs UTC 零点毫秒时间戳
 * @returns `YYYY-MM-DD` 日键
 */
const utcToDayKey = (utcMs: number): string => {
  const date = new Date(utcMs);
  /**
   * 两位补零
   * @param n 月 / 日数值
   * @returns 两位字符串（如 `07`）
   */
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/**
 * 计算当前与历史最长连续活跃天数
 * @param dayKeys 有活动的日键集合（`YYYY-MM-DD`）
 * @param today 今天的日键（同格式，由调用方给定，保证口径一致）
 * @returns 当前连续天数与历史最长连续天数
 */
export function calcUsageStreaks(dayKeys: ReadonlySet<string>, today: string): UsageStreaks {
  if (dayKeys.size === 0) return { current: 0, longest: 0 };

  // 历史最长：字典序扫描相邻日差（gap=1 即连续，断档重新起算）
  const sorted = [...dayKeys].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = (dayKeyToUtc(sorted[i] ?? '') - dayKeyToUtc(sorted[i - 1] ?? '')) / DAY_MS;
    run = gap === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  // 当前连续：今天没活动从昨天起算（不算断签），逐日回退计数
  let current = 0;
  let cursor = dayKeyToUtc(today);
  if (!dayKeys.has(today)) cursor -= DAY_MS;
  while (dayKeys.has(utcToDayKey(cursor))) {
    current += 1;
    cursor -= DAY_MS;
  }
  return { current, longest };
}
