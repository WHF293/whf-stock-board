/** 「MM-DD」形态日期（允许带「 周X」后缀）的匹配模式 */
const MONTH_DAY_PATTERN = /^(\d{2})-(\d{2})/;

/**
 * 把同花顺新股清单的「MM-DD」日期补全为「YYYY-MM-DD」
 *
 * 上游页面不输出年份；取候选年份（去年 / 今年 / 明年）中与今天差值最小的一个——
 * 既能正确解释「去年的次新股」（如今年 1 月看到 12 月申购），也不丢「未来申购」
 * （如 12 月看到明年 1 月申购）
 * @param mmdd 「MM-DD」形态日期（允许带「 周X」后缀）
 * @param now 当前时间（省略取调用时刻；测试可注入）
 * @returns 「YYYY-MM-DD」；入参不合法时返回空串
 */
export const inferIpoYear = (mmdd: string, now?: Date): string => {
  const match = MONTH_DAY_PATTERN.exec(mmdd.trim());
  if (!match) return '';
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';

  /**
   * 两位数补零
   * @param n 数字
   * @returns 两位字符串
   */
  const pad = (n: number): string => String(n).padStart(2, '0');

  const clock = now ?? new Date();
  const today = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate());
  let best = '';
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const year of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
    const candidate = new Date(year, month - 1, day);
    if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) continue;
    const diff = Math.abs(candidate.getTime() - today.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = `${year}-${pad(month)}-${pad(day)}`;
    }
  }
  return best;
};
