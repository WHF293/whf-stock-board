/**
 * 板块历史净流入本地库（市场榜单-板块净流入 · 历史详情页数据层）
 *
 * 独立 localStorage key（`whf:sector-flow-history`，不走 whf:app 整包——
 * 历史随使用时长增长，独立 key 避免整包写放大；Tauri 与浏览器两端行为一致）。
 *
 * 数据策略（`ensureSectorFlowHistories`）：
 * - 板块无历史（首次）：拉全量（daykline 一次带回完整历史，含近五日）；
 * - 交易日盘中（A 股轮询窗口内）：进页即拉新合并（当日值随盘中进度变化，5 分钟节流防高频）；
 * - 交易日盘后：库中缺当日收盘值时补拉一次；非交易日 / 节假日：直接读本地，不发请求。
 *
 * 上游：东财 fflow/daykline（push2his 直连，经 `board-flow-history.api.ts`，
 * 并发 3 + 每请求 500ms 错峰）。26 板块一轮约 5 秒，仅进页 / 打开详情页触发，不轮询。
 */
import dayjs from 'dayjs';
import {
  SECTOR_FLOW_HISTORY_MAX_DAYS,
  SECTOR_FLOW_HISTORY_MIN_REFRESH_MS,
  SECTOR_FLOW_HISTORY_STORE_VERSION,
} from '../constants/sector-flow-history.constants';
import { STORAGE_KEY_SECTOR_FLOW_HISTORY } from '../constants/storage-key.constants';
import { fetchBoardFlowHistories } from './board-flow-history.api';
import type { BoardFlowHistory } from '../types/board-flow-history.types';

/** 单板块历史（存储态：名称 + 逐日序列） */
export interface SectorFlowHistoryEntry {
  /** 板块名称（首次落库时快照） */
  name: string;
  /** 逐日主力净流入（日期升序；按日 upsert，尾部截断至 MAX_DAYS） */
  points: BoardFlowHistory['points'];
}

/** 存储整包结构 */
interface SectorFlowHistoryStore {
  /** 结构版本 */
  version: number;
  /** 板块历史（BK 编号索引） */
  boards: Record<string, SectorFlowHistoryEntry>;
}

/** 拉新判定入参（交易状态由调用方从 market-status store 读取传入） */
export interface SectorFlowEnsureOptions {
  /** 今日是否交易日（SDK 日历口径；未知按 false 处理即不拉新） */
  isTradingDay: boolean;
  /** 是否处于 A 股轮询窗口（09:15 - 15:00；盘中当日值随进度变化，进页即拉新） */
  inPollingWindow: boolean;
  /** 是否无视节流强制拉新（详情页「刷新」按钮用） */
  force?: boolean;
}

/** 内存整包缓存（模块级；写穿 localStorage，读走缓存避免反复 JSON.parse） */
let storeCache: SectorFlowHistoryStore | null = null;

/**
 * 从 localStorage 读整包（坏数据 / 版本不符一律弃置为空库）
 * @returns 存储整包
 */
const readStore = (): SectorFlowHistoryStore => {
  if (storeCache) {
    return storeCache;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SECTOR_FLOW_HISTORY);
    const parsed = raw ? (JSON.parse(raw) as SectorFlowHistoryStore) : null;
    storeCache =
      parsed && parsed.version === SECTOR_FLOW_HISTORY_STORE_VERSION && parsed.boards
        ? parsed
        : { version: SECTOR_FLOW_HISTORY_STORE_VERSION, boards: {} };
  } catch {
    storeCache = { version: SECTOR_FLOW_HISTORY_STORE_VERSION, boards: {} };
  }
  return storeCache;
};

/** 整包回写 localStorage */
const flushStore = (): void => {
  if (!storeCache) {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY_SECTOR_FLOW_HISTORY, JSON.stringify(storeCache));
  } catch (error) {
    console.error('[sector-flow-history] 写入失败', error);
  }
};

/**
 * 读全部板块历史（只读副本，调用方可直接用于渲染）
 * @returns 板块历史（BK 编号索引；无数据为空对象）
 */
export const readSectorFlowHistory = (): Record<string, SectorFlowHistoryEntry> =>
  readStore().boards;

/**
 * 把一轮历史合并进库（按日期 upsert——盘中当日值随进度变化，新值覆盖旧值；
 * 合并后按日期升序重排并截断至 MAX_DAYS）
 * @param history 刚拉到的单板块历史
 */
const mergeIntoStore = (history: BoardFlowHistory): void => {
  const store = readStore();
  const existing = store.boards[history.code];
  const byDate = new Map((existing?.points ?? []).map((point) => [point.date, point.net]));
  for (const point of history.points) {
    byDate.set(point.date, point.net);
  }
  const points = [...byDate.entries()]
    .map(([date, net]) => ({ date, net: net as number }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-SECTOR_FLOW_HISTORY_MAX_DAYS);
  store.boards[history.code] = { name: history.name || (existing?.name ?? history.code), points };
};

/** 上次盘中拉新的时间戳（模块级；5 分钟节流窗口用） */
let lastFetchAt = 0;

/** 进行中的拉取任务（进页签与打开详情页可能同帧各触发一次，共享防重入） */
let ensureTask: Promise<Record<string, SectorFlowHistoryEntry>> | null = null;

/**
 * 确保板块历史就绪：按交易状态决定「拉新合并」还是「直接读库」（详见模块头注释）
 * @param codes 目标板块代码列表（BK 编号，曲线视图已选行业；详情页无 codes 时为库内全部）
 * @param options 交易状态入参
 * @returns 最新板块历史（含未拉取板块的存量数据）
 */
export const ensureSectorFlowHistories = (
  codes: readonly string[],
  options: SectorFlowEnsureOptions,
): Promise<Record<string, SectorFlowHistoryEntry>> => {
  if (ensureTask) {
    return ensureTask;
  }
  ensureTask = (async () => {
    const store = readStore();
    const today = dayjs().format('YYYY-MM-DD');
    const shouldFetch = (code: string): boolean => {
      const entry = store.boards[code];
      // 首次（板块无历史）：拉全量补历史
      if (!entry || entry.points.length === 0) {
        return true;
      }
      // 交易日盘中：当日值随进度变化，进页即拉新（节流防高频）
      if (options.isTradingDay && options.inPollingWindow) {
        return true;
      }
      // 交易日盘后：库中缺当日收盘值才补拉
      return options.isTradingDay && entry.points[entry.points.length - 1].date !== today;
    };
    const targets = options.force === true ? [...codes] : codes.filter(shouldFetch);
    // 节流只拦「常规进页拉新」；首次补历史（板块库空）与 force 不受节流限制
    const hasFirstTimeTarget = targets.some((code) => {
      const entry = store.boards[code];
      return !entry || entry.points.length === 0;
    });
    const throttled =
      options.force !== true && Date.now() - lastFetchAt < SECTOR_FLOW_HISTORY_MIN_REFRESH_MS;
    if (targets.length === 0 || (throttled && !hasFirstTimeTarget)) {
      return store.boards;
    }
    lastFetchAt = Date.now();
    const fetched = await fetchBoardFlowHistories(targets);
    for (const history of fetched) {
      mergeIntoStore(history);
    }
    flushStore();
    return readStore().boards;
  })().finally(() => {
    ensureTask = null;
  });
  return ensureTask;
};
