/**
 * MCP 服务器配置 JSON 解析（粘贴导入）
 *
 * 兼容两种形态：
 * 1. 标准多服务器格式：`{ "mcpServers": { <name>: { url, headers, transport|type, ... } } }`
 *    （Claude Desktop / 各类客户端通用的 mcpServers 约定）
 * 2. 单服务器对象：`{ name?, url, headers?, transport? }`
 *
 * 仅接受 HTTP 形态（streamable-http / sse）：stdio 条目（command/args）跳过并记录原因。
 */
import type { McpTransport } from '@/types/agent.types';

/** 解析出的单台服务器 */
export interface ParsedMcpServer {
  name: string;
  transport: McpTransport;
  url: string;
  headers: Record<string, string> | null;
}

/** 解析结果：成功条目 + 跳过原因（展示给用户） */
export interface ParsedMcpJson {
  servers: ParsedMcpServer[];
  skipped: string[];
}

/**
 * 归一化传输方式字段：transport / type 里的各种写法 → 内部枚举；不认识返回 null
 * @param raw 原始字段值
 * @returns 内部传输枚举；无法识别为 null
 */
const normalizeTransport = (raw: unknown): McpTransport | null => {
  if (typeof raw !== 'string') return null;
  const value = raw.toLowerCase();
  if (value === 'sse') return 'sse';
  if (value === 'http' || value === 'streamable-http' || value === 'streamablehttp') {
    return 'streamable-http';
  }
  return null;
};

/**
 * 解析单个服务器定义对象
 * @param name 服务器名（来自 mcpServers 键或对象自身 name）
 * @param def 定义对象
 * @returns 服务器；不合法返回跳过原因字符串
 */
const parseServer = (name: string, def: unknown): ParsedMcpServer | string => {
  if (!def || typeof def !== 'object' || Array.isArray(def)) {
    return name + '：定义不是对象';
  }
  const record = def as Record<string, unknown>;
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!url) return name + '：缺少 url（stdio 命令型不支持，仅支持 HTTP/SSE）';
  const transport =
    normalizeTransport(record.transport) ?? normalizeTransport(record.type) ?? 'streamable-http';
  let headers: Record<string, string> | null = null;
  if (record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers)) {
    headers = record.headers as Record<string, string>;
  }
  const displayName = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : name;
  return { name: displayName, transport, url, headers };
};

/**
 * 解析粘贴的 JSON 文本
 * @param text JSON 文本
 * @returns 解析结果；整体不是合法 JSON / 不含服务器定义时 servers 为空
 */
export const parseMcpJsonText = (text: string): ParsedMcpJson => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON 根节点必须是对象');
  }
  const root = parsed as Record<string, unknown>;

  // 形态 1：{ mcpServers: {...} }
  if (root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers)) {
    const servers: ParsedMcpServer[] = [];
    const skipped: string[] = [];
    for (const [key, def] of Object.entries(root.mcpServers as Record<string, unknown>)) {
      const result = parseServer(key, def);
      if (typeof result === 'string') skipped.push(result);
      else servers.push(result);
    }
    return { servers, skipped };
  }

  // 形态 2：单服务器对象
  if (typeof root.url === 'string') {
    const result = parseServer('mcp-server', root);
    return typeof result === 'string'
      ? { servers: [], skipped: [result] }
      : { servers: [result], skipped: [] };
  }

  throw new Error('未识别的格式：需要 { "mcpServers": {...} } 或含 url 的单服务器对象');
};
