/**
 * MCP Apps UI 载荷体积守卫（工具卡持久化前的瘦身）
 *
 * 载荷只服务卡片内的沙箱渲染、不回灌模型上下文；超限时整体丢弃、
 * 卡片退化为纯文本形态，避免消息表被大结果撑爆。
 */
import { MCP_UI_PAYLOAD_MAX_BYTES } from '@/agent/mcp/constants';

/**
 * 判定 UI 载荷是否可持久化（超限或不可序列化返回 null）
 * @param payload 工具结构化结果
 * @returns 可持久化的载荷；不可持久化返回 null
 */
export function guardUiPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  try {
    return JSON.stringify(payload).length > MCP_UI_PAYLOAD_MAX_BYTES ? null : payload;
  } catch {
    return null;
  }
}
