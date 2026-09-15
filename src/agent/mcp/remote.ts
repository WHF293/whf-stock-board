/**
 * 远端 MCP 客户端（streamable-http / sse）
 *
 * 为什么直接用 `@modelcontextprotocol/sdk` 而不是 `@langchain/mcp-adapters`：
 * 1. LangChain 适配层只保留工具文本，会丢掉 `_meta.ui` / `structuredContent`
 *    ——而 MCP Apps 渲染恰恰依赖这两样；
 * 2. 适配层内部自建 transport，**无法注入 fetch**。桌面端 webview 的 fetch
 *    受 CORS 限制（远端 MCP 服务器通常不带 CORS 头），必须换 tauri-plugin-http
 *    走 Rust 直连；SDK 的 transport 支持 `fetch` 选项，这是唯一无需改上游的路径。
 *
 * 于是远端与内置共用 `McpToolEntry` 抽象：都是「入参 schema + execute → CallToolResult」，
 * 内置为进程内直调，远端为 tools/call 请求。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauri } from '@tauri-apps/api/core';
import { z } from 'zod';
import type { McpCallToolResult, McpContentBlock, McpServerAdapter, McpToolEntry, McpUiResource } from './types';

/** 建立连接超时（毫秒）——服务器不可达时不拖死整场 agent 运行 */
const CONNECT_TIMEOUT_MS = 8000;

/** 单次工具调用超时（毫秒） */
const CALL_TIMEOUT_MS = 30000;

/** UI 资源 HTML 体积上限（字节）：防止远端把巨型资源塞进渲染管线 */
const MAX_UI_HTML_BYTES = 1_500_000;

/** 远端 MCP 连接参数（由 mcp_server 表映射而来） */
export interface RemoteMcpConfig {
  /** mcp_server.id（用于生成稳定 key 与诊断） */
  id: number;
  /** 展示名 */
  name: string;
  /** 传输方式 */
  transport: 'streamable-http' | 'sse';
  /** 服务地址 */
  url: string;
  /** 附加请求头（鉴权等） */
  headers: Record<string, string> | null;
}

/** 网络实现：桌面端走 Rust 直连（绕 CORS），浏览器回退原生 fetch */
const netFetch: typeof globalThis.fetch = isTauri()
  ? (tauriFetch as unknown as typeof globalThis.fetch)
  : globalThis.fetch;

/**
 * 给 Promise 加超时（超时后拒绝，调用方按「该服务器不可用」跳过）
 * @param promise 原 Promise
 * @param ms 超时毫秒
 * @param label 超时错误里的标识
 * @returns 原 Promise 结果
 */
const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' 超时（' + ms + 'ms）')), ms);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
};

/**
 * MCP 内容块 → 内部内容块（image / audio 等富媒体暂不支持，直接丢弃）
 * @param block SDK 原始内容块
 * @returns 内部内容块；不支持的类型返回 null
 */
const toContentBlock = (block: unknown): McpContentBlock | null => {
  if (!block || typeof block !== 'object') return null;
  const raw = block as Record<string, unknown>;
  if (raw.type === 'text' && typeof raw.text === 'string') return { type: 'text', text: raw.text };
  if (raw.type === 'resource_link' && typeof raw.uri === 'string') {
    return {
      type: 'resource_link',
      uri: raw.uri,
      ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
      ...(typeof raw.mimeType === 'string' ? { mimeType: raw.mimeType } : {}),
    };
  }
  if (raw.type === 'resource' && raw.resource && typeof raw.resource === 'object') {
    const inner = raw.resource as Record<string, unknown>;
    if (typeof inner.uri === 'string' && typeof inner.text === 'string') {
      return {
        type: 'resource',
        resource: { uri: inner.uri, mimeType: String(inner.mimeType ?? 'text/plain'), text: inner.text },
      };
    }
  }
  return null;
};

/**
 * 提取结果上的 MCP Apps 资源声明（`_meta.ui.resourceUri`）
 * @param meta SDK 结果的 _meta
 * @returns 资源地址；无声明返回 null
 */
const readUiResourceUri = (meta: unknown): string | null => {
  if (!meta || typeof meta !== 'object') return null;
  const ui = (meta as Record<string, unknown>).ui;
  if (!ui || typeof ui !== 'object') return null;
  const uri = (ui as Record<string, unknown>).resourceUri;
  return typeof uri === 'string' && uri.length > 0 ? uri : null;
};

/**
 * SDK CallToolResult → 内部 McpCallToolResult
 * @param raw SDK 原始结果
 * @returns 内部结果（content 给模型 / structuredContent 给 UI）
 */
