/**
 * MCP 运行时（内置 + 远端统一装配）
 *
 * 职责：
 * - 聚合内置 MCP（app-api / stock-sdk，进程内直调）与远端 MCP（mcp_server 表，
 *   streamable-http / sse，连接失败即跳过该服务器）；
 * - 把两者统一成 LangChain StructuredTool（供 deepagents 注入），并在调用前后
 *   经 `McpToolEventSink` 把「工具开始 / 结束」事件推给 UI（消息 parts 工具卡）；
 * - 提供 MCP Apps 资源解析（`ui://` → HTML）与 UI 反向调用（`tools/call`），
 *   并在这条链路上做**安全白名单**：只有资源声明的 `uiCallableTools` ∧ 条目标的
 *   `uiCallable` 同时允许，沙箱 iframe 才能触发调用（写库类工具一律为 false）。
 *
 * 为什么工具事件走 sink 而不是从流里解析：deepagents 内部把工具结果包装成
 * ToolMessage，`_meta` / `structuredContent` 在 LangGraph 流里不可靠；而我们自己
 * 包的工具壳天然知道入参、耗时与完整结果，直接回调是确定性最强的通道。
 */
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { isTauri } from '@tauri-apps/api/core';
import { type z } from 'zod';
import { listMcps } from '../../composables/use-agent-db';
import { APP_MCP_SERVER } from './app-tools';
import { MARKET_DATA_MCP_SERVER } from './market-tools';
import { STOCK_SDK_MCP_SERVER } from './stocksdk-tools';
import { connectRemoteMcp } from './remote';
import { UI_RESOURCE_PREFIX } from './constants';
import type {
  BuiltinMcpServer,
  McpCallToolResult,
  McpContentBlock,
  McpRuntime,
  McpServerAdapter,
  McpToolEndEvent,
  McpToolEntry,
  McpToolEventSink,
  McpUiResource,
} from './types';

/** 全部内置 MCP 服务器（顺序即管理弹窗展示顺序） */
export const BUILTIN_MCP_SERVERS: readonly BuiltinMcpServer[] = [
  APP_MCP_SERVER,
  STOCK_SDK_MCP_SERVER,
  MARKET_DATA_MCP_SERVER,
];

/** 运行期 server 条目：适配器 + 已列出的工具（内置即时，远端连接后缓存） */
interface ServerBucket {
  adapter: McpServerAdapter;
  tools: McpToolEntry[];
  resources: readonly McpUiResource[];
}

/** 本地生成工具调用 id（模型未给 tool_call id 时的兜底） */
let localCallSeq = 0;

/** 模块级运行时缓存（会话内复用；MCP 配置变更时经 resetMcpRuntime 失效） */
let runtimePromise: Promise<McpRuntime> | null = null;

/**
 * 内置服务器 → 适配器（资源静态声明，无需网络）
 * @param server 内置服务器声明
 * @returns 统一服务器适配器
 */
const toBuiltinAdapter = (server: BuiltinMcpServer): McpServerAdapter => ({
  key: server.key,
  resourceId: server.id,
  name: server.name,
  builtin: true,
  listTools: async () => server.tools,
  readUiResource: async (uri: string) =>
    server.uiResources?.find((resource) => resource.uri === uri) ?? null,
});

/**
 * 从 LangChain 工具运行上下文里取模型给的 tool_call id
 * @param config 工具运行上下文
 * @returns 调用 id；缺失返回 null
 */
const readToolCallId = (config?: unknown): string | null => {
  if (!config || typeof config !== 'object') return null;
  const call = (config as { toolCall?: { id?: unknown } }).toolCall;
  return call && typeof call.id === 'string' && call.id.length > 0 ? call.id : null;
};

/**
 * 内容块 → 模型可见文本（资源类块不进模型上下文，只留给 UI）
 * @param content MCP 内容块列表
 * @returns 拼接文本
 */
