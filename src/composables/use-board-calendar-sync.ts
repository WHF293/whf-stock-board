import {
  fetchBoardConstituents,
  fetchBoardSnapshot,
  fetchLimitPool,
  fetchTradingDates,
  getLocalDateString,
  toLocalDateString,
  toPoolDateParam,
} from '../api/board-calendar.api';
import {
  countConstituents,
  countConstituentsByBoard,
  getBoardDb,
  getCalendarMeta,
  getConstituentSyncedAt,
  isBoardDbAvailable,
  listBoardDailyDates,
  listBoardDailyDatesByDataLevel,
  listConstituentBoardMap,
  readBoardPoolSignature,
  readPoolBoundaryDate,
  readTradingDatesCache,
  replaceConstituents,
  replaceLimitStocks,
  upsertBoardDaily,
  upsertBoardProfiles,
  upsertCalendarMeta,
  writeBoardPoolSignature,
  writePoolBoundaryDate,
  writeTradingDatesCache,
} from '../api/board-calendar-db.api';
import {
  BACKFILL_CONCURRENCY,
  BOARD_DATA_LEVEL,
  BOARD_FINAL_HOUR,
  BOARD_FINALIZE_MINUTE,
  BOARD_REQUEST_GAP_MS,
  BOARD_SNAPSHOT_EARLIEST_MINUTE,
  BOARD_SNAPSHOT_LUNCH_END_MINUTE,
  BOARD_SNAPSHOT_LUNCH_START_MINUTE,
  BOARD_SNAPSHOT_REFRESH_END_MINUTE,
  BOARD_SNAPSHOT_THROTTLE_MS,
  BOARD_SYNC_START_DELAY_MS,
  CALENDAR_BOARD_COUNT,
  CALENDAR_BOARDS,
  CONSTITUENT_SYNC_CONCURRENCY,
  CONSTITUENT_SYNC_INTERVAL_MS,
  TRADE_AXIS_CONFIRM_MINUTE,
  TRADE_AXIS_RETRY_MS,
  ZT_BACKFILL_DAYS,
  calcBoardScore,
} from '../constants/board-calendar.constants';
import type {
  BoardDailyRow,
  BoardLimitStock,
  BoardProfile,
  BoardSyncResult,
  LimitPoolStock,
  TradingDatesCache,
} from '../types/board-calendar.types';
import { delay } from '../utils/delay';
import { handleSdkError } from '../utils/handle-sdk-error';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

/**
 * 板块日历采集编排
 *
 * **核心原则：入库之后只做增量请求。** 一次采集的请求数按「是否真的有新数据」决定：
 *
 * | 数据 | 变化频率 | 增量策略 |
 * |---|---|---|
 * | 成分股映射 | 极慢 | 7 天才整表重建一次（36 个板块 ≈ 82 页 ≈ 17s）；未到窗口只为「库里没有」的新板块补采 |
 * | 交易日轴 | 每个交易日 1 条 | 库内缓存；当天确认过后 0 请求 |
 * | 历史回补 | 每个交易日 1 天 | 只补库内缺失且尚未探明不可达的日期；板块池变更时重跑一次窗口 |
 * | 当日快照 | 盘中持续变化 | 定稿前按 10 分钟节流；定稿后 0 请求 |
 *
 * 稳态下的实际开销：
 * - 交易日：交易日轴 ≤2 次 + 回补 2 次（昨日涨跌停池）+ 当日快照 3 次 × 盘中刷新轮数；
 * - 已定稿（15:00 后）或非交易日：可降到 0～2 次，页面重复轮询不再产生任何请求。
 *
 * ⚠️ 涨停池只有个股代码，`f100` / `f127` 给的是**东财叶子行业名**（如「化学制药」），
 * 无法直接归到申万一级（「医药生物」），故必须依赖 board_constituent 映射表。
 * 映射表按**一对多**使用：板块池含追加的热门板块（半导体 / 航天航空 / 机器人 /
 * 光伏设备 / 新能源），与一级行业必然重叠，同一只票同时计入两边。
 *
 * 失败策略：对外只返回 BoardSyncResult（含 error 文案），**不向 UI 抛异常**。
 */

