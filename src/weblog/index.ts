/**
 * 系统日志模块入口（应用启动时调用 `initWeblog` 完成全部挂载）
 *
 * 一次 init 做四件事：
 * 1. 挂钩全局错误采集（js error / promise 拒绝 / Vue 异常 / console.error）；
 * 2. 挂载自动埋点（页面显示 + 全量点击兜底）；
 * 3. 启动攒批落库定时器与「页面隐藏即落库」监听；
 * 4. 按保留期裁剪历史日志（启动一次 + 定时一次），并记录一条启动事件。
 *
 * 独立 WebviewWindow（Agent 分析 / 新闻原文）也会走这里：各自 init 一次，
 * 日志写同一个 weblog.db（sessionId 不同，便于按窗口区分）。
 */
import type { App } from 'vue';
import type { Router } from 'vue-router';
import {
  WEBLOG_PRUNE_INTERVAL_MS,
  WEBLOG_RETENTION_MS,
} from '../constants/weblog.constants';
import { destroyWeblogAutoTrack, initWeblogAutoTrack } from './weblog-auto-track';
import { destroyWeblogErrorCapture, initWeblogErrorCapture } from './weblog-error';
import { enrichWeblogEnv } from './weblog-env';
import { pruneWeblogLogs } from './weblog-store';
import {
  setWeblogEnabled,
  startWeblogFlush,
  stopWeblogFlush,
  trackAction,
  trackAppStart,
} from './weblogActions';

/** 初始化入参 */
export interface InitWeblogOptions {
  /** Vue 应用实例（接管 config.errorHandler） */
  app: App;
  /** 路由实例（订阅页面切换） */
  router: Router;
  /** 采集开关初值（来自设置页持久化，缺省开启） */
  enabled?: boolean;
}

/** 裁剪定时器句柄 */
let pruneTimer: number | null = null;

/**
 * 按保留期裁剪日志，并记录裁剪结果（有条目被删才记，避免日志自身刷屏）
 * @returns 裁剪完成 Promise
 */
const pruneExpiredLogs = async (): Promise<void> => {
  const cutoff = Date.now() - WEBLOG_RETENTION_MS;
  const { errorDeleted, actionDeleted } = await pruneWeblogLogs(cutoff);
  if (errorDeleted + actionDeleted > 0) {
    trackAction('LOG_PRUNE', {
      target: `${WEBLOG_RETENTION_MS / (24 * 60 * 60 * 1000)}天`,
      detail: JSON.stringify({ errorDeleted, actionDeleted }),
    });
  }
};

/**
 * 初始化系统日志模块（应用启动调用一次）
 * @param options 入参（app / router / 开关初值）
 */
export const initWeblog = (options: InitWeblogOptions): void => {
  setWeblogEnabled(options.enabled ?? true);
  initWeblogErrorCapture(options.app);
  initWeblogAutoTrack(options.router);
  startWeblogFlush();
  trackAppStart();

  // 环境高熵值（系统版本）异步补齐：不阻塞首屏，补齐后新记录即带上
  void enrichWeblogEnv();

  // 保留期裁剪：启动先裁一次，之后每 30 分钟一次
  void pruneExpiredLogs();
  if (pruneTimer === null) {
    pruneTimer = window.setInterval(() => {
      void pruneExpiredLogs();
    }, WEBLOG_PRUNE_INTERVAL_MS);
  }
};

/**
 * 卸载系统日志模块（独立窗口关闭 / 热更新清理时调用）
 */
export const disposeWeblog = (): void => {
  destroyWeblogAutoTrack();
  destroyWeblogErrorCapture();
  stopWeblogFlush();
  if (pruneTimer !== null) {
    window.clearInterval(pruneTimer);
    pruneTimer = null;
  }
};

export {
  beginClickTracking,
  cancelPendingClickFallback,
  flushWeblog,
  getWeblogPageContext,
  isWeblogEnabled,
  reportError,
  setWeblogEnabled,
  setWeblogPageContext,
  trackAction,
  trackApiRequest,
  trackAppStart,
  trackClickFallback,
  trackPageView,
} from './weblogActions';
export type { TrackActionOptions, TrackApiRequestInput } from './weblogActions';
export {
  WEBLOG_ACTIONS,
  WEBLOG_CATEGORY_LABEL,
  WEBLOG_PAGE_ACTION_BY_PATH,
  isWeblogActionKey,
  resolveActionDef,
  resolveActionLabel,
  resolvePageActionKey,
} from './weblogActions.enum';
export type { WeblogActionKey } from './weblogActions.enum';
export {
  clearWeblogLogs,
  isWeblogPersisted,
  pruneWeblogLogs,
  queryActionLogs,
  queryErrorLogs,
  queryLogStats,
} from './weblog-store';