const joinModelText = (content: McpContentBlock[]): string => {
  const text = content
    .filter((block): block is Extract<McpContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return text.length > 0 ? text : '（该工具无文本结果，渲染见卡片）';
};

/**
 * 工具条目 → LangChain 工具（含事件回调与错误隔离）
 *
 * 错误不冒泡成整场运行失败：包装为 `{ isError: true, error }` 文本返还模型
 * 自行处理（MCP `CallToolResult.isError` 语义的进程内等价实现）。
 *
 * @param registeredName 注册给模型的工具名（冲突时已加 server 前缀）
 * @param serverKey 所属 server key（卡片徽标 / UI 反向调用定位用）
 * @param entry 工具条目
 * @param sink 事件接收器
 * @returns StructuredTool
 */
const toLangChainTool = (
  registeredName: string,
  serverKey: string,
  entry: McpToolEntry,
  sink: McpToolEventSink | null,
): StructuredToolInterface => {
  const boxed = tool(
    async (input: unknown, config?: unknown): Promise<string> => {
      localCallSeq += 1;
      const id = readToolCallId(config) ?? serverKey + '-local-' + String(localCallSeq);
      const argsText = JSON.stringify(input ?? {});
      const startedAt = Date.now();
      sink?.onStart({ id, serverKey, toolName: entry.definition.name, argsText });
      try {
        const signal = (config as { signal?: AbortSignal } | undefined)?.signal;
        const result = await entry.execute(input, signal);
        const text = joinModelText(result.content);
        const resourceUri =
          result._meta?.ui?.resourceUri ?? entry.definition._meta?.ui?.resourceUri ?? null;
        const payload = result.structuredContent;
        sink?.onEnd({
          id,
          state: result.isError === true ? 'error' : 'success',
          resultText: text,
          durationMs: Date.now() - startedAt,
          ...(result.isError !== true && resourceUri && payload
            ? { ui: { resourceUri, payload } }
            : {}),
        });
        return result.isError === true ? JSON.stringify({ isError: true, error: text }) : text;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const end: McpToolEndEvent = {
          id,
          state: 'error',
          resultText: message,
          durationMs: Date.now() - startedAt,
        };
        sink?.onEnd(end);
        return JSON.stringify({ isError: true, error: message });
      }
    },
    {
      name: registeredName,
      description: '[' + serverKey + '] ' + entry.definition.description,
      schema: entry.schema as z.ZodObject,
    },
  );
  return boxed;
};

/**
 * 读出每个 server 的工具与资源（远端连接失败只影响该 server）
 * @param adapters 统一适配器列表
 * @returns server 条目列表
 */
const buildBuckets = async (adapters: McpServerAdapter[]): Promise<ServerBucket[]> => {
  const buckets: ServerBucket[] = [];
  for (const adapter of adapters) {
    try {
      const tools = await adapter.listTools();
      buckets.push({ adapter, tools, resources: [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[mcp] 服务器 ' + adapter.key + ' 不可用，已跳过：' + message);
    }
  }
  return buckets;
};

/**
 * 读取已启用的远端 MCP 服务器（非 Tauri / 读库失败时返回空数组）
 * @returns 远端连接参数列表
 */
const loadRemoteConfigs = async (): Promise<Awaited<ReturnType<typeof listMcps>>> => {
  if (!isTauri()) return [];
  try {
    const rows = await listMcps();
    return rows.filter((row) => row.enabled);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[mcp] 读取远端 MCP 配置失败：' + message);
    return [];
  }
};

/**
 * 创建 MCP 运行时（内置 + 已启用的远端）
 * @returns MCP 运行时句柄
 */
const createRuntime = async (): Promise<McpRuntime> => {
  // 非 Tauri（浏览器）：内置工具依赖 SQLite / 直连网络，沿用既有约定不装配
  // （MCP Apps 资源解析同受此门控——没有工具就不会有卡片）
  const builtinAdapters = isTauri() ? BUILTIN_MCP_SERVERS.map(toBuiltinAdapter) : [];
  const remoteConfigs = await loadRemoteConfigs();
  const remoteAdapters: McpServerAdapter[] = [];
  for (const config of remoteConfigs) {
    try {
      remoteAdapters.push(
        await connectRemoteMcp({
          id: config.id,
          name: config.name,
          transport: config.transport,
          url: config.url,
          headers: config.headers,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[mcp] 远端 MCP「' + config.name + '」连接失败，已跳过：' + message);
    }
  }

  const buckets = await buildBuckets([...builtinAdapters, ...remoteAdapters]);
  const usedNames = new Set<string>();

  /**
   * 注册名去重：内置保持原名（提示词 / 文档里写的就是它），
   * 后到的重名工具加 server 前缀，避免模型看到两个同名工具。
   * @param serverKey 所属 server
   * @param name 工具原名
   * @returns 注册给模型的名字
   */
  const registerName = (serverKey: string, name: string): string => {
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
    const prefixed = serverKey + '__' + name;
    usedNames.add(prefixed);
    return prefixed;
  };

  const createTools = (sink: McpToolEventSink): unknown[] => {
    const tools: StructuredToolInterface[] = [];
    for (const bucket of buckets) {
      for (const entry of bucket.tools) {
        tools.push(
          toLangChainTool(registerName(bucket.adapter.key, entry.definition.name), bucket.adapter.key, entry, sink),
        );
      }
    }
    return tools;
  };

  /**
   * 按 server key 分组创建工具（供子 agent 级 MCP 白名单按组授权）
   *
   * ⚠️ 注册名去重（registerName）带副作用：`createTools` 与 `createToolsByServer`
   * 必须**二选一**调用，否则同一批工具会被算两次去重，产生多余的前缀名。
   * 运行时的做法是只用分组版，再由调用方拍平成主 agent 需要的全集。
   *
   * @param sink 事件接收器
   * @returns serverKey → 该服务器的工具数组
   */
  const createToolsByServer = (
    sink: McpToolEventSink,
  ): Array<{ serverKey: string; resourceId: number; tools: StructuredToolInterface[] }> => {
    const groups: Array<{ serverKey: string; resourceId: number; tools: StructuredToolInterface[] }> = [];
    for (const bucket of buckets) {
      const list: StructuredToolInterface[] = [];
      for (const entry of bucket.tools) {
        list.push(
          toLangChainTool(registerName(bucket.adapter.key, entry.definition.name), bucket.adapter.key, entry, sink),
        );
      }
      groups.push({ serverKey: bucket.adapter.key, resourceId: bucket.adapter.resourceId, tools: list });
    }
    return groups;
  };

  /**
   * 按 server key 找 bucket
   * @param serverKey 服务器 key
   * @returns bucket；不存在返回 null
   */
  const findBucket = (serverKey: string): ServerBucket | null =>
    buckets.find((bucket) => bucket.adapter.key === serverKey) ?? null;

  /**
   * 解析 ui:// 资源：解析 server key 后交给对应适配器
   * @param uri 资源地址
   * @returns UI 资源；不允许 / 不存在返回 null
   */
  const readUiResource = async (uri: string): Promise<McpUiResource | null> => {
    if (!uri.startsWith(UI_RESOURCE_PREFIX)) return null;
    const rest = uri.slice(UI_RESOURCE_PREFIX.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    const bucket = findBucket(rest.slice(0, slash));
    if (!bucket) return null;
    const resource = await bucket.adapter.readUiResource(uri);
    if (!resource) return null;
    if (resource.mimeType !== 'text/html;profile=mcp-app') return null;
    return { ...resource, html: resource.html };
  };

  const callUiTool = async (
    uri: string,
    toolName: string,
    args: unknown,
  ): Promise<McpCallToolResult> => {
    const bucket = findBucket(uri.slice(UI_RESOURCE_PREFIX.length).split('/')[0] ?? '');
    if (!bucket) throw new Error('未知的 MCP App 来源：' + uri);
    const resource = await bucket.adapter.readUiResource(uri);
    const allowlist = resource?.uiCallableTools;
    if (allowlist && !allowlist.includes(toolName)) {
      throw new Error('该 App 不允许调用工具 ' + toolName);
    }
    const entry = bucket.tools.find((item) => item.definition.name === toolName);
    if (!entry) throw new Error('工具不存在：' + toolName);
    if (entry.uiCallable !== true) throw new Error('该工具不允许由界面调用：' + toolName);
    return entry.execute(args);
  };

  return {
    createTools,
    createToolsByServer,
    serverKeys: buckets.map((bucket) => bucket.adapter.key),
    readUiResource,
    callUiTool,
    dispose: async () => {
      for (const bucket of buckets) {
        if (bucket.adapter.close) await bucket.adapter.close();
      }
    },
  };
};

/**
 * 取 MCP 运行时（会话内缓存的单例；连接失败只影响单台服务器）
 * @returns MCP 运行时句柄
 */
export const getMcpRuntime = async (): Promise<McpRuntime> => {
  runtimePromise ??= createRuntime();
  try {
    return await runtimePromise;
  } catch (error) {
    runtimePromise = null; // 失败不污染缓存，下次重试
    throw error;
  }
};

/**
 * 失效运行时缓存（MCP 配置变更后调用：下次运行重新连接）
 * @returns 无
 */
export const resetMcpRuntime = async (): Promise<void> => {
  const pending = runtimePromise;
  runtimePromise = null;
  if (!pending) return;
  try {
    const runtime = await pending;
    await runtime.dispose();
  } catch {
    // 缓存里本就是失败的 Promise：无需释放
  }
};
