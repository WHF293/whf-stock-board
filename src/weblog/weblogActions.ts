/**
 * 埋点 / 报错采集执行器（对外唯一写入 API）
 *
 * 对外导出：
 * - `trackAction`        记录一条行为（页面显示、按钮点击、业务操作…）
 * - `trackPageView`      记录页面显示（路由消费方调用）
 * - `trackApiRequest`    记录接口请求（api/proxy-fetch.ts 调用）
 * - `reportError`        记录一条报错（全局错误钩子与业务兜底调用）
 * - `setWeblogEnabled`   采集开关（设置页消费）
 * - `flushWeblog`        立即把待写队列落库（页面刷新 / 退出前调用）
 *
 * 写入路径：内存队列攒批（1.5s 或满 30 条）→ 批量 INSERT，同时进内存环形缓冲，
 * 因此日志页能立刻看到刚发生的操作；非 Tauri（浏览器 dev）只留内存，不报错。
 *
 * ⚠️ 内部失败一律 `console.warn`：console.error 已被错误采集钩住，
 * 用 error 级别会形成「写日志失败 → 记一条错误 → 又写日志」的自激循环。
 */
import {
  WEBLOG_CLICK_FALLBACK_DELAY_MS,
  WEBLOG_DEDUPE_CACHE_MAX,
  WEBLOG_DEDUPE_WINDOW_MS,
  WEBLOG_ENABLED_DEFAULT,
  WEBLOG_FLUSH_BATCH_SIZE,
  WEBLOG_FLUSH_INTERVAL_MS,
  WEBLOG_MESSAGE_MAX,
  WEBLOG_STACK_MAX,
} from '../constants/weblog.constants';
import { formatDateTime } from '../utils/format-datetime';
import { truncateText } from '../utils/truncate-text';
import { resolveActionDef, resolvePageActionKey } from './weblogActions.enum';
import { getWeblogEnv } from './weblog-env';
import { nextMemoryId, persistActionLogs, persistErrorLogs } from './weblog-store';
import type { WeblogActionKey } from './weblogActions.enum';
import type {
  WeblogActionDef,
  WeblogActionLog,
  WeblogErrorInput,
  WeblogErrorLog,
  WeblogLogStatus,
} from '../types/weblog.types';

/** 行为埋点可选补充信息 */
export interface TrackActionOptions {
  /** 操作目标（路由 path / 接口地址 / 元素摘要） */
  target?: string | null;
  /** 补充说明（JSON 字符串或短文本） */
  detail?: string | null;
  /** 耗时（毫秒） */
  durationMs?: number | null;
  /** 结果状态 */
  status?: WeblogLogStatus | null;
  /** 覆盖所在页面路由（默认取当前页面上下文） */
  pagePath?: string;
  /** 覆盖页面标题 */
  pageTitle?: string | null;
}

/** 接口请求埋点入参 */
export interface TrackApiRequestInput {
  /** 请求地址（上游原始 URL） */
  url: string;
  /** 请求方法（默认 GET） */
  method?: string;
  /** 耗时（毫秒） */
  durationMs: number;
  /** HTTP 状态码（网络层失败时为 null） */
  status?: number | null;
  /** 是否成功（含上游 200 但业务失败由调用方判定） */
  ok: boolean;
  /** 失败原因（ok=false 时传入） */
  error?: unknown;
}

/** 采集开关（运行期可切；设置页持久化在 settings store） */
let enabled = WEBLOG_ENABLED_DEFAULT;

/** 待落库的行为日志队列 */
const pendingActions: WeblogActionLog[] = [];

/** 待落库的报错日志队列 */
const pendingErrors: WeblogErrorLog[] = [];

/** 当前页面上下文（自动埋点写入，手动埋点作为默认值） */
let currentPagePath = '';
let currentPageTitle = '';

/** 链路 / 会话内递增序号（trace id 后半段） */
let traceSeq = 0;

/** 定时落库句柄（null = 未启动） */
let flushTimer: number | null = null;

/** 错误去重表：签名 → 上次记录时间 */
const dedupeMap = new Map<string, number>();

/**
 * 生成链路标识（SkyWalking traceId 的轻量等价物：会话前缀 + 递增序号）
 * @returns 形如 `a1b2c3d4-17` 的标识
 */
