import { readFileSync, writeFileSync } from 'node:fs';
import type { Connect, Plugin } from 'vite';

/** 同源代理路径（前端 MCP 客户端统一 POST 此路径） */
export const TZZB_MCP_PROXY_PATH = '/tzzb-mcp';

/** 上游透传的请求头（MCP 会话 / 协议版本 / 鉴权 / SSE 续传） */
const PASSTHROUGH_HEADERS = [
  'authorization',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
] as const;

/** 上游回传给浏览器的响应头 */
const RESPONSE_HEADERS = ['mcp-session-id', 'mcp-protocol-version'] as const;

/** 上游超时（MCP 工具调用可能较慢，放宽到 60s） */
const UPSTREAM_TIMEOUT_MS = 60_000;

/**
 * 凭据文件形态（.ai/项目资源/tzzb-mcp/oauth.local.json，由
 * tzzb-auth-helper.mjs 维护；gitignore 覆盖不入库）
 */
interface TzzbAuthFile {
  /** 动态注册的客户端信息（client_id / client_secret） */
  registration?: { client_id?: string; client_secret?: string };
  /** OAuth token（access_token / refresh_token / expires_at 毫秒时间戳） */
  tokens?: { access_token?: string; refresh_token?: string; expires_at?: number };
}

/**
 * 凭据读取与刷新（tokenFile 未配置时全部为 no-op）
 * @param target 上游 MCP endpoint（派生 token endpoint）
 * @param tokenFile 凭据文件路径（oauth.local.json）
 * @returns getAccessToken 取可用 token / refresh 强制续期
 */
const createAuthProvider = (target: string | undefined, tokenFile: string | undefined) => {
  /** token endpoint（上游 origin + /oauth2/token） */
  const TOKEN_ENDPOINT = target ? new URL('/oauth2/token', target).toString() : '';

  /**
   * 读凭据文件
   * @returns 凭据对象；文件缺失返回 null
   */
  const load = (): TzzbAuthFile | null => {
    if (!tokenFile) return null;
    try {
      return JSON.parse(readFileSync(tokenFile, 'utf-8')) as TzzbAuthFile;
    } catch {
      return null;
    }
  };

  /**
   * 用 refresh_token 续期并回写凭据文件
   * @returns 新 access token；续期失败返回 null
   */
  const refresh = async (): Promise<string | null> => {
    const store = load();
    const refreshToken = store?.tokens?.refresh_token;
    const clientId = store?.registration?.client_id;
    const clientSecret = store?.registration?.client_secret;
    if (!tokenFile || !refreshToken || !clientId || !clientSecret || !TOKEN_ENDPOINT) return null;
    try {
      const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as Record<string, unknown>;
      const accessToken = json['access_token'];
      if (typeof accessToken !== 'string') return null;
      const expiresIn = Number(json['expires_in'] ?? 3600);
      store.tokens = {
        ...store.tokens,
        access_token: accessToken,
        refresh_token:
          typeof json['refresh_token'] === 'string'
            ? (json['refresh_token'] as string)
            : refreshToken,
        expires_at: Date.now() + (expiresIn - 60) * 1000,
      };
      writeFileSync(tokenFile, JSON.stringify(store, null, 2));
      return accessToken;
    } catch {
      return null;
    }
  };

  /**
   * 取当前可用的 access token（过期先续期）
   * @returns Bearer token；无凭据返回 null
   */
  const getAccessToken = async (): Promise<string | null> => {
    const store = load();
    const token = store?.tokens?.access_token;
    if (!token) return null;
    if ((store.tokens?.expires_at ?? 0) > Date.now() + 60_000) return token;
    return (await refresh()) ?? token;
  };

  return { getAccessToken, refresh };
};

/**
 * 读取并拼接请求体（POST JSON / SSE 续传都需要原样透传）
 * @param req 入站请求流
 * @returns 请求体字节
 */
const readRequestBody = (req: Connect.IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

/**
 * 创建投资账本 MCP 同源代理中间件
 *
 * 浏览器直连外部 MCP 会被 CORS 拦（Streamable HTTP 要求自定义头 + OPTIONS 预检），
 * dev/preview server 以同源路径反向代理到上游 MCP endpoint：
 * - 目标地址来自 .env.local 的 VITE_TZZB_MCP_URL（经 vite.config loadEnv 注入，
 *   **上游域名绝不写进入库源码**，构建产物只含同源路径）；
 * - 鉴权：优先凭据文件（TZZB_MCP_TOKEN_FILE，oauth.local.json，由
 *   tzzb-auth-helper.mjs 维护，401 自动 refresh_token 续期重试），其次静态 token；
 * - 方法固定透传 POST（MCP Streamable HTTP 仅用 POST + 可选 GET 流）；
 * - MCP 会话头双向透传（client → upstream 的 Mcp-Session-Id，upstream → client 的
 *   下发头）；响应体流式回写，SSE 渐进输出不被缓冲卡死
 * @param target 上游 MCP endpoint（未配置时中间件返回 503）
 * @param token 可选静态 Bearer token（.env.local 的 VITE_TZZB_MCP_TOKEN）
 * @param tokenFile 可选凭据文件路径（.env.local 的 TZZB_MCP_TOKEN_FILE）
 * @param auth 凭据提供器（取 token / 续期）
 * @returns Connect 兼容中间件
 */
const createTzzbMcpMiddleware =
  (
    target: string | undefined,
    token: string | undefined,
    tokenFile: string | undefined,
    auth: ReturnType<typeof createAuthProvider>,
  ): Connect.NextHandleFunction =>
  async (req, res, _next) => {
    if (!target) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'TZZB_MCP_NOT_CONFIGURED' }));
      return;
    }
    try {
      const body = await readRequestBody(req);
      const buildHeaders = async (): Promise<Record<string, string>> => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        };
        const bearer = (await auth.getAccessToken()) ?? token;
        if (bearer) headers.Authorization = `Bearer ${bearer}`;
        for (const name of PASSTHROUGH_HEADERS) {
          const value = req.headers[name];
          if (typeof value === 'string') headers[name] = value;
        }
        return headers;
      };
      const doFetch = async () =>
        fetch(target, {
          method: 'POST',
          headers: await buildHeaders(),
          body,
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      let upstream = await doFetch();
      // token 失效：凭据文件存在时刷新续期后重试一次
      if (upstream.status === 401 && tokenFile) {
        await auth.refresh();
        upstream = await doFetch();
      }
      res.statusCode = upstream.status;
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      for (const name of RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      // 流式回写：SSE 事件到达即推给浏览器，不整体缓冲
      const reader = upstream.body?.getReader();
      if (!reader) {
        res.end();
        return;
      }
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (error) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'TZZB_MCP_UPSTREAM_FAILED', message: String(error) }));
    }
  };

/**
 * Vite 插件：dev / preview server 挂载投资账本 MCP 同源代理
 * @param target 上游 MCP endpoint（来自 .env.local；未配置时不挂载）
 * @param token 可选静态 Bearer token
 * @param tokenFile 可选凭据文件路径（优先于静态 token）
 * @returns Vite 插件对象
 */
export const tzzbMcpProxyPlugin = (target?: string, token?: string, tokenFile?: string): Plugin => {
  const auth = createAuthProvider(target, tokenFile);
  const middleware = createTzzbMcpMiddleware(target, token, tokenFile, auth);
  return {
    name: 'tzzb-mcp-proxy',
    configureServer(server) {
      server.middlewares.use(TZZB_MCP_PROXY_PATH, middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(TZZB_MCP_PROXY_PATH, middleware);
    },
  };
};
