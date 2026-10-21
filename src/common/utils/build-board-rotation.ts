import { BOARD_DATA_LEVEL, SW_LEVEL1_BOARDS } from '../constants/board-calendar.constants.ts';
import {
  ROTATION_LOW_VOLUME_LIMIT,
  ROTATION_MAINLINE_MIN,
  ROTATION_MEMBER_LIMIT,
  ROTATION_MIN_LIMIT_UP,
  ROTATION_PALETTE,
  ROTATION_TOP_N,
} from '../constants/board-rotation.constants.ts';
import type {
  BoardDailyRow,
  BoardLimitStock,
} from '../types/board-calendar.types.ts';
import type {
  RotationDay,
  RotationDayPoint,
  RotationLeader,
  RotationModel,
  RotationOptions,
  RotationSegment,
} from '../types/board-rotation.types.ts';

/**
 * 题材轮动渲染模型构建（纯函数）
 *
 * 输入板块日历既有落库行（board_daily / board_limit_stock / board_calendar_meta），
 * 输出 bump 图与详情区所需的全部视图模型，单测可直接对输入输出写，不碰 Vue。
 *
 * 口径（2026-10-21 王总逐项定稿，详见 .ai/开发方案/2026-10-21-前端-题材轮动页面开发方案.md）：
 * - 每日候选：板块涨停家数 ≥ minLimitUp，按 (涨停数 desc, 得分 desc) 取前 topN；
 * - 名次 = 候选排序位（1 起），掉榜日记 null（bump 线在此断开）；
 * - 段构建：日期升序扫描，同板块「今日在榜且昨日在榜」延段，否则开新段（隔日重现开新段新色，不做合并）；
 * - 段色：调色板按段序循环取用；
 * - 龙头：该板块当日涨停股中连板数最大者，并列取首封时间最早；
 * - 主线标签：Top1 涨停 ≥ mainlineMin；全市场涨停 < lowVolumeLimit 强制「无主线 · 缩量」；
 * - 全市场上涨 / 下跌家数 = 31 个申万一级行业 upCount / downCount 求和（完整划分零重叠），
 *   该日任一行业行 dataLevel = 0（回补日）时记 null（展示「--」）。
 *
 * 注意：板块池含 5 个与申万一级重叠的热门板块（半导体 ⊂ 电子…），候选排序直接用
 * board_daily 的涨停家数，重叠口径与日历矩阵一致，属设计内行为。
 */

/** 申万一级行业代码集合（全市场涨跌家数求和的口径，完整划分零重叠） */
const SW_LEVEL1_CODES = new Set(SW_LEVEL1_BOARDS.map((board) => board.code));

/**
 * 连板数归一（null 视为 1 板）
 * @param streak 落库连板数
 * @returns 归一后的连板数
 */
const streakOf = (streak: number | null): number => (streak === null || streak < 1 ? 1 : streak);

/**
 * 从涨停明细中选段内 / 当日龙头：连板数最大，并列取首封时间最早（null 最晚）
 * @param rows 涨停个股明细（同一板块同一交易日）
 * @returns 龙头；空数组返回 null
 */
const pickLeader = (rows: BoardLimitStock[]): RotationLeader | null => {
  let best: BoardLimitStock | null = null;
  for (const row of rows) {
    if (best === null) {
      best = row;
      continue;
    }
    const bestStreak = streakOf(best.limitStreak);
    const rowStreak = streakOf(row.limitStreak);
    if (rowStreak > bestStreak) {
      best = row;
      continue;
    }
    if (rowStreak === bestStreak) {
      const bestSeal = best.sealTime ?? '999999';
      const rowSeal = row.sealTime ?? '999999';
      if (rowSeal < bestSeal) best = row;
    }
  }
  return best === null
    ? null
    : {
        symbol: best.symbol,
        name: best.name,
        limitStreak: streakOf(best.limitStreak),
        sealTime: best.sealTime,
      };
};