const createTraceId = (): string => {
  const env = getWeblogEnv();
  traceSeq += 1;
  return `${env.sessionId.slice(0, 8)}-${traceSeq.toString(36)}`;
};

/**
 * 采集开关当前状态
 * @returns 是否在采集
 */
export const isWeblogEnabled = (): boolean => enabled;

/**
 * 设置采集开关（关闭后仅系统类事件继续记录，保证「日志自身操作」可追溯）
 * @param value true 开启采集
 */
export const setWeblogEnabled = (value: boolean): void => {
  enabled = value;
};

/**
 * 更新当前页面上下文（页面切换时由自动埋点写入）
 * @param path 路由 path
 * @param title 页面标题
 */
export const setWeblogPageContext = (path: string, title: string): void => {
  currentPagePath = path;
  currentPageTitle = title;
};

/**
 * 取当前页面上下文
 * @returns 当前 path 与标题
 */
export const getWeblogPageContext = (): { path: string; title: string } => ({
  path: currentPagePath,
  title: currentPageTitle,
});

/**
 * 组装一条行为日志记录（补时间、环境快照、链路标识）
 * @param action 埋点 key
 * @param def 动作定义（分类与文案）
 * @param options 补充信息
 * @returns 完整行为记录
 */
const buildActionRecord = (
  action: string,
  def: WeblogActionDef,
  options: TrackActionOptions = {},
): WeblogActionLog => {
  const env = getWeblogEnv();
  const occurredAt = Date.now();
  return {
    id: nextMemoryId(),
    occurredAt,
    timeText: formatDateTime(occurredAt),
    action,
    category: def.category,
    label: def.label,
    target: options.target ?? null,
    detail: options.detail ? truncateText(options.detail, WEBLOG_MESSAGE_MAX) : null,
    pagePath: options.pagePath ?? currentPagePath,
    pageTitle: options.pageTitle ?? currentPageTitle ?? null,
    durationMs: options.durationMs ?? null,
    status: options.status ?? null,
    appVersion: env.appVersion,
    osName: env.osName,
    sessionId: env.sessionId,
    traceId: createTraceId(),
  };
};

/**
 * 组装一条报错日志记录
 * @param input 报错信息
 * @returns 完整报错记录
 */
const buildErrorRecord = (input: WeblogErrorInput): WeblogErrorLog => {
  const env = getWeblogEnv();
  const occurredAt = Date.now();
  return {
    id: nextMemoryId(),
    occurredAt,
    timeText: formatDateTime(occurredAt),
    level: input.level,
    kind: input.kind,
    message: truncateText(input.message, WEBLOG_MESSAGE_MAX) || '未知错误',
    stack: input.stack ? truncateText(input.stack, WEBLOG_STACK_MAX) : null,
    pagePath: input.pagePath,
    pageTitle: input.pageTitle ?? null,
    apiUrl: input.apiUrl ? truncateText(input.apiUrl, WEBLOG_MESSAGE_MAX) : null,
    apiStatus: input.apiStatus ?? null,
    durationMs: input.durationMs ?? null,
    appVersion: env.appVersion,
    runtime: env.runtime,
    osName: env.osName,
    osVersion: env.osVersion,
    ua: env.ua,
    webview: env.webview,
    screen: env.screen,
    traceId: createTraceId(),
    detail: input.detail ? truncateText(input.detail, WEBLOG_MESSAGE_MAX) : null,
  };
};

/**
 * 把待写队列落到库（队列为空时直接返回）
 * @returns 落库完成 Promise
 */
export const flushWeblog = async (): Promise<void> => {
  if (pendingActions.length === 0 && pendingErrors.length === 0) return;
  const actions = pendingActions.splice(0, pendingActions.length);
  const errors = pendingErrors.splice(0, pendingErrors.length);
  await persistActionLogs(actions);
  await persistErrorLogs(errors);
};

/**
 * 行为队列是否需要立即落库（达到攒批阈值）
 * @returns 是否达到阈值
 */
const shouldFlushNow = (): boolean => pendingActions.length >= WEBLOG_FLUSH_BATCH_SIZE;

/** 最近一次全局点击的序号（每次点击 +1） */
let clickSeq = 0;