/** 板块代码 → 涨跌停个股 */
interface BoardGroup {
  /** 板块代码 → 该板块的涨跌停个股 */
  groups: Map<string, LimitPoolStock[]>;
  /** 未命中映射表的个股数（新股 / 借壳等，仅记日志） */
  unmapped: number;
}

/** 回补结果 */
interface BackfillOutcome {
  /** 本次成功回补的交易日（升序） */
  done: string[];
  /** 本次探明到的不可达边界（`YYYY-MM-DD`）；未探明为 null */
  boundary: string | null;
}

/**
 * 单日涨跌停池探测结果
 *
 * ⚠️ `null` 表示该日**探测失败**（瞬时错误），不等于「空池」：
 * 空池是「回溯窗口已到边界」的证据，探测失败不是——两者混淆会让一次网络抖动
 * 被判成边界并落库，此后该日之前的交易日永不再补采。
 */
interface BackfillProbe {
  /** 交易日（`YYYY-MM-DD`） */
  tradeDate: string;
  /** 涨停池；探测失败为 null */
  limitUp: LimitPoolStock[] | null;
  /** 跌停池；探测失败为 null */
  limitDown: LimitPoolStock[] | null;
}

/**
 * 错误 → 可展示文案（优先保留自定义中文错误原文）
 * @param error 捕获到的抛出值
 * @returns 中文文案
 */
const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return handleSdkError(error);
};

/**
 * 本地时间当日分钟数
 * @param date 任意时刻
 * @returns 当日 0 点起的分钟数（如 09:35 → 575）
 */
const localMinutes = (date: Date): number => date.getHours() * 60 + date.getMinutes();

/**
 * 是否同一自然日（本地时区）
 * @param timestamp 毫秒时间戳
 * @param now 当前时刻
 * @returns true 表示落在同一天
 */
const isSameLocalDay = (timestamp: number, now: Date): boolean =>
  toLocalDateString(new Date(timestamp)) === toLocalDateString(now);

/**
 * 按映射表把涨跌停个股归组到板块
 *
 * ⚠️ **一对多**：板块池含追加的热门板块，一只票可同时属于「电子」与「半导体」，
 * 故它会被计入每一个命中的板块——板块间重叠是设计如此（看待角度不同），
 * 不是重复计数错误（同一板块内部的净额口径不变）。
 * @param stocks 涨跌停个股
 * @param constituentMap symbol → boardCode 列表映射
 * @returns 归组结果与未命中计数
 */
const groupByBoard = (
  stocks: LimitPoolStock[],
  constituentMap: Map<string, string[]>,
): BoardGroup => {
  const groups = new Map<string, LimitPoolStock[]>();
  let unmapped = 0;
  for (const stock of stocks) {
    const boardCodes = constituentMap.get(stock.symbol);
    if (!boardCodes || boardCodes.length === 0) {
      unmapped += 1;
      continue;
    }
    for (const boardCode of boardCodes) {
      const list = groups.get(boardCode);
      if (list) {
        list.push(stock);
      } else {
        groups.set(boardCode, [stock]);
      }
    }
  }
  return { groups, unmapped };
};

/**
 * 涨跌停个股 → 落库行
 * @param tradeDate 交易日
 * @param boardCode 归属板块代码
 * @param stocks 该板块的涨跌停个股
 * @returns 明细行数组
 */
const toLimitStockRows = (
  tradeDate: string,
  boardCode: string,
  stocks: LimitPoolStock[],
): BoardLimitStock[] =>
  stocks.map((stock) => ({
    tradeDate,
    boardCode,
    symbol: stock.symbol,
    name: stock.name,
    limitType: stock.limitType,
    changePercent: stock.changePercent,
    price: stock.price,
    amount: stock.amount,
    turnoverRate: stock.turnoverRate,
    sealTime: stock.sealTime,
    openTimes: stock.openTimes,
    limitStreak: stock.limitStreak,
  }));

/* ------------------------------- 交易日轴缓存 ------------------------------- */

/**
 * 交易日轴内存缓存
 *
 * 同一次会话内的轮询（每 120s 一次）直接命中，避免反复从库里读 5KB JSON；
 * 跨会话的持久化由 board_sync_state 的 `trade_dates` 兜底。
 */
let axisMemo: TradingDatesCache | null = null;