/**
 * buildBoardRotation 主入口
 * @param dailyRows 板块 × 交易日聚合行（board_daily，可含任意日期范围，函数内部按日期轴对齐）
 * @param limitRows 涨跌停个股明细（board_limit_stock；至少覆盖 dailyRows 的日期，limitType = 1 的行参与龙头判定）
 * @param metaRows 采集台账（board_calendar_meta；全市场涨跌停家数与数据级别来源，缺行的日记 0）
 * @param options 可调口径（默认取常量）
 * @returns 渲染模型（days 升序、segments 按段起点升序）；无任何数据时 days / segments 为空数组
 */
export const buildBoardRotation = (
  dailyRows: readonly BoardDailyRow[],
  limitRows: readonly BoardLimitStock[],
  metaRows: readonly {
    tradeDate: string;
    dataLevel: number;
    isFinal: boolean;
    limitUpCnt: number;
    limitDownCnt: number;
  }[],
  options: RotationOptions = {},
): RotationModel => {
  const topN = options.topN ?? ROTATION_TOP_N;
  const minLimitUp = options.minLimitUp ?? ROTATION_MIN_LIMIT_UP;
  const mainlineMin = options.mainlineMin ?? ROTATION_MAINLINE_MIN;
  const lowVolumeLimit = options.lowVolumeLimit ?? ROTATION_LOW_VOLUME_LIMIT;

  /* ---------------- 索引构建 ---------------- */

  /** 日期 → 聚合行列表（保留原始顺序，求和用） */
  const dailyByDate = new Map<string, BoardDailyRow[]>();
  for (const row of dailyRows) {
    const list = dailyByDate.get(row.tradeDate);
    if (list) {
      list.push(row);
    } else {
      dailyByDate.set(row.tradeDate, [row]);
    }
  }

  /** (日期|板块) → 涨停明细（limitType = 1 才参与龙头 / 成员判定） */
  const limitUpByKey = new Map<string, BoardLimitStock[]>();
  for (const row of limitRows) {
    if (row.limitType !== 1) continue;
    const key = `${row.tradeDate}|${row.boardCode}`;
    const list = limitUpByKey.get(key);
    if (list) {
      list.push(row);
    } else {
      limitUpByKey.set(key, [row]);
    }
  }

  const metaByDate = new Map(metaRows.map((meta) => [meta.tradeDate, meta]));

  /* ---------------- 交易日轴（升序，取聚合行与台账的并集日期） ---------------- */

  const dates = [...new Set([...dailyByDate.keys(), ...metaByDate.keys()])].sort();
  if (dates.length === 0) {
    return { days: [], segments: [] };
  }

  /* ---------------- 逐日候选与行情概览 ---------------- */

  const days: RotationDay[] = [];
  for (const date of dates) {
    const dayRows = dailyByDate.get(date) ?? [];
    const meta = metaByDate.get(date);

    // 完整快照日 = 台账 dataLevel = 1（台账缺失时按聚合行推断）
    const isFullSnapshot = meta
      ? meta.dataLevel === BOARD_DATA_LEVEL.FULL
      : dayRows.length > 0 && dayRows.every((row) => row.dataLevel === BOARD_DATA_LEVEL.FULL);

    // 全市场上涨 / 下跌家数：31 个申万一级行业求和；任一行业缺行或为回补日 → null
    let upCount: number | null = 0;
    let downCount: number | null = 0;
    for (const code of SW_LEVEL1_CODES) {
      const row = dayRows.find((item) => item.boardCode === code);
      if (!row || row.dataLevel !== BOARD_DATA_LEVEL.FULL) {
        upCount = null;
        downCount = null;
        break;
      }
      upCount += row.upCount;
      downCount += row.downCount;
    }

    // 候选：涨停 ≥ 阈值，按 (涨停数 desc, 得分 desc)
    const candidates = dayRows
      .filter((row) => row.limitUp >= minLimitUp)
      .sort((a, b) => b.limitUp - a.limitUp || b.score - a.score || a.boardCode.localeCompare(b.boardCode))
      .slice(0, topN);

    const top: RotationDayPoint[] = candidates.map((row, index) => ({
      tradeDate: date,
      boardCode: row.boardCode,
      boardName: row.boardName,
      rank: index + 1,
      limitUp: row.limitUp,
      scoreRate: row.scoreRate,
      leader: pickLeader(limitUpByKey.get(`${date}|${row.boardCode}`) ?? []),
    }));

    const limitUpCnt = meta?.limitUpCnt ?? 0;
    days.push({
      tradeDate: date,
      limitUpCnt,
      limitDownCnt: meta?.limitDownCnt ?? 0,
      upCount,
      downCount,
      isFullSnapshot,
      isFinal: meta?.isFinal ?? false,
      isLowVolume: limitUpCnt < lowVolumeLimit,
      isMainline: top.length > 0 && (top[0]?.limitUp ?? 0) >= mainlineMin && limitUpCnt >= lowVolumeLimit,
      topBoardName: top[0]?.boardName ?? null,
      top,
    });
  }

  /* ---------------- 段构建：日期升序扫描，同板块连续在榜延段 ---------------- */

  const segments: RotationSegment[] = [];
  /** 上一个交易日各板块所在段（boardCode → segment） */
  let prevActive = new Map<string, RotationSegment>();

  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const day = days[dayIndex]!;
    const nextActive = new Map<string, RotationSegment>();

    for (const point of day.top) {
      const carried = prevActive.get(point.boardCode);
      if (carried) {
        // 延段
        carried.points.push(point);
        carried.endIndex = dayIndex;
        nextActive.set(point.boardCode, carried);
      } else {
        // 开新段（新色：调色板按段序循环）
        const segment: RotationSegment = {
          boardCode: point.boardCode,
          boardName: point.boardName,
          color: ROTATION_PALETTE[segments.length % ROTATION_PALETTE.length] ?? '#0e9488',
          points: [point],
          startIndex: dayIndex,
          endIndex: dayIndex,
          isActive: false,
          totalLimitUp: 0,
          topLeader: null,
          leaders: [],
          successorName: null,
          members: [],
        };
        segments.push(segment);
        nextActive.set(point.boardCode, segment);
      }
    }

    prevActive = nextActive;
  }

  /* ---------------- 段内派生字段 ---------------- */

  const lastDayIndex = days.length - 1;
  for (const segment of segments) {
    segment.isActive = segment.endIndex === lastDayIndex;

    // 每日龙头、累计涨停家次
    let topLeader: RotationLeader | null = null;
    for (const point of segment.points) {
      const leader = point.leader;
      segment.leaders.push(leader);
      segment.totalLimitUp += point.limitUp;
      if (leader && (topLeader === null || leader.limitStreak > topLeader.limitStreak)) {
        topLeader = leader;
      }
    }
    segment.topLeader = topLeader;

    // 接棒题材：掉榜次日新进榜（昨日不在榜）的板块名
    const successorDay = days[segment.endIndex + 1];
    if (successorDay) {
      const prevCodes = new Set((days[segment.endIndex]?.top ?? []).map((point) => point.boardCode));
      segment.successorName =
        successorDay.top.find((point) => !prevCodes.has(point.boardCode))?.boardName ?? null;
    }

    // 段内成员股：去重取最高连板，降序截断
    const memberBySymbol = new Map<string, RotationLeader>();
    for (const point of segment.points) {
      for (const row of limitUpByKey.get(`${point.tradeDate}|${segment.boardCode}`) ?? []) {
        const streak = streakOf(row.limitStreak);
        const known = memberBySymbol.get(row.symbol);
        if (!known || streak > known.limitStreak) {
          memberBySymbol.set(row.symbol, { symbol: row.symbol, name: row.name, limitStreak: streak, sealTime: row.sealTime });
        }
      }
    }
    segment.members = [...memberBySymbol.values()]
      .sort((a, b) => b.limitStreak - a.limitStreak || a.symbol.localeCompare(b.symbol))
      .slice(0, ROTATION_MEMBER_LIMIT);
  }

  return { days, segments };
};
