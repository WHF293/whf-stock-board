/**
 * 运行环境快照采集（系统版本 / WebView 内核 / UA 等）
 *
 * 每条日志都冗余带上环境信息，排查时不必再问「你什么系统、什么版本、什么内核」。
 *
 * 系统版本口径：
 * - Windows：优先读 UA-CH 的 `platformVersion`（`13.x` 及以上 = Windows 11，
 *   10 及以下 = Windows 10）——纯 UA 串里 Win10/Win11 都是 `Windows NT 10.0`，
 *   只有高熵提示值能区分；
 * - 采集函数是同步的（日志写入路径不能等异步），高熵值由 `enrichWeblogEnv()`
 *   在启动后异步补齐，之后的记录即带上系统版本。
 */
import { isTauri } from '@tauri-apps/api/core';
import { APP_VERSION } from '../constants/app-info.constants';
import {
  WEBLOG_RUNTIME_BROWSER,
  WEBLOG_RUNTIME_TAURI,
  WEBLOG_WIN11_MIN_PLATFORM_MAJOR,
} from '../constants/weblog.constants';
import type { WeblogEnvInfo } from '../types/weblog.types';

/** UA-CH 高熵提示字段名 */
const PLATFORM_VERSION_HINT = 'platformVersion';

/** 浏览器可选的 UA 客户端提示接口（TS 标准库未收录，这里按需声明） */
interface UserAgentDataLike {
  /** 平台名（Windows / macOS / Linux…） */
  platform?: string;
  /** 获取高熵提示值 */
  getHighEntropyValues?: (hints: string[]) => Promise<{ platformVersion?: string }>;
}

/** 可变的环境快照（高熵值补齐后原地更新） */
const env: WeblogEnvInfo = {
  appVersion: APP_VERSION,
  runtime: isTauri() ? WEBLOG_RUNTIME_TAURI : WEBLOG_RUNTIME_BROWSER,
  osName: 'Unknown',
  osVersion: '',
  ua: '',
  webview: '',
  screen: '',
  sessionId: '',
};

/**
 * 生成会话标识（本次启动唯一；无 crypto.randomUUID 时退化为时间戳随机串）
 * @returns 会话 id
 */
const createSessionId = (): string => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

/**
 * 解析操作系统名与版本
 * @param ua 完整 User-Agent
 * @param platform UA-CH platform（可能为空）
 * @param platformVersion UA-CH platformVersion（可能为空）
 * @returns 系统名与版本号
 */
const resolveOs = (
  ua: string,
  platform: string,
  platformVersion: string,
): { osName: string; osVersion: string } => {
  const major = Number.parseInt(platformVersion.split('.')[0] ?? '', 10);
  if (/windows/i.test(platform) || /windows/i.test(ua)) {
    if (Number.isFinite(major) && major > 0) {
      return {
        osName: major >= WEBLOG_WIN11_MIN_PLATFORM_MAJOR ? 'Windows 11' : 'Windows 10',
        osVersion: platformVersion,
      };
    }
    return { osName: 'Windows', osVersion: '' };
  }
  if (/mac/i.test(platform) || /mac os x/i.test(ua)) {
    return { osName: 'macOS', osVersion: platformVersion };
  }
  if (/android/i.test(ua)) {
    return { osName: 'Android', osVersion: platformVersion };
  }
  if (/iphone|ipad|ios/i.test(ua)) {
    return { osName: 'iOS', osVersion: platformVersion };
  }
  if (/linux/i.test(platform) || /linux/i.test(ua)) {
    return { osName: 'Linux', osVersion: platformVersion };
  }
  return { osName: platform || 'Unknown', osVersion: platformVersion };
};

/**
 * 解析渲染内核（WebView2 / Chrome 版本号）
 * @param ua 完整 User-Agent
 * @returns 内核描述；无法识别时为空串
 */
const resolveWebview = (ua: string): string => {
  const edge = /Edg\/([\d.]+)/.exec(ua);
  if (edge) return `WebView2 ${edge[1]}`;
  const chrome = /Chrome\/([\d.]+)/.exec(ua);
  if (chrome) return `Chrome ${chrome[1]}`;
  const firefox = /Firefox\/([\d.]+)/.exec(ua);
  if (firefox) return `Firefox ${firefox[1]}`;
  const safari = /Version\/([\d.]+).*Safari/.exec(ua);
  if (safari) return `Safari ${safari[1]}`;
  return '';
};

/**
 * 解析屏幕信息（宽x高@像素比）
 * @returns 屏幕描述；取不到时为空串
 */
const resolveScreen = (): string => {
  if (typeof window === 'undefined' || !window.screen) return '';
  const { width, height } = window.screen;
  const ratio = window.devicePixelRatio || 1;
  return `${width}x${height}@${ratio}`;
};

/**
 * 初始化环境快照（模块加载即执行一次，保证首条日志就有环境信息）
 */
const initEnv = (): void => {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const uaData = (navigator as Navigator & { userAgentData?: UserAgentDataLike })
    .userAgentData;
  const platform = uaData?.platform ?? '';
  const os = resolveOs(ua, platform, '');
  env.ua = ua;
  env.osName = os.osName;
  env.osVersion = os.osVersion;
  env.webview = resolveWebview(ua);
  env.screen = resolveScreen();
  env.sessionId = createSessionId();
};

initEnv();

/**
 * 取当前环境快照（同步）
 * @returns 环境快照副本
 */
export const getWeblogEnv = (): WeblogEnvInfo => ({ ...env });

/**
 * 异步补齐高熵提示值（platformVersion），补 Windows 10/11 的区分能力
 *
 * 失败静默（浏览器不支持 UA-CH 时属正常情况）。
 * @returns 补齐完成 Promise
 */
export const enrichWeblogEnv = async (): Promise<void> => {
  const uaData = (navigator as Navigator & { userAgentData?: UserAgentDataLike })
    .userAgentData;
  if (!uaData?.getHighEntropyValues) return;
  try {
    const hints = await uaData.getHighEntropyValues([PLATFORM_VERSION_HINT]);
    const platformVersion = hints.platformVersion ?? '';
    if (!platformVersion) return;
    const os = resolveOs(env.ua, uaData.platform ?? '', platformVersion);
    env.osName = os.osName;
    env.osVersion = os.osVersion;
  } catch {
    // 高熵提示不可用（权限 / 兼容性）不影响日志采集，静默跳过
  }
};
