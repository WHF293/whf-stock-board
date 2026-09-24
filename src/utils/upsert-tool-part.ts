/**
 * 工具卡块的按 callId 配对写入（消息 parts 维护）
 *
 * ChatPanel（对话流）与 schedule-runner（定时任务执行）共用同一份逻辑，
 * 保证两条链路的工具卡行为完全一致：开始事件先插「运行中」卡，结束事件
 * 按 callId 找到已有卡覆写终态。
 */
import type { ToolCallPart } from '@/types/agent.types';

/**
 * 向 parts 数组写入一张工具卡（存在同 callId 则增量覆盖，否则追加）
 * @param list 目标消息的 parts 数组
 * @param patch 写入字段（callId + toolName 为必需，其余增量覆盖）
 * @returns 该调用对应的卡片块
 */
export function upsertToolPart(
  list: ToolCallPart[],
  patch: Partial<ToolCallPart> & { callId: string; toolName: string },
): ToolCallPart {
  const existing = list.find((part) => part.callId === patch.callId);
  if (existing) {
    Object.assign(existing, patch);
    return existing;
  }
  const created: ToolCallPart = {
    type: 'tool_call',
    callId: patch.callId,
    toolName: patch.toolName,
    serverKey: patch.serverKey,
    state: patch.state ?? 'running',
    argsText: patch.argsText ?? '',
    resultText: patch.resultText,
    durationMs: patch.durationMs,
    ui: patch.ui,
  };
  list.push(created);
  return created;
}
