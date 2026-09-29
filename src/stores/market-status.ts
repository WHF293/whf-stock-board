import { defineStore } from 'pinia';
import { fetchIsTradingDay, getMarketStatus } from '../api/calendar.api';
import {
  A_SHARE_SESSION_END,
  A_SHARE_SESSION_START,
  MARKET_STATUS,
} from '../constants/market-status.constants';
import { handleSdkError } from '../utils/handle-sdk-error';
import type { MarketStatus } from '../types/market-status.types';

/** 市场状态 store 状态 */
interface MarketStatusState {
  /** 当前市场状态（未完成首次刷新前为 null） */
  status: MarketStatus | null;
  /** 今天是否 A 股交易日（未完成首次刷新前为 null） */
  isTradingDay: boolean | null;
  /** 上次成功刷新的时间戳（毫秒） */
  lastRefreshedAt: number | null;
  /** 分钟级时钟 tick（毫秒时间戳）：驱动交易窗口 getter 响应式重算 */
  clockTick: number;
}

/** A 股轮询窗口（本地时间分钟数）：09:15 - 15:00 */
const A_SHARE_WINDOW_START = 9 * 60 + 15;
const A_SHARE_WINDOW_END = 15 * 60;

/** 美股轮询窗口（本地时间分钟数）：21:30 - 24:00 与 00:00 - 04:00 */
const US_EVENING_START = 21 * 60 + 30;
const US_EVENING_END = 24 * 60;
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
 * 市场状态 store（内存态，不持久化）
 *
 * 由 MainLayout 挂载后刷新一次并每 10 分钟同步、每分钟 tick 一次时钟，
 * 轮询经交易窗口 getter 消费，避免各页面独立请求日历
 */
export const useMarketStatusStore = defineStore('market-status', {
  state: (): MarketStatusState => ({
    status: null,
    isTradingDay: null,
    lastRefreshedAt: null,
    clockTick: Date.now(),
  }),

  getters: {
    /**
     * 是否处于交易时段（交易日 + 连续竞价中）
     * @param state store 状态
     * @returns true 表示盘中
     */
    isMarketOpen: (state: MarketStatusState): boolean =>
      state.isTradingDay === true && state.status === MARKET_STATUS.OPEN,

    /**
     * A 股行情轮询窗口：交易日（SDK 日历）的本地时间 09:15 - 15:00（含午休）
     * @param state store 状态
     * @returns true 表示处于 A 股轮询窗口
     */
    isASharePollingWindow: (state: MarketStatusState): boolean => {
      // 依赖 clockTick 触发分钟级重算
      void state.clockTick;
      const now = new Date();
      const minutes = localMinutes(now);
      return (
        state.isTradingDay === true &&
        minutes >= A_SHARE_WINDOW_START &&
        minutes <= A_SHARE_WINDOW_END
      );
    },

    /**
     * A 股智能显示窗口（任务栏小组件「智能开启」消费）：本地时间 09:00 - 15:00（单段连续，含午休）
     *
     * 与 isASharePollingWindow 的差异：显示窗口比轮询窗口更宽（09:00 起，覆盖集合竞价前的
     * 看盘准备时段；轮询窗口 09:15 起）。**不用 status 判定** —— status 只随 refresh()
     * （每 10 分钟）重算，跨界最多滞后 10 分钟；本 getter 随 clockTick 每分钟重算。
     * 交易日历未就绪或拉取失败（isTradingDay === null）时按周一~周五近似放行，
     * 日历恢复后 refresh 自愈纠正。
     * @param state store 状态
     * @returns true 表示处于 A 股智能显示窗口
     */
    isAShareIntraday: (state: MarketStatusState): boolean => {
      // 依赖 clockTick 触发分钟级重算
      void state.clockTick;
      const now = new Date();
      const minutes = localMinutes(now);
      if (minutes < A_SHARE_SESSION_START || minutes >= A_SHARE_SESSION_END) {
        return false;
      }
      if (state.isTradingDay === null) {
        const day = localDay(now);
        return day >= 1 && day <= 5;
      }
      return state.isTradingDay;
    },

    /**
     * 美股行情轮询窗口（本地时间，SDK 日历不支持美股假日，按星期近似）：
     * 周一~周五 21:30 - 24:00，以及周二~周六凌晨 00:00 - 04:00
     * @param state store 状态
     * @returns true 表示处于美股轮询窗口
     */
    isUsPollingWindow: (state: MarketStatusState): boolean => {
      void state.clockTick;
      const now = new Date();
      const minutes = localMinutes(now);
      const day = localDay(now);
      if (minutes >= US_EVENING_START && minutes < US_EVENING_END) {
        // 周一 ~ 周五晚间
        return day >= 1 && day <= 5;
      }
      if (minutes <= US_MORNING_END) {
        // 凌晨窗口（对应前一交易日），仅周二 ~ 周六有效
        return day >= 2 && day <= 6;
      }
      return false;
    },
  },

  actions: {
    /**
     * 分钟级时钟 tick：驱动交易窗口 getter 随时间自动开关
     */
    tick(): void {
      this.clockTick = Date.now();
    },

    /**
     * 刷新市场状态：先拉交易日历（isTradingDay），再同步读时段状态
     *
     * 失败只降级记录，不抛出，避免打断调用方
     */
    async refresh(): Promise<void> {
      try {
        // marketStatus 为同步方法且依赖交易日历缓存，必须先 await isTradingDay
        this.isTradingDay = await fetchIsTradingDay();
        this.status = getMarketStatus();
        this.lastRefreshedAt = Date.now();
      } catch (error) {
        console.error('[market-status]', handleSdkError(error));
      }
    },
  },
});