const toCallToolResult = (raw: unknown): McpCallToolResult => {
  const source = (raw ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(source.content)
    ? source.content.map(toContentBlock).filter((block): block is McpContentBlock => block !== null)
    : [];
  const resourceUri = readUiResourceUri(source._meta);
  const structured = source.structuredContent;
  return {
    content: blocks.length > 0 ? blocks : [{ type: 'text', text: '（服务器返回空结果）' }],
    ...(structured && typeof structured === 'object'
      ? { structuredContent: structured as Record<string, unknown> }
      : {}),
    isError: source.isError === true,
    ...(resourceUri ? { _meta: { ui: { resourceUri } } } : {}),
  };
};

/**
 * 连接一个远端 MCP 服务器
 *
 * 失败（不可达 / 握手失败 / 超时）时抛错，由调用方决定是否跳过该服务器
 * ——单个服务器不可用不应让整场 agent 运行失败。
 *
 * @param config 连接参数
 * @returns 统一服务器适配器
 */
export const connectRemoteMcp = async (config: RemoteMcpConfig): Promise<McpServerAdapter> => {
  const url = new URL(config.url);
  const headers = config.headers ?? {};
  const transport =
    config.transport === 'sse'
      ? new SSEClientTransport(url, {
          requestInit: { headers },
          eventSourceInit: { fetch: netFetch as unknown as typeof globalThis.fetch },
          fetch: netFetch as never,
        })
      : new StreamableHTTPClientTransport(url, {
          requestInit: { headers },
          fetch: netFetch as never,
        });

  const client = new Client({ name: 'whf-stock-board', version: '2.1.0' }, { capabilities: {} });
  const key = 'remote:' + String(config.id);

  await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, '连接 ' + config.name);
  await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, '列出 ' + config.name + ' 工具');

  const listTools = async (): Promise<McpToolEntry[]> => {
    const result = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, '列出 ' + config.name + ' 工具');
    const tools = Array.isArray(result.tools) ? result.tools : [];
    const entries: McpToolEntry[] = [];
    for (const tool of tools) {
      const meta = (tool as { _meta?: Record<string, unknown> })._meta;
      const ui = meta?.ui as { resourceUri?: unknown; visibility?: unknown } | undefined;
      const visibility = Array.isArray(ui?.visibility) ? (ui?.visibility as string[]) : null;
      // MCP Apps：声明了 visibility 且不含 model 的工具只服务 UI，不暴露给模型
      if (visibility && !visibility.includes('model')) continue;
      const resourceUri = typeof ui?.resourceUri === 'string' ? ui.resourceUri : null;
      entries.push({
        definition: {
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: (tool.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
          ...(resourceUri ? { _meta: { ui: { resourceUri } } } : {}),
        },
        // 远端入参校验交给服务器（schema 在服务端是权威），本地用宽松对象放行
        schema: z.record(z.string(), z.unknown()),
        uiCallable: true,
        execute: async (input, signal): Promise<McpCallToolResult> => {
          const result = await withTimeout(
            client.callTool(
              { name: tool.name, arguments: (input ?? {}) as Record<string, unknown> },
              undefined,
              signal ? { signal } : undefined,
            ),
            CALL_TIMEOUT_MS,
            '调用 ' + tool.name,
          );
          return toCallToolResult(result);
        },
      });
    }
    return entries;
  };

  const readUiResource = async (uri: string): Promise<McpUiResource | null> => {
    try {
      const result = await withTimeout(
        client.readResource({ uri }),
        CONNECT_TIMEOUT_MS,
        '读取资源 ' + uri,
      );
      const contents = Array.isArray(result.contents) ? result.contents : [];
      const first = contents[0] as { uri?: string; mimeType?: string; text?: string } | undefined;
      if (!first || typeof first.text !== 'string') return null;
      const mime = String(first.mimeType ?? '');
      // 只接受 HTML（MCP Apps 固定形态），其余资源类型没有渲染器
      if (!mime.startsWith('text/html')) return null;
      if (first.text.length > MAX_UI_HTML_BYTES) return null;
      return {
        uri,
        name: uri,
        mimeType: 'text/html;profile=mcp-app',
        html: first.text,
      };
    } catch {
      return null; // 资源不存在 / 拉取失败：退回纯文本卡片
    }
  };

  return {
    key,
    name: config.name,
    builtin: false,
    listTools,
    readUiResource,
    close: async () => {
      try {
        await client.close();
      } catch {
        // 关闭失败无补救动作（连接已不可用）
      }
    },
  };
};