/**
 * 交易日轴缓存是否仍可用（可用即**完全不发请求**）
 *
 * 腾讯日 K 的日期序列同时是「今天是否交易日」的权威判据
 * （2026-09-14 实测：14:58 盘中已含当天 bar），故规则围绕「今天是否已确认」展开：
 * 1. 轴内已含今天 → 今天确定是交易日，当天剩余时间无需再查；
 * 2. 跨自然日 → 需要重查（可能新增了一个交易日）；
 *    例外：周末只要轴已覆盖到最近一个交易日（周六为昨天、周日为前天）即可，无需重查；
 * 3. 同一天内尚未跨过开盘确认时刻 → 沿用（盘前拉到的轴不含今天属正常）；
 * 4. 同一天内已跨过确认时刻、而上次拉取在确认时刻之前 → 重查一次完成开盘确认；
 * 5. 已过确认时刻但今天仍未确认（上游补当天 bar 延迟、工作日节假日）→
 *    每隔 TRADE_AXIS_RETRY_MS 兜底重查，直到收盘。
 * @param cached 交易日轴缓存（null 表示无缓存）
 * @param now 当前时刻
 * @returns true 表示无需重新拉取
 */
const isAxisCacheUsable = (cached: TradingDatesCache | null, now: Date): boolean => {
  if (cached === null || cached.dates.length === 0) {
    return false;
  }
  const today = toLocalDateString(now);
  const lastDate = cached.dates[cached.dates.length - 1];
  // 1. 轴内已含今天
  if (lastDate === today) {
    return true;
  }
  const day = now.getDay();
  // 2. 跨自然日
  if (!isSameLocalDay(cached.updatedAt, now)) {
    if (day !== 0 && day !== 6) {
      return false;
    }
    const lastTradingDay = new Date(now);
    lastTradingDay.setDate(now.getDate() - (day === 6 ? 1 : 2));
    return lastDate >= toLocalDateString(lastTradingDay);
  }
  const minutes = localMinutes(now);
  // 3. 同一天内尚未到开盘确认时刻
  if (minutes < TRADE_AXIS_CONFIRM_MINUTE) {
    return true;
  }
  // 4. 已过确认时刻，但缓存取于确认时刻之前 → 重查一次
  if (localMinutes(new Date(cached.updatedAt)) < TRADE_AXIS_CONFIRM_MINUTE) {
    return false;
  }
  // 5. 兜底重查：收盘后当天不会再有新增交易日 → 直接沿用；盘中至收盘之间按 RETRY 间隔重查
  if (minutes >= BOARD_SNAPSHOT_REFRESH_END_MINUTE) {
    return true;
  }
  return now.getTime() - cached.updatedAt < TRADE_AXIS_RETRY_MS;
};

/**
 * 获取交易日轴（命中缓存则 0 请求）
 *
 * 拉取失败时**回退到库内/内存缓存**（哪怕已过期），保证页面仍能渲染出列。
 * @param force 是否忽略缓存强制重拉（用户点「强制刷新」时）
 * @returns 交易日轴（升序）；彻底不可用时为空数组
 */
const ensureTradingDates = async (force: boolean): Promise<string[]> => {
  const now = new Date();
  if (!force && isAxisCacheUsable(axisMemo, now)) {
    return axisMemo?.dates ?? [];
  }
  const cached = await readTradingDatesCache();
  if (!force && isAxisCacheUsable(cached, now)) {
    axisMemo = cached;
    return cached?.dates ?? [];
  }
  try {
    const dates = await fetchTradingDates();
    await writeTradingDatesCache(dates);
    axisMemo = { dates, updatedAt: Date.now() };
    return dates;
  } catch (error) {
    console.warn(`[board-calendar] 交易日轴拉取失败，回退库内缓存：${toErrorMessage(error)}`);
    return (cached ?? axisMemo)?.dates ?? [];
  }
};

/**
 * 对外获取交易日轴（页面渲染用；与采集共用同一份缓存，避免页面重复请求）
 * @param force 是否忽略缓存强制重拉（用户点「刷新」时）
 * @returns 交易日轴（升序）
 * @throws Error 上游不可用且本地无任何缓存时抛出（页面据此提示网络问题）
 */
export const getTradingDates = async (force = false): Promise<string[]> => {
  const dates = await ensureTradingDates(force);
  if (dates.length === 0) {
    throw new Error('交易日轴获取失败：上游不可用且本地无缓存');
  }
  return dates;
};

