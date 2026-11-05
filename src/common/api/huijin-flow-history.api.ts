import dayjs from 'dayjs';
import {
  HUIJIN_HISTORY_MAX_DAYS,
  HUIJIN_SNAPSHOT_MIN_INTERVAL_MS,
  HUIJIN_STORE_VERSION,
} from '../constants/huijin-etf-flow.constants.ts';
import { STORAGE_KEY_HUIJIN_ETF_SHARE_HISTORY } from '../constants/storage-key.constants.ts';
import type { HuijinShareSnapshot, HuijinShareStore } from '../types/huijin-etf-flow.types.ts';
import {
  buildSseSnapshotPoints,
  fetchEtfTotalSharesToday,
  fetchSseBaselineSnapshot,
} from './huijin-etf-share.api';

/**
 * 汇金估算模块的份额历史本地库（资金动向-每日汇金持仓变化 数据层）
 *
 * 独立 localStorage key（`whf:huijin-etf-share-history`，不走 whf:app 整包——
 * 历史随使用时长增长，独立 key 避免整包写放大；与 sector-flow-history 同款模式）。
 *
 * 数据策略（`ensureHuijinFlowSnapshots`）：
 * - 当日快照：进页拉一次东财（ulist 单请求），5 分钟节流（盘中重复进页不高频刷）；
 *   当日值随盘中进度覆盖更新，收盘后最后一次即为收盘值；
 * - 首次起步：库空时用上交所官方接口回看「昨日」起的最近交易日份额（仅沪市，
 *   深市 3 只首日空缺、次日由东财快照补齐）；SSE 不可达时跳过，全靠东财首拉日起步。
 *
 * 一日至多 2 次请求（东财 1 + SSE 1），进页触发不轮询，远低于上游红线。
 */

/** 内存整包缓存（模块级；写穿 localStorage，读走缓存避免反复 JSON.parse） */
let storeCache: HuijinShareStore | null = null;

/**
 * 从 localStorage 读整包（坏数据 / 版本不符一律弃置为空库）
 * @returns 存储整包
 */
const readStore = (): HuijinShareStore => {
  if (storeCache) {
    return storeCache;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HUIJIN_ETF_SHARE_HISTORY);
    const parsed = raw ? (JSON.parse(raw) as HuijinShareStore) : null;
    storeCache =
      parsed && parsed.version === HUIJIN_STORE_VERSION && Array.isArray(parsed.days)
        ? parsed
        : { version: HUIJIN_STORE_VERSION, days: [] };
  } catch {
    storeCache = { version: HUIJIN_STORE_VERSION, days: [] };
  }
  return storeCache;
};

/** 整包回写 localStorage */
const flushStore = (): void => {
  if (!storeCache) {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY_HUIJIN_ETF_SHARE_HISTORY, JSON.stringify(storeCache));
  } catch (error) {
    console.error('[huijin-flow-history] 写入失败', error);
  }
};

/**
 * 把一日快照合并进库（按日期 upsert——当日值随盘中进度变化，新值覆盖旧值；
 * 合并后按日期升序重排并截断至 MAX_DAYS）
 * @param snapshot 刚拉到的单日快照
 */
const upsertSnapshot = (snapshot: HuijinShareSnapshot): void => {
  const store = readStore();
  const byDate = new Map(store.days.map((day) => [day.date, day]));
  const existing = byDate.get(snapshot.date);
  byDate.set(snapshot.date, {
    date: snapshot.date,
    points: { ...(existing?.points ?? {}), ...snapshot.points },
  });
  store.days = [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-HUIJIN_HISTORY_MAX_DAYS);
};

/** 进行中的拉取任务（重复进页 / 刷新按钮同帧触发时共享防重入） */
let ensureTask: Promise<HuijinShareSnapshot[]> | null = null;

/**
 * 确保份额历史就绪：当日快照拉新（节流）+ 首次起步回看 SSE
 * @param options 可选项
 * @param options.force 是否无视节流强制拉当日快照（用户点「刷新」）
 * @returns 份额历史快照序列（日期升序）
 */
export const ensureHuijinFlowSnapshots = (options?: {
  force?: boolean;
}): Promise<HuijinShareSnapshot[]> => {
  if (ensureTask) {
    return ensureTask;
  }
  ensureTask = (async () => {
    const store = readStore();
    const today = dayjs().format('YYYY-MM-DD');
    const todaySnapshot = store.days.find((day) => day.date === today);
    // 节流基准用快照自身抓取时间（进程重启后依然有效），内存时间戳不跨会话
    const lastFetchedAt = todaySnapshot
      ? Math.max(0, ...Object.values(todaySnapshot.points).map((point) => point.fetchedAt))
      : 0;
    const throttled =
      options?.force !== true &&
      todaySnapshot !== undefined &&
      Date.now() - lastFetchedAt < HUIJIN_SNAPSHOT_MIN_INTERVAL_MS;

    // 当日快照：节流窗口内跳过；缺失 / 过节流 / force 才拉
    if (!throttled) {
      const points = await fetchEtfTotalSharesToday();
      upsertSnapshot({ date: today, points });
    }

    // 首次起步：库空（或仅剩今日一天且无昨日基准）时回看 SSE 补昨日基准（仅沪市）
    const needsSseBaseline = store.days.length <= 1;
    if (needsSseBaseline) {
      const baseline = await fetchSseBaselineSnapshot(
        dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
      );
      if (baseline) {
        upsertSnapshot({ date: baseline.date, points: buildSseSnapshotPoints(baseline.sharesByCode, baseline.date) });
      }
    }

    flushStore();
    return readStore().days;
  })().finally(() => {
    ensureTask = null;
  });
  return ensureTask;
};
