/**
 * 插件 dsh-mainline（股票主线）· 本地快照仓储
 *
 * 两张表（插件独立表，落 `plugin_dsh_mainline_*`；Tauri 端 SQLite / 浏览器端 appStorage 仿真）：
 * - `board_history`：每板块一行，日线序列整体存 `json` 列 ——
 *   一次扫描只写 90 行（避免「一年 × 90 板块」上万行的逐条插入），
 *   读出来即可本地重算分位与阶段，不联网；
 * - `scan_meta`：扫描元信息（键值行），启动即知「数据截止哪天 / 上次何时扫」。
 *
 * 与技能的 `snapshot` 设计同源：**分位序列靠自己累积**，样本不足时判定层如实降置信度。
 */
import { ref } from 'vue';
import { MAINLINE_MAX_HISTORY_DAYS } from './constants';
import type { PluginDatabase, PluginDbColumn, PluginDbRow } from '../../types/plugin.types';
import type { BoardSeries, MainlineScanMeta, MainlineSnapshot, MarketTurnoverPoint } from './types';

/** 板块历史表名（物理表 `plugin_dsh_mainline_board_history`） */
export const MAINLINE_BOARD_TABLE = 'board_history';

/** 扫描元信息表名（物理表 `plugin_dsh_mainline_scan_meta`） */
export const MAINLINE_META_TABLE = 'scan_meta';

/** 扫描元信息在表里的键 */
export const MAINLINE_META_KEY = 'last_scan';

/** 沪深成交额序列在表里的键 */
const MAINLINE_MARKET_KEY = 'market_turnover';

/**
 * 板块历史表的列声明
 *
 * ⚠️ 只声明**业务列**：`id` / `created_at` / `updated_at` 由宿主自动维护并固定写进建表语句，
 * 插件重复声明会让建表语句出现两个同名列（SQLite 报 `duplicate column name`）——
 * 宿主已在 `toColumnMap` 里拒绝保留列，冒烟也用真 SQLite 执行过一次建表。
 */
export const MAINLINE_BOARD_COLUMNS: readonly PluginDbColumn[] = [
  { name: 'board_code', type: 'text', indexed: true },
  { name: 'board_name', type: 'text' },
  { name: 'days', type: 'json' },
];

/** 扫描元信息表的列声明（键值行，同样只声明业务列） */
export const MAINLINE_META_COLUMNS: readonly PluginDbColumn[] = [
  { name: 'meta_key', type: 'text', indexed: true },
  { name: 'meta_value', type: 'json' },
];

/** 板块历史表的一行 */
interface BoardHistoryRow extends Record<string, unknown> {
  /** 板块代码（88xxxx，唯一） */
  board_code: string;
  /** 板块名称 */
  board_name: string;
  /** 逐日行情（json 列，升序） */
  days: unknown;
}

/** 元信息表的一行 */
interface MetaRow extends Record<string, unknown> {
  /** 键（唯一） */
  meta_key: string;
  /** 值（json 列，承载元信息对象或成交额序列） */
  meta_value: unknown;
}

/**
 * 把库里读出的 json 值还原成日线序列（脏数据一律过滤成空序列）
 * @param value json 列值
 * @returns 日线序列（升序）
 */
const parseDays = (value: unknown): BoardSeries['days'] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is BoardSeries['days'][number] =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { date?: unknown }).date === 'string' &&
      Number.isFinite((item as { close?: unknown }).close),
  );
};

/** 主线快照仓储 */
export interface MainlineRepo {
  /**
   * 读当前快照（响应式；扫描落库后自动更新）
   * @returns 快照
   */
  snapshot: () => MainlineSnapshot;
  /**
   * 落库一次扫描结果（按板块 upsert；只保留最近 `MAINLINE_MAX_HISTORY_DAYS` 个交易日）
   * @param boards 各板块日线序列
   * @param market 沪深成交额序列
   * @param meta 扫描元信息
   */
  saveScan: (
    boards: BoardSeries[],
    market: MarketTurnoverPoint[],
    meta: MainlineScanMeta,
  ) => Promise<void>;
}

/**
 * 建表并水合快照
 * @param db 插件通用数据库（`ctx.db`）
 * @returns 主题快照仓储
 */