/* -------------------------------- 成分股映射 -------------------------------- */

/**
 * 成分股映射同步（距上次同步超过 7 天或首次 / force 时整表重建；否则只补缺失板块）
 *
 * 逐板块并发拉取（板块内部串行翻页），单板块拉空则保留该板块旧数据不删。
 * 「只补缺失板块」是为板块池新增板块（如新增热门题材）准备的：旧库对新板块一无所知，
 * 若等足 7 天，新板块的涨停家数会一直是 0（快照有涨跌家数，但涨跌停归组归不上）。
 * @param force 是否强制重建（忽略 7 天新鲜度）
 * @returns 本次是否重建 + 映射总条数
 */
const syncConstituents = async (force: boolean): Promise<{ synced: boolean; count: number }> => {
  const syncedAt = await getConstituentSyncedAt();
  const isStale = Date.now() - syncedAt > CONSTITUENT_SYNC_INTERVAL_MS;
  const rebuildAll = force || syncedAt === 0 || isStale;

  const existing = await countConstituentsByBoard();
  const targets = rebuildAll
    ? CALENDAR_BOARDS
    : CALENDAR_BOARDS.filter((board) => (existing.get(board.code) ?? 0) === 0);
  if (targets.length === 0) {
    return { synced: false, count: await countConstituents() };
  }

  const results = await mapWithConcurrency(
    targets,
    async (board) => ({ board, items: await fetchBoardConstituents(board.code) }),
    { concurrency: CONSTITUENT_SYNC_CONCURRENCY },
  );

  let emptyBoards = 0;
  for (const { board, items } of results) {
    if (items.length === 0) {
      // 拉取失败或为空：保留旧数据（replaceConstituents 会先删，故此处必须跳过）
      emptyBoards += 1;
      continue;
    }
    await replaceConstituents(
      board.code,
      items.map((item) => ({ symbol: item.symbol, stockName: item.name, market: item.market })),
    );
    await delay(BOARD_REQUEST_GAP_MS);
  }
  if (emptyBoards > 0) {
    console.warn(`[board-calendar] ${emptyBoards} 个板块成分股拉取为空，已保留旧映射`);
  }
  return { synced: true, count: await countConstituents() };
};

/* -------------------------------- 当日快照 -------------------------------- */

/**
 * 采集「今日完整快照」并落库（涨跌停 + 涨跌家数齐全）
 *
 * 请求数固定为 3：板块快照 1（一次批量查板块池全部板块）+ 涨停池 1 + 跌停池 1。
 * @param tradeDate 交易日（`YYYY-MM-DD`）
 * @param constituentMap symbol → boardCode 列表映射
 * @returns 全市场涨停 / 跌停家数
 */
