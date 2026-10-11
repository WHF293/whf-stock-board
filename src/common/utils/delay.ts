/**
 * 等待指定毫秒（用于错开对同一上游的连续请求，避免触发反爬）
 * @param ms 等待毫秒数
 * @returns 等待完成的 Promise
 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
