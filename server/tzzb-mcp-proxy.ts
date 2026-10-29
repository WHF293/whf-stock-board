import { createServer as createHttpServer, type Server } from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Connect, Plugin } from 'vite';

/** 同源代理路径（前端 MCP 客户端统一 POST 此路径） */
export const TZZB_MCP_PROXY_PATH = '/tzzb-mcp';

/** 授权信息子路径（GET <TZZB_MCP_PROXY_PATH>/auth-info；仅本地 dev server 提供，不透传上游） */
export const TZZB_MCP_AUTH_INFO_PATH = '/auth-info';

/** 鉴权启动子路径（POST <TZZB_MCP_PROXY_PATH>/auth-start；仅本地 dev server 提供，不透传上游） */
export const TZZB_MCP_AUTH_START_PATH = '/auth-start';

/** 鉴权回调回环端口（与 tzzb-auth-helper.mjs 同一注册 redirect_uri，复用已有 registration） */
const REDIRECT_PORT = 8791;

/** OAuth 回调地址（loopback；上游 registration 白名单里就是它，勿改） */
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

/** 鉴权流整体超时（毫秒）：浏览器登录 + 确认授权给 5 分钟足够 */
const AUTH_FLOW_TIMEOUT_MS = 300_000;

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
  registration?: {
    client_id?: string;
    client_secret?: string;
    /** 客户端注册时间（秒级时间戳；授权时间缺记录时的回落值） */
    client_id_issued_at?: number;
  };
  /** OAuth token（access_token / refresh_token / expires_at 毫秒时间戳） */
  tokens?: { access_token?: string; refresh_token?: string; expires_at?: number } | null;
  /** 最近一次完整浏览器授权完成时间（毫秒；tzzb-auth-helper.mjs 授权成功后落盘） */
  authorized_at?: number;
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

  /**
   * 取最近一次完整授权时间（上游授权有效期 1 个月，看板顶栏据此提示重授时点）
   * @returns 毫秒时间戳：优先凭据文件的 authorized_at（tzzb-auth-helper.mjs 完整授权后落盘），
   *          未记录时回落客户端注册时间 client_id_issued_at；无凭据文件返回 null
   */
  const getAuthorizedAt = (): number | null => {
    const store = load();
    const authorizedAt = typeof store?.authorized_at === 'number' ? store.authorized_at : 0;
    const issuedAt =
      typeof store?.registration?.client_id_issued_at === 'number'
        ? store.registration.client_id_issued_at * 1000
        : 0;
    return authorizedAt || issuedAt || null;
  };

  return { getAccessToken, refresh, getAuthorizedAt };
};

/** 鉴权启动响应（POST /tzzb-mcp/auth-start 的 200 响应体） */
interface TzzbAuthStartResult {
  /** 浏览器打开的同花顺授权页地址（调用方负责拉起系统浏览器） */
  authorizeUrl: string;
}

/**
 * 浏览器鉴权流启动器（与 .ai/项目资源/tzzb-mcp/tzzb-auth-helper.mjs 同一套流程）
 *
 * PKCE S256 + loopback 8791 回调：auth-start 返回授权页地址后，回调监听与
 * code 交换在后台进行；凭据（含 authorized_at）落盘同一份 oauth.local.json，
 * 完成后 auth-info 的 authorizedAt 前进、前端轮询即感知。
 *
 * @param target 上游 MCP endpoint（派生 origin 与 oauth2 端点）
 * @param tokenFile 凭据文件路径（oauth.local.json；未配置时 start 直接报错）
 * @returns start 启动一次鉴权流（进行中重复调用报 AUTH_FLOW_IN_PROGRESS）
 */
