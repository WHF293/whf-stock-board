/**
 * 定时任务 JSON → 表单草稿（「导入 JSON」的解析与校验边界）
 *
 * 校验从紧：kind / version 必须匹配、字段逐个验型验范围，任何一步不过都给
 * 中文错误文案（toast 直接展示），不静默兜底——错贴了别的 JSON 应当显式失败。
 */
import {
  SCHEDULE_DURATION_KEYS,
  SCHEDULE_JSON_KIND,
  SCHEDULE_JSON_VERSION,
} from '@/constants/schedule.constants';
import type { ScheduleDurationKey, ScheduleFormInput, ScheduleType } from '@/types/schedule.types';

/** 解析结果：成功给可直接回填表单 / createTask 的入参，失败给中文原因 */
export type ParseScheduleJsonResult =
  | { ok: true; form: ScheduleFormInput }
  | { ok: false; error: string };

/** 合法周期取值（导入 JSON 的 scheduleType 白名单） */
const SCHEDULE_TYPES: readonly ScheduleType[] = ['daily', 'weekly', 'trading_day'];

/**
 * 周期取值收窄（unknown → ScheduleType | null）
 * @param value 原始值
 * @returns 合法周期；不合法返回 null
 */
const asScheduleType = (value: unknown): ScheduleType | null =>
  typeof value === 'string' && (SCHEDULE_TYPES as readonly string[]).includes(value)
    ? (value as ScheduleType)
    : null;

/**
 * 有效期档位收窄（unknown → ScheduleDurationKey | null）
 * @param value 原始值
 * @returns 合法档位；不合法返回 null
 */
const asDurationKey = (value: unknown): ScheduleDurationKey | null =>
  typeof value === 'string' && (SCHEDULE_DURATION_KEYS as readonly string[]).includes(value)
    ? (value as ScheduleDurationKey)
    : null;

/**
 * 正整数范围校验
 * @param value 原始值
 * @param min 下限（含）
 * @param max 上限（含）
 * @returns 是否为范围内的整数
 */
const isIntInRange = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/**
 * 解析定时任务 JSON 文案
 * @param text 剪贴板 / 手工粘贴的 JSON 文案
 * @returns 成功给 ScheduleFormInput（weekday 仅 weekly 有值，其余为 null）；失败给中文错误
 */
export function parseScheduleTaskJson(text: string): ParseScheduleJsonResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: '剪贴板内容不是合法 JSON' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'JSON 结构不正确：应为单个任务对象' };
  }
  const record = data as Record<string, unknown>;
  if (record.kind !== SCHEDULE_JSON_KIND) {
    return { ok: false, error: '不是本应用的定时任务 JSON（kind 不匹配）' };
  }
  if (record.version !== SCHEDULE_JSON_VERSION) {
    return { ok: false, error: `任务 JSON 版本不支持（期望 v${SCHEDULE_JSON_VERSION}）` };
  }
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
  if (!name || !prompt) {
    return { ok: false, error: '任务 JSON 缺少名称或内容' };
  }
  const scheduleType = asScheduleType(record.scheduleType);
  if (scheduleType === null) {
    return { ok: false, error: '执行周期不正确（应为 daily / trading_day / weekly）' };
  }
  if (!isIntInRange(record.hour, 0, 23) || !isIntInRange(record.minute, 0, 59)) {
    return { ok: false, error: '执行时间不正确（hour 0-23、minute 0-59）' };
  }
  let weekday: number | null = null;
  if (scheduleType === 'weekly') {
    if (!isIntInRange(record.weekday, 0, 6)) {
      return { ok: false, error: '每周执行日不正确（weekday 应为 0-6，0=周日）' };
    }
    // 已过 isIntInRange 校验，断言回 number 安全
    weekday = record.weekday as number;
  }
  const durationKey = asDurationKey(record.durationKey);
  if (durationKey === null) {
    return { ok: false, error: '有效期档位不正确（应为 1w / 1m / 3m / 6m）' };
  }
  return {
    ok: true,
    // hour / minute / weekday 均已过 isIntInRange 校验，断言回 number 安全
    form: {
      name,
      prompt,
      scheduleType,
      hour: record.hour as number,
      minute: record.minute as number,
      weekday,
      durationKey,
    },
  };
}
