/**
 * 定时任务 → 可迁移 JSON 文案（跨电脑搬运任务配置）
 *
 * 只导出「计划字段」：name / prompt / scheduleType / hour / minute / weekday /
 * durationKey。sessionId（各机器本地建）、expiresAt（导入按 durationKey 重新起算）、
 * enabled / lastRun*（运行态）都不导出。
 *
 * 结构：kind / version 打头做导入识别，任务字段平铺在顶层，人也能直接读改。
 */
import {
  SCHEDULE_JSON_KIND,
  SCHEDULE_JSON_VERSION,
} from '@/constants/schedule.constants';
import type { ScheduleTask } from '@/types/schedule.types';

/**
 * 任务 → JSON 文案（2 空格缩进，便于贴到聊天 / 文件里人工确认）
 * @param task 任务
 * @returns 形如 `{ "kind": "whf-stock-board/schedule-task", ... }` 的 JSON 文案
 */
export function scheduleTaskToJson(task: ScheduleTask): string {
  return JSON.stringify(
    {
      kind: SCHEDULE_JSON_KIND,
      version: SCHEDULE_JSON_VERSION,
      name: task.name,
      prompt: task.prompt,
      scheduleType: task.scheduleType,
      hour: task.hour,
      minute: task.minute,
      weekday: task.weekday,
      durationKey: task.durationKey,
    },
    null,
    2,
  );
}
