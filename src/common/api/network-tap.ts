/**
 * 上游请求旁路钩子（调试网络面板等观察方的注册点）
 *
 * proxy-fetch 在每次上游请求收口时同步广播事件；未注册观察者时
 * notify 只是一次空判，零开销 —— PC 端与正常运行不注册即完全无感。
 *
 * 注册方（如移动端调试 network-recorder）约定：
 * - 需要响应体时只可 `response.clone()` 读副本，不得消费原响应
 *   （SDK 依赖原始字节透传按 GBK 解码，见 proxy-fetch 顶部说明）；
 * - 回调在请求关键路径上同步执行，内部不得做重活，重活自行转异步。
 */

/** 上游请求旁路事件（成功带 response，失败带 error，二者互斥） */
export interface NetworkTapEvent {
  /** 上游真实地址（非代理转发地址） */
  url: string;
  /** 请求方法（大写） */
  method: string;
  /** 发起时刻（Date.now 毫秒） */
  startedAt: number;
  /** 耗时毫秒（成功 / 失败均已确定） */
  durationMs: number;
  /** HTTP 状态码（传输层失败为 null） */
  status: number | null;
  /** 是否成功响应（2xx） */
  ok: boolean;
  /** 原始响应对象（仅成功时存在；观察者只可 clone） */
  response?: Response;
  /** 失败原因（仅失败时存在） */
  error?: unknown;
}

/** 旁路观察者回调 */
export type NetworkTap = (event: NetworkTapEvent) => void;

/** 当前唯一观察者（单槽：调试面板是唯一消费场景，避免多观察者扇出复杂度） */
let tap: NetworkTap | null = null;

/**
 * 注册 / 替换旁路观察者
 * @param fn 观察者回调；传 null 表示注销
 * @returns 注销函数（重复调用安全，只注销自己注册的那次）
 */
export const setNetworkTap = (fn: NetworkTap | null): (() => void) => {
  tap = fn;
  return () => {
    if (tap === fn) tap = null;
  };
};

/**
 * 广播一次上游请求事件（proxy-fetch 内部消费，业务代码勿直接调用）
 * @param event 事件载荷
 */
export const notifyNetworkTap = (event: NetworkTapEvent): void => {
  tap?.(event);
};