const createAuthFlowStarter = (target: string | undefined, tokenFile: string | undefined) => {
  /** 上游 origin（oauth2 端点根） */
  const ORIGIN = target ? new URL(target).origin : '';
  /** 是否有进行中的鉴权流（单飞：重复点击不重复占回调端口） */
  let active = false;
  /** 最近一次鉴权流失败原因（成功 / 重新发起时清空；auth-info 透出给前端快速失败） */
  let lastAuthError: string | null = null;

  /**
   * 读凭据文件
   * @returns 凭据对象；文件缺失 / 损坏返回空结构
   */
  const loadStore = (): TzzbAuthFile => {
    try {
      return JSON.parse(readFileSync(tokenFile as string, 'utf-8')) as TzzbAuthFile;
    } catch {
      return {};
    }
  };

  /**
   * token 表单请求
   * @param url token endpoint
   * @param body 表单字段
   * @returns 响应 JSON；非 2xx 抛错（含上游错误摘要）
   */
  const postForm = async (url: string, body: Record<string, string>): Promise<Record<string, unknown>> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
      body: new URLSearchParams(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`token endpoint ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  };

  /**
   * 动态注册授权码客户端（已有 registration 则跳过）
   * @param store 凭据对象（注册成功后回写并落盘）
   * @returns 客户端注册信息
   */
  const ensureRegistration = async (store: TzzbAuthFile): Promise<NonNullable<TzzbAuthFile['registration']>> => {
    if (store.registration) return store.registration;
    const res = await fetch(`${ORIGIN}/oauth2/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({
        client_name: 'whf-stock-board-dev-authcode',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        redirect_uris: [REDIRECT_URI],
      }),
    });
    const reg = (await res.json().catch(() => ({}))) as NonNullable<TzzbAuthFile['registration']>;
    if (!reg.client_id) throw new Error(`注册失败: ${JSON.stringify(reg).slice(0, 300)}`);
    store.registration = reg;
    writeFileSync(tokenFile as string, JSON.stringify(store, null, 2));
    return reg;
  };

  /**
   * 起回调监听并等待授权回调
   * @param server 回环 HTTP server（调用方负责 close）
   * @returns 授权回调 URL（含 code / state 或 error）
   */
  const waitCallback = (server: Server): Promise<URL> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待授权超时')), AUTH_FLOW_TIMEOUT_MS);
      server.on('request', (req, res) => {
        const u = new URL(req.url ?? '/', REDIRECT_URI);
        if (u.pathname !== '/callback') {
          res.end('ok');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>授权成功</h2>可关闭此窗口，回到股票看板。');
        clearTimeout(timer);
        resolve(u);
      });
      server.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      server.listen(REDIRECT_PORT, '127.0.0.1');
    });

  /**
   * 启动一次鉴权流：注册（如需）→ PKCE → 起回调监听 → 返回授权页地址；
   * 浏览器完成授权后的 code 交换与落盘在本 promise 后台继续
   * @returns 授权页地址
   * @throws TZZB_MCP_NOT_CONFIGURED / AUTH_FLOW_IN_PROGRESS / 注册失败等
   */
  const start = async (): Promise<TzzbAuthStartResult> => {
    if (!target || !tokenFile) throw new Error('TZZB_MCP_NOT_CONFIGURED');
    if (active) throw new Error('AUTH_FLOW_IN_PROGRESS');
    active = true;
    lastAuthError = null;
    const server = createHttpServer();
    try {
      const store = loadStore();
      const reg = await ensureRegistration(store);
      const verifier = Buffer.from(crypto.randomBytes(48)).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const state = crypto.randomBytes(12).toString('hex');
      const authorizeUrl = new URL(`${ORIGIN}/oauth2/authorize`);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', String(reg.client_id));
      authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authorizeUrl.searchParams.set('code_challenge', challenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('state', state);

      // 返回授权页地址后，回调等待与 code 交换转后台（前端轮询 auth-info 感知结果）
      void waitCallback(server)
        .then(async (callbackUrl) => {
          server.close();
          const error = callbackUrl.searchParams.get('error');
          if (error) {
            throw new Error(`授权失败: ${error} ${callbackUrl.searchParams.get('error_description') ?? ''}`);
          }
          if (callbackUrl.searchParams.get('state') !== state) {
            throw new Error('state 不匹配，疑似 CSRF，中止');
          }
          const json = await postForm(`${ORIGIN}/oauth2/token`, {
            grant_type: 'authorization_code',
            code: callbackUrl.searchParams.get('code') ?? '',
            redirect_uri: REDIRECT_URI,
            client_id: String(reg.client_id),
            client_secret: String(reg.client_secret ?? ''),
            code_verifier: verifier,
          });
          if (typeof json['access_token'] !== 'string') throw new Error('token endpoint 未返回 access_token');
          store.tokens = {
            ...store.tokens,
            access_token: json['access_token'],
            refresh_token:
              typeof json['refresh_token'] === 'string'
                ? (json['refresh_token'] as string)
                : store.tokens?.refresh_token,
            expires_at: Date.now() + (Number(json['expires_in'] ?? 3600) - 60) * 1000,
          };
          // 仅完整浏览器授权时更新 authorized_at（顶栏授权时间展示口径，同 helper）
          store.authorized_at = Date.now();
          writeFileSync(tokenFile as string, JSON.stringify(store, null, 2));
        })
        .catch((err: unknown) => {
          lastAuthError = err instanceof Error ? err.message : String(err);
          server.close();
        })
        .finally(() => {
          active = false;
        });
      return { authorizeUrl: authorizeUrl.toString() };
    } catch (err) {
      server.close();
      active = false;
      if (err instanceof Error && err.message === '等待授权超时') {
        lastAuthError = err.message;
      }
      throw err;
    }
  };

  return { start, getLastError: (): string | null => lastAuthError };
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
 *   例外：GET <同源路径>/auth-info 与 POST <同源路径>/auth-start 为本地端点
 *   （授权时间 / 发起浏览器鉴权，不透传上游）；
 * - MCP 会话头双向透传（client → upstream 的 Mcp-Session-Id，upstream → client 的
 *   下发头）；响应体流式回写，SSE 渐进输出不被缓冲卡死
 * @param target 上游 MCP endpoint（未配置时中间件返回 503）
 * @param token 可选静态 Bearer token（.env.local 的 VITE_TZZB_MCP_TOKEN）
 * @param tokenFile 可选凭据文件路径（.env.local 的 TZZB_MCP_TOKEN_FILE）
 * @param auth 凭据提供器（取 token / 续期）
 * @param authFlow 浏览器鉴权流启动器（auth-start 用）
 * @returns Connect 兼容中间件
 */
const createTzzbMcpMiddleware =
  (
    target: string | undefined,
    token: string | undefined,
    tokenFile: string | undefined,
    auth: ReturnType<typeof createAuthProvider>,
    authFlow: ReturnType<typeof createAuthFlowStarter>,
  ): Connect.NextHandleFunction =>
  async (req, res, _next) => {
    // 本地元信息端点：GET /tzzb-mcp/auth-info 返回最近一次授权时间 + 鉴权流失败原因
    //（不透传上游；MCP Streamable HTTP 客户端仅用 POST，GET 分支空闲可用）
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === TZZB_MCP_AUTH_INFO_PATH) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ authorizedAt: auth.getAuthorizedAt(), authError: authFlow.getLastError() }));
      return;
    }
    // 本地鉴权端点：POST /tzzb-mcp/auth-start 发起浏览器鉴权流（返回授权页地址，
    // 回调与 code 交换在 dev server 后台进行，前端轮询 auth-info 感知结果）
    if (req.method === 'POST' && (req.url ?? '').split('?')[0] === TZZB_MCP_AUTH_START_PATH) {
      try {
        const result = await authFlow.start();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const known = message === 'AUTH_FLOW_IN_PROGRESS' || message === 'TZZB_MCP_NOT_CONFIGURED';
        res.statusCode = known ? 409 : 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }
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
  const authFlow = createAuthFlowStarter(target, tokenFile);
  const middleware = createTzzbMcpMiddleware(target, token, tokenFile, auth, authFlow);
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