/** 已被精准埋点认领的点击序号（该次点击的兜底作废） */
let claimedClickSeq = 0;

/** 待派发的点击兜底定时器（null = 无待派发记录） */
let pendingClickTimer: number | null = null;

/** 待派发兜底所属的点击序号 */
let pendingClickSeq = 0;

/**
 * 领一个点击序号（自动埋点在每次全局点击时调用）
 *
 * 序号是「取消兜底不误伤」的支点：延迟落地的精准埋点只认领**最近一次**点击，
 * 从而不会把上一次点击尚未派发的兜底一起取消（曾出现：点空白处 → 300ms 后点
 * 「查看系统日志」→ 两条记录都丢，因为 350ms 窗口内被后一次点击清掉了）。
 * @returns 本次点击的序号
 */
export const beginClickTracking = (): number => {
  clickSeq += 1;
  return clickSeq;
};

/**
 * 取消待派发的点击兜底记录（已被更精确的埋点覆盖）
 */
export const cancelPendingClickFallback = (): void => {
  if (pendingClickTimer !== null) {
    window.clearTimeout(pendingClickTimer);
    pendingClickTimer = null;
  }
};

/**
 * 认领待派发的兜底（仅当它属于最近一次点击）
 *
 * 延迟落地的精准埋点（如表格行单击/双击合并 250ms 后的「打开个股」）调用它：
 * 最近一次点击已有精确记录 → 其兜底作废。序号不等则说明这次精准埋点来自
 * 新的一次点击，不该动上一次点击的兜底。
 */
const claimPendingClickFallback = (): void => {
  if (pendingClickTimer !== null && pendingClickSeq === clickSeq) {
    claimedClickSeq = pendingClickSeq;
  }
};

/**
 * 记录一条行为日志
 * @param action 埋点 key（见 weblogActions.enum.ts 的 WEBLOG_ACTIONS）
 * @param options 补充信息（目标 / 详情 / 耗时 / 状态）
 */
export const trackAction = (
  action: WeblogActionKey | string,
  options: TrackActionOptions = {},
): void => {
  const def = resolveActionDef(action) ?? {
    key: action,
    category: 'business' as const,
    label: action,
  };
  // 关闭采集后系统类事件继续记录：否则用户关掉开关就再也看不到「开关被关」这件事
  if (!enabled && def.category !== 'system') return;
  // 已有更精确的埋点落地，认领同一次点击的兜底（api 类除外：
  // 请求完成时刻与点击无关，不应因它认领点击兜底）
  if (def.category !== 'api') claimPendingClickFallback();
  pendingActions.push(buildActionRecord(action, def, options));
  if (shouldFlushNow()) void flushWeblog();
};

/**
 * 派发点击兜底记录（延后 WEBLOG_CLICK_FALLBACK_DELAY_MS 执行）
 *
 * 全局点击监听用它：若这一次点击随后触发了更精确的埋点（data-track 枚举动作、
 * 业务显式上报、表格行的「打开个股」等），兜底会被认领作废 —— 一次点击只留一条记录。
 * @param options 埋点补充信息（目标摘要 / 说明）
 */
export const trackClickFallback = (options: TrackActionOptions = {}): void => {
  cancelPendingClickFallback();
  pendingClickSeq = beginClickTracking();
  pendingClickTimer = window.setTimeout(() => {
    pendingClickTimer = null;
    if (claimedClickSeq === pendingClickSeq) return;
    trackAction('CLICK_ELEMENT', options);
  }, WEBLOG_CLICK_FALLBACK_DELAY_MS);
};

/**
 * 记录页面显示（页面切换 / 首个页面渲染时调用）
 * @param path 路由 path
 * @param title 页面标题
 */
export const trackPageView = (path: string, title: string): void => {
  setWeblogPageContext(path, title);
  trackAction(resolvePageActionKey(path), { target: path, pagePath: path, pageTitle: title });
};

/**
 * 记录一次接口请求（成功与失败都记；失败额外落一条报错日志）
 * @param input 请求信息
 */