const collectDailySnapshot = async (
  tradeDate: string,
  constituentMap: Map<string, string[]>,
): Promise<{ limitUpCnt: number; limitDownCnt: number }> => {
  const snapshot = await fetchBoardSnapshot();
  const poolDate = toPoolDateParam(tradeDate);
  const limitUp = await fetchLimitPool(1, poolDate);
  await delay(BOARD_REQUEST_GAP_MS);
  const limitDown = await fetchLimitPool(-1, poolDate);

  const missing = CALENDAR_BOARDS.filter((board) => !snapshot.has(board.code));
  if (missing.length >= CALENDAR_BOARD_COUNT / 2) {
    // 大半板块缺失 → 判上游异常，拒绝写库（避免污染历史）
    throw new Error(`板块快照缺失 ${missing.length} 个，疑似上游异常`);
  }
  if (missing.length > 0) {
    console.warn(
      `[board-calendar] 以下板块在板块快照中缺失：${missing.map((b) => b.name).join('、')}`,
    );
  }

  const upGroup = groupByBoard(limitUp, constituentMap);
  const downGroup = groupByBoard(limitDown, constituentMap);
  if (upGroup.unmapped > 0 || downGroup.unmapped > 0) {
    console.warn(
      `[board-calendar] 涨跌停个股未命中任何板块映射：涨停 ${upGroup.unmapped} 只 / 跌停 ${downGroup.unmapped} 只`,
    );
  }

  const now = Date.now();
  const isFinal = new Date().getHours() >= BOARD_FINAL_HOUR;
  const rows: BoardDailyRow[] = [];
  const limitRows: BoardLimitStock[] = [];
  const profiles: BoardProfile[] = [];

  CALENDAR_BOARDS.forEach((board, index) => {
    const item = snapshot.get(board.code);
    if (!item) return;
    const ups = upGroup.groups.get(board.code) ?? [];
    const downs = downGroup.groups.get(board.code) ?? [];
    const consCount = item.upCount + item.downCount + item.flatCount;
    const score = calcBoardScore({
      limitUp: ups.length,
      limitDown: downs.length,
      upCount: item.upCount,
      downCount: item.downCount,
    });
    rows.push({
      tradeDate,
      boardCode: board.code,
      boardName: board.name,
      changePercent: item.changePercent,
      amount: item.amount,
      limitUp: ups.length,
      limitDown: downs.length,
      upCount: item.upCount,
      downCount: item.downCount,
      flatCount: item.flatCount,
      consCount,
      score,
      scoreRate: consCount > 0 ? score / consCount : 0,
      dataLevel: BOARD_DATA_LEVEL.FULL,
      snapshotAt: now,
      isFinal,
    });
    limitRows.push(
      ...toLimitStockRows(tradeDate, board.code, ups),
      ...toLimitStockRows(tradeDate, board.code, downs),
    );
    profiles.push({
      code: board.code,
      name: board.name,
      sortOrder: index,
      consCount,
      updatedAt: now,
    });
  });

  await upsertBoardDaily(rows);
  await replaceLimitStocks(tradeDate, limitRows);
  await upsertBoardProfiles(profiles);
  await upsertCalendarMeta({
    tradeDate,
    dataLevel: BOARD_DATA_LEVEL.FULL,
    isFinal,
    limitUpCnt: limitUp.length,
    limitDownCnt: limitDown.length,
    constituentSyncedAt: 0,
    updatedAt: now,
  });
  return { limitUpCnt: limitUp.length, limitDownCnt: limitDown.length };
};

/**
 * 判断当日快照本次是否需要采集
 *
 * 只有「确实会有新数据」时才采：非交易日、盘前（上游返回的是昨收，会把昨收写进今天的行
 * 且此后不会被回补覆盖）、已定稿、午休、以及距上次采集不足节流窗口时一律跳过。
 * @param today 今天（`YYYY-MM-DD`）
 * @param isTodayTradingDay 今天是否交易日（交易日轴内是否含今天）
 * @param force 是否强制采集（用户点「强制刷新」）
 * @returns true 表示需要采集
 */
const shouldCollectSnapshot = async (
  today: string,
  isTodayTradingDay: boolean,
  force: boolean,
): Promise<boolean> => {
  if (!isTodayTradingDay) {
    return false;
  }
  const minutes = localMinutes(new Date());
  // 盘前：ulist 返回的是上一交易日收盘值，采了会污染当日行
  if (minutes < BOARD_SNAPSHOT_EARLIEST_MINUTE) {
    return false;
  }
  if (force) {
    return true;
  }
  const meta = await getCalendarMeta(today);
  // 当日首次（含午休时段启动）→ 立即采一次，保证页面有今天的行
  if (meta === null) {
    return true;
  }
  // 已定稿 → 本日不再采
  if (meta.isFinal) {
    return false;
  }
  // 午休行情不再变化，重复采集纯属浪费请求
  if (minutes >= BOARD_SNAPSHOT_LUNCH_START_MINUTE && minutes < BOARD_SNAPSHOT_LUNCH_END_MINUTE) {
    return false;
  }
  return Date.now() - meta.updatedAt >= BOARD_SNAPSHOT_THROTTLE_MS;
};

/* -------------------------------- 历史回补 -------------------------------- */

/**
 * 选出本次待回补的交易日（**降序**，最多 ZT_BACKFILL_DAYS 个）
 *
 * 降序是必须的：涨跌停池只能回溯约 14 个交易日，从最新往回扫，遇到首个空日
 * 即为窗口边界，可以安全停止；若升序扫描，最旧那个候选日往往已在窗口之外，
 * 首个即空会直接终止整轮回补（曾导致首次安装一个交易日都补不到）。
 * @param tradingDates 交易日轴（升序）
 * @param today 今天（`YYYY-MM-DD`）
 * @param existingDates 库内已有数据的交易日
 * @param boundary 已探明的不可达边界（≤ 该日期不再尝试）；null 表示尚未探明
 * @returns 待回补交易日（降序）
 */
