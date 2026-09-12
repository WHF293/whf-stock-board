/**
 * 轮询选项
 */
export interface PollingOptions {
  /**
   * 轮询任务
   *
   * 应使用 sdk.quotes / sdk.batch 合并批量请求，而非逐只循环调用
   */
  task: () => Promise<void>;
  /** 盘中轮询间隔（毫秒）；非交易时段由 tradingAware 决定是否降级 */
  intervalMs: number;
  /** 是否启用交易窗口治理：仅在所属市场轮询窗口内轮询，窗口外只请求一次 */
  tradingAware?: boolean;
  /** 所属市场（决定轮询窗口）：A 股 09:15-15:00；美股 21:30-24:00 与 00:00-04:00；默认 A */
  market?: 'A' | 'US';
  /** 启动时是否立即执行一次任务 */
  immediate?: boolean;
}

/**
 * usePolling 返回的手动控制句柄
 */
export interface UsePollingReturn {
  /** 暂停轮询 */
  pause: () => void;
  /** 恢复轮询（不立即执行任务） */
  resume: () => void;
}
