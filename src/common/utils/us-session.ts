/**
 * 美股交易时段判定（本地时间 = 北京口径）
 *
 * 夏令时近似口径（与既有美股轮询窗口同约定）：美东盘前开盘 ≈ 北京 16:00、
 * 常规开盘 ≈ 北京 21:30、凌晨收盘 ≈ 北京 04:00；冬令时整体后移约 1 小时，
 * 不精确跟随 DST 切换（SDK 日历不支持美股假日，窗口一律按星期近似）。
 * 单一事实源：轮询窗口（market-status）与行情口径（全景页美股基金）共用本文件。
 */

/** 美股行情口径：盘前（美东盘前时段） / 盘中（常规时段） / 收盘（其余时间，展示最近收盘涨跌） */
export type UsSessionFlavor = 'pre' | 'open' | 'closed';

/** 美东盘前开盘（北京夏令时口径，分钟数）：16:00 */
const US_PREMARKET_START = 16 * 60;
/** 美东常规开盘（北京夏令时口径，分钟数）：21:30 */
const US_OPEN_START = 21 * 60 + 30;
/** 晚间段截止（分钟数）：24:00 */
const US_OPEN_END = 24 * 60;
/** 美东常规收盘（凌晨段截止，分钟数）：04:00 */
const US_MORNING_END = 4 * 60;

/**
 * 本地时间当日分钟数
 * @param date 任意 Date 实例
 * @returns 当日 0 点起的分钟数
 */
const localMinutes = (date: Date): number => date.getHours() * 60 + date.getMinutes();

/**
 * 本地星期（0 周日 ~ 6 周六）
 * @param date 任意 Date 实例
 * @returns 星期序数（0~6）
 */
const localDay = (date: Date): number => date.getDay();

/**
 * 是否处于美股常规交易时段（北京周一~五 21:30-24:00 + 周二~六 00:00-04:00）
 * @param now 当前时间
 * @returns 是否盘中
 */
const inUsOpenSession = (now: Date): boolean => {
  const minutes = localMinutes(now);
  const day = localDay(now);
  if (minutes >= US_OPEN_START && minutes < US_OPEN_END) {
    return day >= 1 && day <= 5;
  }
  if (minutes <= US_MORNING_END) {
    return day >= 2 && day <= 6;
  }
  return false;
};

/**
 * 是否处于美股盘前时段（北京周一~五 16:00 - 21:30，夏令时近似）
 * @param now 当前时间
 * @returns 是否盘前
 */
const inUsPremarketSession = (now: Date): boolean => {
  const minutes = localMinutes(now);
  const day = localDay(now);
  return minutes >= US_PREMARKET_START && minutes < US_OPEN_START && day >= 1 && day <= 5;
};

/**
 * 是否处于美股轮询窗口（盘前 + 盘中：周一~五 16:00-24:00 + 周二~六 00:00-04:00）
 * @param now 当前时间
 * @returns 是否在窗口内
 */
export const inUsPollingWindow = (now: Date): boolean =>
  inUsPremarketSession(now) || inUsOpenSession(now);

/**
 * 解析当前美股行情口径（盘前 / 盘中 / 收盘）
 * @param now 当前时间
 * @returns 口径
 */
export const resolveUsSessionFlavor = (now: Date): UsSessionFlavor => {
  if (inUsOpenSession(now)) return 'open';
  if (inUsPremarketSession(now)) return 'pre';
  return 'closed';
};
