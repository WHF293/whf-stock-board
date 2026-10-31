/**
 * 给 Promise 套超时竞速（移动端频道加载兜底）
 *
 * 背景（2026-10-30 真机反馈）：横滑切 tab 后上游接口在弱网下 TCP 挂起不落地，
 * `ensureChannel` / `ensureBoard` 的 loading 永真 → 骨架屏无限等待且无出口。
 * 竞速超时后以 Error reject，走调用方既有 catch → 错误态（带「重新加载」按钮），
 * 保证 loading 必然复位。
 * @param promise 业务 Promise
 * @param ms 超时毫秒
 * @param label 超时报错文案（进错误态日志）
 * @returns 原 Promise 的结果；超时抛 Error
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
