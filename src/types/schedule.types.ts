/**
 * 定时任务类型（Agent 分析 · agent_schedule 表映射）
 */

/** 调度周期类型（表列 schedule_type） */
export type ScheduleType = 'daily' | 'weekly';

/** 有效期档位（表列 duration_key；档位 → 时长折算见 schedule.constants.ts） */
export type ScheduleDurationKey = '1w' | '1m' | '3m' | '6m';

/** 定时任务（蛇形行 → 驼峰，见 use-agent-db.toScheduleTask） */
export interface ScheduleTask {
  /** 任务 id */
  id: number;
  /** 任务名（同时是绑定会话的标题） */
  name: string;
  /** 到期发送给 agent 的消息 */
  prompt: string;
  /** 绑定会话 id（执行结果都落在这个会话） */
  sessionId: number;
  /** 调度周期类型 */
  scheduleType: ScheduleType;
  /** 执行时刻 · 时（0-23，本机时区） */
  hour: number;
  /** 执行时刻 · 分（0-59，本机时区） */
  minute: number;
  /** 每周执行日（0=周日 … 6=周六；仅 weekly 有值） */
  weekday: number | null;
  /** 有效期档位 */
  durationKey: ScheduleDurationKey;
  /** 过期时间戳（毫秒；null = 永不过期，当前 UI 必选档位，不会为 null） */
  expiresAt: number | null;
  /** 是否启用（关闭后心跳跳过，配置保留） */
  enabled: boolean;
  /** 上次触发时间戳（毫秒；null = 从未执行） */
  lastRunAt: number | null;
  /** 上次执行结果状态（ok / error / session_missing / 其他错误说明） */
  lastRunStatus: string | null;
  /** 创建时间戳（毫秒） */
  createdAt: number;
  /** 更新时间戳（毫秒） */
  updatedAt: number;
}

/** 新建 / 编辑定时任务入参（表单字段；expiresAt 由 store 按档位折算，不收） */
export interface ScheduleFormInput {
  /** 任务名 */
  name: string;
  /** 到期发送给 agent 的消息 */
  prompt: string;
  /** 调度周期类型 */
  scheduleType: ScheduleType;
  /** 执行时刻 · 时（0-23） */
  hour: number;
  /** 执行时刻 · 分（0-59） */
  minute: number;
  /** 每周执行日（0-6；仅 weekly） */
  weekday: number | null;
  /** 有效期档位 */
  durationKey: ScheduleDurationKey;
}

/** 落库入参（store 建好会话、算好过期时间后交给 db 层；id 缺省 = 新建） */
export interface SaveScheduleInput extends ScheduleFormInput {
  /** 绑定会话 id */
  sessionId: number;
  /** 过期时间戳（毫秒；null = 永不过期） */
  expiresAt: number | null;
}