const pickBackfillDates = (
  tradingDates: string[],
  today: string,
  existingDates: Set<string>,
  boundary: string | null,
): string[] =>
  tradingDates
    .filter((date) => date !== today && !existingDates.has(date))
    .filter((date) => boundary === null || date > boundary)
    .slice(-ZT_BACKFILL_DAYS)
    .reverse();

/**
 * 探测一个交易日的涨跌停池（每日 2 请求，日内两次请求仍 `delay` 错峰）
 *
 * 失败不抛异常，以 `limitUp / limitDown = null` 表达，交由调用方按「失败」而非「空池」处理。
 * @param tradeDate 交易日（`YYYY-MM-DD`）
 * @returns 该日的探测结果
 */
const probeLimitPool = async (tradeDate: string): Promise<BackfillProbe> => {
  const poolDate = toPoolDateParam(tradeDate);
  try {
    const limitUp = await fetchLimitPool(1, poolDate);
    await delay(BOARD_REQUEST_GAP_MS);
    const limitDown = await fetchLimitPool(-1, poolDate);
    return { tradeDate, limitUp, limitDown };
  } catch (error) {
    console.warn(`[board-calendar] 回补 ${tradeDate} 探测失败：${toErrorMessage(error)}`);
    return { tradeDate, limitUp: null, limitDown: null };
  }
};

/**
 * 回补历史交易日（只能拿到涨跌停，板块级涨跌家数接口无历史值）
 *
 * **并发尺度是「交易日」**：最多 `BACKFILL_CONCURRENCY` 个交易日同时在探（单日内部 2 个请求
 * 仍 300ms 错峰），首次全窗口补采的耗时从串行的 ~15s 压到 ~5s。
 *
 * ⚠️ 并发后**不能**沿用串行版的「探到首个空日就 break 中断整轮」：并行时更早日期的请求
 * 早已发出，break 省不下请求、只能省写库，且会让「是否空池」受请求完成顺序影响。故改为
 * **先全部探测 → 再按降序判定边界 → 只写边界以内的日期**（写库顺序仍为降序，与串行一致）。
 * 代价：回溯窗口比 `ZT_BACKFILL_DAYS` 短时会多探几天（每次至多 20 天 × 2 请求），
 * 这些请求在串行版里同样会发出，实际增量可忽略；收益是边界判定与并发彻底解耦。
 * @param candidates 待回补交易日（降序）
 * @param constituentMap symbol → boardCode 列表映射
 * @returns 成功回补的交易日与本次探明到的边界
 */