export const trackApiRequest = (input: TrackApiRequestInput): void => {
  const method = (input.method ?? 'GET').toUpperCase();
  const shortUrl = toShortUrl(input.url);
  trackAction('API_REQUEST', {
    target: `${method} ${shortUrl}`,
    detail: buildApiDetail(input),
    durationMs: Math.round(input.durationMs),
    status: input.ok ? 'ok' : 'fail',
    pagePath: currentPagePath,
  });
  if (!input.ok) {
    reportError({
      level: 'error',
      kind: 'api-error',
      message: `${method} ${shortUrl} 请求失败：${describeError(input.error, input.status)}`,
      stack: input.error instanceof Error ? input.error.stack ?? null : null,
      pagePath: currentPagePath,
      pageTitle: currentPageTitle,
      apiUrl: input.url,
      apiStatus: input.status ?? null,
      durationMs: Math.round(input.durationMs),
    });
  }
};

/**
 * URL 取「主机 + 路径」（去掉查询串，避免把长参数写进日志）
 * @param url 原始地址
 * @returns 精简后的地址
 */
const toShortUrl = (url: string): string => {
  try {
    const parsed = new URL(url, globalThis.location?.origin);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return truncateText(url, 120);
  }
};

/**
 * 组装接口请求的详情文本
 * @param input 请求信息
 * @returns JSON 字符串
 */
const buildApiDetail = (input: TrackApiRequestInput): string =>
  JSON.stringify({
    method: (input.method ?? 'GET').toUpperCase(),
    status: input.status ?? null,
    ok: input.ok,
    error: input.ok ? null : describeError(input.error, input.status),
  });

/**
 * 把抛出值 / 状态码描述成一句可读原因
 * @param error 抛出值
 * @param status HTTP 状态码
 * @returns 原因文案
 */
const describeError = (error: unknown, status?: number | null): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (status) return `HTTP ${status}`;
  return '未知原因';
};

/**
 * 错误去重判定：同一签名在窗口期内只记录一次
 * @param signature 去重签名
 * @returns true = 应跳过（重复）
 */
const isDuplicateError = (signature: string): boolean => {
  const now = Date.now();
  const last = dedupeMap.get(signature);
  if (last !== undefined && now - last < WEBLOG_DEDUPE_WINDOW_MS) return true;
  if (dedupeMap.size >= WEBLOG_DEDUPE_CACHE_MAX) {
    const oldest = dedupeMap.keys().next().value;
    if (oldest !== undefined) dedupeMap.delete(oldest);
  }
  dedupeMap.set(signature, now);
  return false;
};

/**
 * 记录一条报错日志
 *
 * 窗口期（60s）内「同来源 + 同文案 + 同页面」的错误只落一条：
 * 行情轮询失败会每几秒抛一次，不去重会把 3 天的库撑成几十万行的噪声。
 * @param input 报错信息
 */
export const reportError = (input: WeblogErrorInput): void => {
  const signature = `${input.kind}|${input.message}|${input.pagePath}|${input.apiUrl ?? ''}`;
  if (isDuplicateError(signature)) return;
  pendingErrors.push(buildErrorRecord({ ...input, pageTitle: input.pageTitle ?? currentPageTitle }));
};

/**
 * 应用启动时记录一条启动事件（便于确认「这个版本的用户真的跑起来过」）
 */
export const trackAppStart = (): void => {
  const env = getWeblogEnv();
  trackAction('APP_START', {
    target: env.runtime,
    detail: JSON.stringify({
      appVersion: env.appVersion,
      os: `${env.osName} ${env.osVersion}`.trim(),
      webview: env.webview,
      screen: env.screen,
    }),
    pagePath: currentPagePath,
  });
};

/**
 * 启动定时落库与「隐藏即落库」监听
 */
export const startWeblogFlush = (): void => {
  if (flushTimer === null) {
    flushTimer = window.setInterval(() => {
      void flushWeblog();
    }, WEBLOG_FLUSH_INTERVAL_MS);
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
};

/** 页面隐藏时立即落库（切到后台可能被系统冻结，攒批会丢） */
const onVisibilityChange = (): void => {
  if (document.visibilityState === 'hidden') void flushWeblog();
};

/**
 * 停止定时落库（独立窗口卸载时调用）
 */
export const stopWeblogFlush = (): void => {
  if (flushTimer !== null) {
    window.clearInterval(flushTimer);
    flushTimer = null;
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
};
