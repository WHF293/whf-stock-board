import { reactive } from 'vue';
import type { NetworkTapEvent } from '../../common/api/network-tap.ts';
import { detectApiSource } from '../../common/utils/detect-api-source.ts';
import { DEBUG_BODY_MAX_CHARS, DEBUG_NETWORK_MAX_RECORDS } from '../constants';

/**
 * 调试网络面板 · 请求记录器（移动端专属，纯内存态）
 *
 * 经 common/api/network-tap 挂在 proxy-fetch 单一收口上，捕获全部 fetch 型
 * 上游请求（Tauri 的 plugin-http 直连与浏览器的 /stock-proxy 都收口于此）；
 * JSONP 类源（script 注入）不经该收口，本记录器抓不到。
 *
 * 响应体只读副本（response.clone()），不影响 SDK 的原始字节透传语义；
 * 解码先按 UTF-8 严格模式，失败回退 GBK（腾讯源为 GBK）。
 */

/** 单条网络请求记录（响应体异步回填：先出条目、body 随后补齐） */
export interface NetworkDebugRecord {
  /** 自增序号（列表 key） */
  id: number;
  /** 发起时刻（Date.now 毫秒） */
  startedAt: number;
  /** 耗时毫秒 */
  durationMs: number;
  /** 请求方法（大写） */
  method: string;
  /** 上游完整地址 */
  url: string;
  /** 主机名（列表展示用，URL 解析失败时等于原串） */
  host: string;
  /** 路径 + 查询串（列表展示用） */
  path: string;
  /** 数据源标注（腾讯 / 东财 / 同花顺…） */
  source: string;
  /** HTTP 状态码（传输层失败为 null） */
  status: number | null;
  /** 是否 2xx */
  ok: boolean;
  /** 失败原因（成功为 null） */
  error: string | null;
  /** 响应体文本（截断后；未就绪 / 无响应体为 null） */
  body: string | null;
  /** 响应体是否被截断 */
  bodyTruncated: boolean;
  /** 响应体是否仍在异步读取中 */
  bodyPending: boolean;
}

/** 记录仓库（reactive：列表与单条 body 回填都对 UI 响应式） */
const state = reactive<{ records: NetworkDebugRecord[] }>({ records: [] });

/** 供面板消费的响应式记录列表（最新在前） */
export const networkDebugRecords = state.records;

let seq = 0;

/**
 * 拆 URL 为主机名与路径段（列表两行展示用）
 * @param url 上游完整地址
 * @returns { host, path }；解析失败时 host 为原串、path 为空
 */
const splitTarget = (url: string): { host: string; path: string } => {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: `${parsed.pathname}${parsed.search}` };
  } catch {
    return { host: url, path: '' };
  }
};

/**
 * 解码响应体：先 UTF-8 严格模式（JSON 源绝大多数是 UTF-8），
 * 解码失败（含 GBK 等多字节错位）回退 GBK —— 与 SDK 对腾讯源的解码约定一致
 * @param buffer 原始响应字节
 * @returns 解码文本；两种解码都不可用时返回空串
 */
const decodeBody = (buffer: ArrayBuffer): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch {
      return '';
    }
  }
};

/**
 * 把读取完成的响应体回填进记录（超长截断）
 * @param record 目标记录
 * @param buffer 响应体字节
 */
const fillBody = (record: NetworkDebugRecord, buffer: ArrayBuffer): void => {
  const text = decodeBody(buffer);
  record.bodyPending = false;
  record.bodyTruncated = text.length > DEBUG_BODY_MAX_CHARS;
  record.body = record.bodyTruncated
    ? `${text.slice(0, DEBUG_BODY_MAX_CHARS)}\n\n…（超出 ${DEBUG_BODY_MAX_CHARS} 字符已截断）`
    : text;
};

/**
 * 异步读取响应副本并回填（clone 不影响原响应交给 SDK 消费）
 * @param record 目标记录
 * @param response 原始响应（本函数内部 clone）
 */
const readBodyOf = (record: NetworkDebugRecord, response: Response): void => {
  void response.clone()
    .arrayBuffer()
    .then(
      (buffer) => fillBody(record, buffer),
      () => {
        record.bodyPending = false;
        record.body = null;
      },
    );
};

/**
 * 未知错误 → 可展示文案
 * @param error catch 到的值
 * @returns 错误消息文本
 */
const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 网络旁路回调（经 debug-mode 注册到 setNetworkTap；勿直接调用）
 * @param event proxy-fetch 收口广播的请求事件
 */
export const handleNetworkTapEvent = (event: NetworkTapEvent): void => {
  seq += 1;
  const { host, path } = splitTarget(event.url);
  const record: NetworkDebugRecord = {
    id: seq,
    startedAt: event.startedAt,
    durationMs: event.durationMs,
    method: event.method,
    url: event.url,
    host,
    path,
    source: detectApiSource(event.url),
    status: event.status,
    ok: event.ok,
    error: event.error === undefined ? null : toErrorMessage(event.error),
    body: null,
    bodyTruncated: false,
    bodyPending: event.response !== undefined,
  };
  state.records.unshift(record);
  if (state.records.length > DEBUG_NETWORK_MAX_RECORDS) {
    state.records.length = DEBUG_NETWORK_MAX_RECORDS;
  }
  if (event.response !== undefined) readBodyOf(record, event.response);
};

/** 清空全部记录（面板「清空」按钮） */
export const clearNetworkDebugRecords = (): void => {
  state.records.length = 0;
};