export const createMainlineRepo = async (db: PluginDatabase): Promise<MainlineRepo> => {
  await db.ensureTable(MAINLINE_BOARD_TABLE, MAINLINE_BOARD_COLUMNS);
  await db.ensureTable(MAINLINE_META_TABLE, MAINLINE_META_COLUMNS);

  const boards = ref<BoardSeries[]>([]);
  const market = ref<MarketTurnoverPoint[]>([]);
  const meta = ref<MainlineScanMeta | null>(null);

  /** board_code → 数据表行主键（upsert 定位） */
  const rowIds = new Map<string, number>();

  // 水合：历史行按板块代码排序，保证界面首屏顺序稳定
  const boardRows = await db.select<BoardHistoryRow>(MAINLINE_BOARD_TABLE, {
    orderBy: { column: 'board_code' },
  });

  // 早前主键登记 bug 会让同一板块重复插入多行（见下方注释）—— 水合时按 updated_at 去重，
  // 保留最新一行并删掉冗余行：重复行会让看板出现同板块多行，且两行数据各自分叉。
  const newestByCode = new Map<string, PluginDbRow<BoardHistoryRow>>();
  const redundantIds: number[] = [];
  for (const row of boardRows) {
    if (!row.board_code) continue;
    const current = newestByCode.get(row.board_code);
    if (!current) {
      newestByCode.set(row.board_code, row);
      continue;
    }
    const keep = row.updatedAt >= current.updatedAt ? row : current;
    redundantIds.push(keep === row ? current.id : row.id);
    newestByCode.set(row.board_code, keep);
  }
  for (const id of redundantIds) {
    await db.remove(MAINLINE_BOARD_TABLE, id);
  }

  for (const row of newestByCode.values()) {
    // ⚠️ 主键登记必须与 upsert 的查找键同形（`${table}:${key}`）：
    // 早前这里记的是裸板块代码，导致重启后首次扫描查不到已有行、把 90 个板块
    // 整批重复插入（表行数翻倍，水合出的快照也出现重复板块）。
    rowIds.set(`${MAINLINE_BOARD_TABLE}:${row.board_code}`, row.id);
    boards.value.push({
      code: row.board_code,
      name: row.board_name || row.board_code,
      days: parseDays(row.days),
    });
  }

  const metaRows = await db.select<MetaRow>(MAINLINE_META_TABLE, {
    orderBy: { column: 'meta_key' },
  });
  const newestMetaByKey = new Map<string, PluginDbRow<MetaRow>>();
  const redundantMetaIds: number[] = [];
  for (const row of metaRows) {
    if (!row.meta_key) continue;
    const current = newestMetaByKey.get(row.meta_key);
    if (!current) {
      newestMetaByKey.set(row.meta_key, row);
      continue;
    }
    const keep = row.updatedAt >= current.updatedAt ? row : current;
    redundantMetaIds.push(keep === row ? current.id : row.id);
    newestMetaByKey.set(row.meta_key, keep);
  }
  for (const id of redundantMetaIds) {
    await db.remove(MAINLINE_META_TABLE, id);
  }

  for (const row of newestMetaByKey.values()) {
    // 同样登记主键：不登记的话每次重启后首扫会再插一份元信息行（读时靠后写覆盖，属垃圾行）
    rowIds.set(`${MAINLINE_META_TABLE}:${row.meta_key}`, row.id);
    if (row.meta_key === MAINLINE_META_KEY && row.meta_value && typeof row.meta_value === 'object') {
      meta.value = row.meta_value as MainlineScanMeta;
    }
    if (row.meta_key === MAINLINE_MARKET_KEY && Array.isArray(row.meta_value)) {
      market.value = row.meta_value as MarketTurnoverPoint[];
    }
  }

  /**
   * 写一行（存在则更新，不存在则插入并登记主键）
   * @param table 表名
   * @param key 业务键
   * @param columns 列值
   */
  const upsert = async (
    table: string,
    key: string,
    columns: Record<string, unknown>,
  ): Promise<void> => {
    const lookupKey = `${table}:${key}`;
    const id = rowIds.get(lookupKey);
    if (id === undefined) {
      rowIds.set(lookupKey, await db.insert(table, columns));
      return;
    }
    await db.update(table, id, columns);
  };

  return {
    snapshot: (): MainlineSnapshot => ({
      boards: boards.value,
      market: market.value,
      meta: meta.value,
    }),

    saveScan: async (
      nextBoards: BoardSeries[],
      nextMarket: MarketTurnoverPoint[],
      nextMeta: MainlineScanMeta,
    ): Promise<void> => {
      // 时间列（created_at / updated_at）由宿主自动维护，插件不传
      for (const series of nextBoards) {
        const days = series.days.slice(-MAINLINE_MAX_HISTORY_DAYS);
        await upsert(MAINLINE_BOARD_TABLE, series.code, {
          board_code: series.code,
          board_name: series.name,
          days,
        });
      }
      const marketRowKey = `${MAINLINE_META_TABLE}:${MAINLINE_MARKET_KEY}`;
      const marketId = rowIds.get(marketRowKey);
      if (marketId === undefined) {
        rowIds.set(
          marketRowKey,
          await db.insert(MAINLINE_META_TABLE, {
            meta_key: MAINLINE_MARKET_KEY,
            meta_value: nextMarket,
          }),
        );
      } else {
        await db.update(MAINLINE_META_TABLE, marketId, { meta_value: nextMarket });
      }
      await upsert(MAINLINE_META_TABLE, MAINLINE_META_KEY, {
        meta_key: MAINLINE_META_KEY,
        meta_value: nextMeta,
      });

      // 内存快照同步换新引用（界面与判定层都是 computed，靠引用变化驱动）
      boards.value = nextBoards.map((series) => ({
        ...series,
        days: series.days.slice(-MAINLINE_MAX_HISTORY_DAYS),
      }));
      market.value = nextMarket;
      meta.value = nextMeta;
    },
  };
};

declare module '../../types/plugin.types' {
  /** 本插件对外贡献的服务 */
  interface AppServiceMap {
    /** 主线快照仓储（读快照重算判定，不联网；由 dsh-mainline 提供） */
    'mainline:repo': MainlineRepo;
  }
}