const backfillHistory = async (
  candidates: string[],
  constituentMap: Map<string, string[]>,
): Promise<BackfillOutcome> => {
  const probes = await mapWithConcurrency(candidates, probeLimitPool, {
    concurrency: BACKFILL_CONCURRENCY,
  });
  // mapWithConcurrency 按**完成顺序**返回（不是入参顺序），故按交易日取回，再依 candidates 的降序逐日处理
  const probeByDate = new Map(probes.map((probe) => [probe.tradeDate, probe]));

  const done: string[] = [];
  let boundary: string | null = null;

  for (const tradeDate of candidates) {
    const probe = probeByDate.get(tradeDate);
    // 探测失败：跳过该日（下次采集仍会重试），不写库、也不当作窗口边界
    if (!probe || probe.limitUp === null || probe.limitDown === null) {
      continue;
    }
    const { limitUp, limitDown } = probe;
    // 降序扫描 ⇒ 首个空日即回溯窗口的远端边界，更早的日期同样不可达 → 停止并记下边界，
    // 下次采集按边界过滤，不再重复探测（这是「只做增量」的关键一环）
    if (limitUp.length === 0 && limitDown.length === 0) {
      boundary = tradeDate;
      console.warn(`[board-calendar] 回补到窗口边界 ${tradeDate}，停止回补`);
      break;
    }

    const upGroup = groupByBoard(limitUp, constituentMap);
    const downGroup = groupByBoard(limitDown, constituentMap);
    const now = Date.now();
    const rows: BoardDailyRow[] = [];
    const limitRows: BoardLimitStock[] = [];

    CALENDAR_BOARDS.forEach((board) => {
      const ups = upGroup.groups.get(board.code) ?? [];
      const downs = downGroup.groups.get(board.code) ?? [];
      // 该日无涨跌家数：up/down 置 0，得分退化为「仅涨跌停」口径（不参与色阶）
      rows.push({
        tradeDate,
        boardCode: board.code,
        boardName: board.name,
        changePercent: null,
        amount: null,
        limitUp: ups.length,
        limitDown: downs.length,
        upCount: 0,
        downCount: 0,
        flatCount: 0,
        consCount: 0,
        score: calcBoardScore({
          limitUp: ups.length,
          limitDown: downs.length,
          upCount: ups.length,
          downCount: downs.length,
        }),
        scoreRate: 0,
        dataLevel: BOARD_DATA_LEVEL.PARTIAL,
        snapshotAt: now,
        isFinal: true,
      });
      limitRows.push(
        ...toLimitStockRows(tradeDate, board.code, ups),
        ...toLimitStockRows(tradeDate, board.code, downs),
      );
    });

    await upsertBoardDaily(rows);
    await replaceLimitStocks(tradeDate, limitRows);
    await upsertCalendarMeta({
      tradeDate,
      dataLevel: BOARD_DATA_LEVEL.PARTIAL,
      isFinal: true,
      limitUpCnt: limitUp.length,
      limitDownCnt: limitDown.length,
      constituentSyncedAt: 0,
      updatedAt: now,
    });
    done.push(tradeDate);
    // 此处不再 delay：跨日错峰已由 BACKFILL_CONCURRENCY（在飞请求 ≤3）承担，写库是本地
    // sqlite 无需让路；串行版在这一行的 delay 纯粹是给上游让路，并发后只会白等。
  }
  return { done: done.reverse(), boundary };
};

/* -------------------------------- 采集编排 -------------------------------- */

/**
 * 执行一次采集编排（成分股映射 → 交易日轴 → 历史回补 → 当日快照）
 *
 * 全程不抛异常：失败信息放在返回值的 `error` 里，页面用库内已有数据继续渲染。
 * @param force 忽略缓存、节流与「已定稿」标记，强制重采
 * @returns 采集结果
 */
const runBoardSync = async (force: boolean): Promise<BoardSyncResult> => {
  const result: BoardSyncResult = {
    constituentSynced: false,
    constituentCount: 0,
    snapshotWritten: false,
    backfilledDates: [],
    error: null,
  };
  if (!isBoardDbAvailable()) {
    result.error = '浏览器端不支持历史累积（需桌面客户端）';
    return result;
  }

  try {
    if ((await getBoardDb()) === null) {
      result.error = '本地数据库不可用';
      return result;
    }

    const { synced, count } = await syncConstituents(force);
    result.constituentSynced = synced;
    result.constituentCount = count;

    const tradingDates = await ensureTradingDates(force);
    if (tradingDates.length === 0) {
      result.error = '交易日轴不可用，本次跳过采集';
      return result;
    }
    const today = getLocalDateString();

    // 成分股映射惰性读取：6200+ 行只在「确实要回补或要采当日快照」时才读
    let constituentMap: Map<string, string[]> | null = null;
    const requireMap = async (): Promise<Map<string, string[]>> => {
      constituentMap ??= await listConstituentBoardMap();
      return constituentMap;
    };

    // 板块池变更（新增 / 移除板块）→ 库内历史行缺少新板块，需重跑一次回补窗口。
    // 但**完整快照日绝不能被回补行覆盖**（回补没有涨跌家数），故此时只把完整快照日
    // 当作已有数据：其余日子（仅回补过的、或还没有数据的）重跑一次。
    const poolSignature = CALENDAR_BOARDS.map((board) => board.code).join(',');
    const poolChanged = (await readBoardPoolSignature()) !== poolSignature;
    if (poolChanged) {
      await writeBoardPoolSignature(poolSignature);
    }

    // 历史回补（增量：只补库内缺失、且未越过已探明边界的交易日）
    const existingDates = new Set(
      poolChanged
        ? await listBoardDailyDatesByDataLevel(BOARD_DATA_LEVEL.FULL)
        : await listBoardDailyDates(),
    );
    const backfillDates = pickBackfillDates(
      tradingDates,
      today,
      existingDates,
      await readPoolBoundaryDate(),
    );
    if (backfillDates.length > 0) {
      const map = await requireMap();
      if (map.size === 0) {
        result.error = '成分股映射为空，本次跳过采集';
        return result;
      }
      const outcome = await backfillHistory(backfillDates, map);
      result.backfilledDates = outcome.done;
      if (outcome.boundary !== null) {
        await writePoolBoundaryDate(outcome.boundary);
      }
    }

    // 当日快照（增量：非交易日 / 盘前 / 已定稿 / 午休 / 节流窗口内均不发请求）
    const isTodayTradingDay = tradingDates[tradingDates.length - 1] === today;
    if (await shouldCollectSnapshot(today, isTodayTradingDay, force)) {
      const map = await requireMap();
      if (map.size === 0) {
        result.error = '成分股映射为空，本次跳过采集';
        return result;
      }
      await collectDailySnapshot(today, map);
      result.snapshotWritten = true;
    }
    return result;
  } catch (error) {
    console.error('[board-calendar]', handleSdkError(error));
    result.error = toErrorMessage(error);
    return result;
  }
};

