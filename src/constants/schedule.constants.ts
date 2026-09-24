/**
 * 定时任务（Agent 分析）常量
 */
import type { ScheduleDurationKey } from '@/types/schedule.types';

/** 心跳检查间隔（毫秒）：30s 保证分钟匹配不漂移漏检，last_run_at 同分钟去重防重复触发 */
export const SCHEDULE_TICK_MS = 30_000;

/** 历史窗口：任务会话送给模型的历史消息条数（与 ChatPanel 口径一致） */
export const SCHEDULE_HISTORY_LIMIT = 30;

/** 流式执行期间的落库 checkpoint 间隔（毫秒） */
export const SCHEDULE_CHECKPOINT_MS = 5000;

/**
 * 有效期档位 → 时长（毫秒）与展示文案
 *
 * 「1 月」按 30 天折算（自然月会导致 expires_at 随时区/夏令时漂移，固定天数口径稳定）
 */
export const SCHEDULE_DURATIONS: Readonly<Record<ScheduleDurationKey, { ms: number; label: string }>> = {
  '1w': { ms: 7 * 24 * 3600_000, label: '1 周' },
  '1m': { ms: 30 * 24 * 3600_000, label: '1 个月' },
  '3m': { ms: 90 * 24 * 3600_000, label: '3 个月' },
  '6m': { ms: 180 * 24 * 3600_000, label: '6 个月' },
};

/** 默认有效期档位（王总口径：默认一个月） */
export const SCHEDULE_DEFAULT_DURATION: ScheduleDurationKey = '1m';

/** 有效期档位顺序（表单档位按钮的渲染顺序） */
export const SCHEDULE_DURATION_KEYS: readonly ScheduleDurationKey[] = ['1w', '1m', '3m', '6m'];

/** 过期时间展示格式（任务卡片元信息） */
export const SCHEDULE_EXPIRY_FORMAT = 'YYYY-MM-DD HH:mm';

/** 每周执行日文案（下标 = weekday 值，0=周日） */
export const SCHEDULE_WEEKDAY_LABELS: readonly string[] = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 上次执行状态取值（agent_schedule.last_run_status）
 *
 * 'running' 由调度方触发时先写（同分钟去重靠 last_run_at）；终态由
 * schedule-runner 收尾覆写为 ok / error；session_missing / no_model 是
 * 调度侧前置校验的失败标记（没有进入运行链路）。
 */
export const SCHEDULE_RUN_STATUS = {
  /** 已触发、执行中 */
  running: 'running',
  /** 正常完成（含中断兜底；定时任务无停止入口） */
  ok: 'ok',
  /** 运行报错（详细错误在绑定会话的助手消息里） */
  error: 'error',
  /** 绑定会话已被删除（自动禁用任务） */
  sessionMissing: 'session_missing',
  /** 解析不出可用模型（会话 / 配置 / 默认三级都落空） */
  noModel: 'no_model',
} as const;
