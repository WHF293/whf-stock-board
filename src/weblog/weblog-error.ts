/**
 * 全局错误采集（SkyWalking 浏览器探针的本地等价实现）
 *
 * 挂钩四条通道，覆盖前端能拿到的全部异常：
 * 1. `window.error`        运行时异常（含资源加载失败：img/script/link 等）
 * 2. `unhandledrejection`  未被 catch 的 Promise 拒绝
 * 3. `app.config.errorHandler` Vue 组件内异常（渲染 / 生命周期 / 事件回调）
 * 4. `console.error`       业务代码显式打出的错误（项目内 catch 分支大量使用）
 *
 * 为什么连 console.error 也钩：本项目错误处理范式是「catch 后 console.error 降级」，
 * 只钩运行时异常会漏掉绝大多数业务失败；重复刷屏由 reportError 的 60s 去重兜住。
 *
 * ⚠️ 本模块内部不得调用 console.error（会自激），失败一律 console.warn。
 */
import type { App } from 'vue';
import {
  WEBLOG_IGNORED_ERROR_PATTERNS,
  WEBLOG_MESSAGE_MAX,
  WEBLOG_UNKNOWN_PATH,
} from '../constants/weblog.constants';
import { truncateText } from '../utils/truncate-text';
import { getWeblogPageContext, reportError } from './weblogActions';

/** 资源类标签名（这些元素加载失败不会抛 JS 异常，只在捕获阶段报 error 事件） */
const RESOURCE_TAGS = ['IMG', 'SCRIPT', 'LINK', 'VIDEO', 'AUDIO', 'SOURCE'] as const;

/** 是否已挂载（重复调用直接返回，避免重复记录） */
let installed = false;

/** console.error 包装中的重入保护（避免 reportError 内部失败再触发） */
let capturing = false;

/** 原始 console.error（保留给开发者在控制台看，以及内部调用） */
let originalConsoleError: (...args: unknown[]) => void = () => {};

/**
 * 把任意抛出值描述成一句可读文案
 * @param value 抛出值
 * @returns 文案
 */
const describeUnknown = (value: unknown): string => {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '未知错误';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * 判断错误文案是否在忽略名单内
 * @param message 错误文案
 * @returns true = 忽略
 */
const isIgnoredMessage = (message: string): boolean =>
  WEBLOG_IGNORED_ERROR_PATTERNS.some((pattern) => pattern.test(message));

/**
 * 取当前页面路径（无上下文时给兜底文案）
 * @returns 页面 path
 */
const currentPath = (): string => getWeblogPageContext().path || WEBLOG_UNKNOWN_PATH;

/**
 * 取事件目标上的资源地址
 * @param target 事件目标元素
 * @returns 资源地址；非资源元素返回空串
 */
const pickResourceUrl = (target: Element): string => {
  const attr = target.getAttribute('src') ?? target.getAttribute('href') ?? '';
  return attr;
};

/**
 * window.error 处理：区分运行时异常与资源加载失败
 * @param event 错误事件
 */
const onWindowError = (event: ErrorEvent): void => {
  const target = event.target;
  if (target instanceof Element && (RESOURCE_TAGS as readonly string[]).includes(target.tagName)) {
    const url = pickResourceUrl(target);
    const message = `资源加载失败：<${target.tagName.toLowerCase()}> ${url}`;
    if (isIgnoredMessage(message)) return;
    reportError({
      level: 'warn',
      kind: 'resource-error',
      message,
      pagePath: currentPath(),
      detail: JSON.stringify({ tag: target.tagName.toLowerCase(), url }),
    });
    return;
  }
  const message = event.message || describeUnknown(event.error);
  if (!message || isIgnoredMessage(message)) return;
  reportError({
    level: 'error',
    kind: 'js-error',
    message,
    stack: event.error instanceof Error ? event.error.stack ?? null : null,
    pagePath: currentPath(),
    detail: JSON.stringify({ source: event.filename, line: event.lineno, column: event.colno }),
  });
};

/**
 * unhandledrejection 处理
 * @param event 拒绝事件
 */
const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
  const message = describeUnknown(event.reason);
  if (!message || isIgnoredMessage(message)) return;
  reportError({
    level: 'error',
    kind: 'unhandled-rejection',
    message,
    stack: event.reason instanceof Error ? event.reason.stack ?? null : null,
    pagePath: currentPath(),
  });
};

/**
 * console.error 包装：转发原始输出 + 采集一条错误日志
 * @param args 原始参数
 */
const onConsoleError = (...args: unknown[]): void => {
  originalConsoleError(...args);
  if (capturing) return;
  const message = truncateText(args.map(describeUnknown).join(' '), WEBLOG_MESSAGE_MAX);
  if (!message || isIgnoredMessage(message)) return;
  const stack = args.find((arg): arg is Error => arg instanceof Error)?.stack ?? null;
  capturing = true;
  try {
    reportError({
      level: 'error',
      kind: 'console-error',
      message,
      stack,
      pagePath: currentPath(),
    });
  } finally {
    capturing = false;
  }
};

/**
 * 挂载全局错误采集（应用启动时调用一次）
 * @param app Vue 应用实例（用于接管 config.errorHandler）
 */
export const initWeblogErrorCapture = (app: App): void => {
  if (installed) return;
  installed = true;

  originalConsoleError = console.error.bind(console);
  console.error = onConsoleError;

  window.addEventListener('error', onWindowError, true);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  // Vue 组件内异常：默认会打到控制台（已被上面的 console.error 捕获），
  // 这里显式接管以获得组件名与错误类型信息
  app.config.errorHandler = (error, _instance, info) => {
    const message = describeUnknown(error);
    if (!message || isIgnoredMessage(message)) return;
    reportError({
      level: 'fatal',
      kind: 'vue-error',
      message,
      stack: error instanceof Error ? error.stack ?? null : null,
      pagePath: currentPath(),
      detail: JSON.stringify({ info }),
    });
    originalConsoleError('[weblog] vue 异常', error, info);
  };
};

/**
 * 卸载全局错误采集（独立窗口关闭 / 热更新清理时调用）
 */
export const destroyWeblogErrorCapture = (): void => {
  if (!installed) return;
  installed = false;
  console.error = originalConsoleError;
  window.removeEventListener('error', onWindowError, true);
  window.removeEventListener('unhandledrejection', onUnhandledRejection);
};