/** 正在进行的采集（并发调用复用同一次，防止重复请求与写库竞态） */
let inFlightSync: Promise<BoardSyncResult> | null = null;

/**
 * 触发一次采集（带并发闸门）
 *
 * 启动钩子（延迟 3s）与页内轮询会几乎同时触发；采集内部存在「按板块先删后插」，
 * 两次并发 run 交错会互相删掉刚写入的数据，且会把上游请求翻倍（东财有限频）
 * → 因此同一时刻只允许一次采集，后来的调用复用同一次结果。
 * @param options 采集选项
 * @param options.force 忽略缓存、节流与「已定稿」标记，强制重采
 * @returns 采集结果（并发调用时即当前正在跑的那一次）
 */
export const syncBoardCalendar = (options?: { force?: boolean }): Promise<BoardSyncResult> => {
  if (inFlightSync !== null) {
    return inFlightSync;
  }
  const running = runBoardSync(options?.force === true).finally(() => {
    inFlightSync = null;
  });
  inFlightSync = running;
  return running;
};

/** 收盘定稿定时器句柄（null 表示当前没有已安排的定时器） */
let finalizeTimer: number | null = null;

/**
 * 安排一日一次的「收盘定稿」采集
 *
 * 页面轮询是交易窗口感知的（A 股 09:15~15:00），收盘后即暂停；
 * 而当日快照的 `is_final` 只在此后的首次采集才置位 → App 整日运行且页面常开时，
 * 当日快照会永远停在盘中状态（丢掉尾盘变化，且该行此后不会被回补覆盖）。
 *
 * 故在「收盘后 2 分钟」安排一次性采集（正常路径只多发 3 个请求，收盘后重采会直接定稿），
 * 完成后再安排下一天，使长期运行的 App 能自动收口。
 */
const scheduleFinalizeSync = (): void => {
  if (finalizeTimer !== null) {
    window.clearTimeout(finalizeTimer);
    finalizeTimer = null;
  }
  const now = new Date();
  const target = new Date(now);
  target.setHours(0, 0, 0, 0);
  target.setMinutes(BOARD_FINALIZE_MINUTE);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  finalizeTimer = window.setTimeout(
    () => {
      finalizeTimer = null;
      // 休眠唤醒后可能已过很久，此时采一次同样会按「hour >= 15」定稿，不影响正确性
      void syncBoardCalendar().then(() => {
        scheduleFinalizeSync();
      });
    },
    target.getTime() - now.getTime(),
  );
};

/**
 * 启动采集钩子（App 挂载后调用，仅桌面端生效）
 *
 * 延迟 BOARD_SYNC_START_DELAY_MS 执行，不阻塞首屏；失败只记日志。
 * 同时安排「收盘定稿」定时器（见 scheduleFinalizeSync）。
 */
export const initBoardCalendarSync = (): void => {
  if (!isBoardDbAvailable()) {
    return;
  }
  window.setTimeout(() => {
    void syncBoardCalendar();
  }, BOARD_SYNC_START_DELAY_MS);
  scheduleFinalizeSync();
};
