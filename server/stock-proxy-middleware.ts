import type { Connect, Plugin } from 'vite';
import {
  PROXY_CACHE_MAX_ENTRIES,
  PROXY_CACHE_TTL_MS,
  PROXY_TIMEOUT_MS,
  STOCK_PROXY_ALLOWED_HOSTS,
  STOCK_PROXY_PATH,
} from '../src/constants/proxy.constants.ts';

/**
 * 代理短 TTL 缓存条目
 */
interface StockProxyCacheEntry {
  /** 响应体原始字节（不做任何解码，SDK 端按各源自身编码解析） */
  body: Uint8Array;
  /** 上游 Content-Type 原文 */
  contentType: string;
  /** 过期时间戳（毫秒） */
  expiresAt: number;
}

/** 同 URL 短 TTL 内存缓存：行情类请求 3 秒内命中直接回放，收敛上游压力 */
/** 浏览器 UA：同花顺等上游用 UA 反爬，需模拟为真实 Chrome 桌面端 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const cache = new Map<string, StockProxyCacheEntry>();

/**
 * 雪球 guest cookie 缓存（stock.xueqiu.com 的榜单接口需要 xq_a_token）
 *
 * xq_a_token 为游客 token（无需登录），先 GET 主站拿 set-cookie 再随转发附加；
 * 缓存 24 小时，上游 400/401 时由调用方刷新重试一次
 */
let xqCookieEntry: { value: string; expiresAt: number } | null = null;

/** 雪球 guest cookie 缓存时长（毫秒） */
const XQ_COOKIE_TTL_MS = 24 * 60 * 60 * 1000;

/** 雪球会话 cookie 名（xq_a_token / xq_r_token 会话对 + u 设备标识 + acw_tc 盾 cookie） */
const XQ_COOKIE_NAME_PATTERN = /^(xq_[a-z_]+|u|acw_tc)=/;

/** 雪球热股页地址（guest cookie 的下发页；302 落点为 www 完整地址） */
const XQ_HOT_PAGE_URL = 'https://www.xueqiu.com/hot/stock';

/**
 * 获取（带缓存的）雪球 guest cookie（两步过阿里云盾）
 *
 * ① GET 主站拿盾 cookie（acw_tc）；② 带 acw_tc GET 热股页（www 完整地址，
 * 手动走完 302 落点）拿全套业务 cookie（xq_a_token 等游客 token）
 * @returns `acw_tc=...; xq_a_token=...` 形态的 Cookie 头值
 */
const ensureXqCookie = async (): Promise<string> => {
  if (xqCookieEntry && xqCookieEntry.expiresAt > Date.now()) {
    return xqCookieEntry.value;
  }
  const jar = new Map<string, string>();
  const collect = (res: Response): void => {
    for (const cookie of res.headers.getSetCookie?.() ?? []) {
      const pair = cookie.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0 && XQ_COOKIE_NAME_PATTERN.test(pair)) {
        jar.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    }
  };
  const get = async (url: string): Promise<Response> => {
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    collect(res);
    return res;
  };
  // ① 主站：拿 acw_tc（阿里云盾会话）
  await get('https://xueqiu.com/');
  // ② 热股页（跟随后的最终地址）：下发 xq_a_token 等业务 cookie
  await get(XQ_HOT_PAGE_URL);
  if (jar.size === 0) {
    throw new Error('xueqiu set-cookie missing');
  }
  const value = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  xqCookieEntry = { value, expiresAt: Date.now() + XQ_COOKIE_TTL_MS };
  return value;
};

/** 清除雪球 cookie 缓存（上游判定 cookie 失效时调用，触发下次重新获取） */
const invalidateXqCookie = (): void => {
  xqCookieEntry = null;
};

/**
 * 写入缓存；达到容量上限时按写入顺序淘汰最旧条目（Map 保持插入序）
 * @param url 缓存键（上游完整 URL）
 * @param entry 缓存条目
 */
const setCacheEntry = (url: string, entry: StockProxyCacheEntry): void => {
  if (!cache.has(url) && cache.size >= PROXY_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(url, entry);
};

/**
 * 校验目标 URL 是否在白名单域内（后缀匹配，覆盖带数字前缀的镜像域）
 * @param rawUrl 代理参数 u 携带的上游地址
 * @returns 是否允许转发
 */
const isAllowedTarget = (rawUrl: string): boolean => {
  try {
    const { host } = new URL(rawUrl);
    return (STOCK_PROXY_ALLOWED_HOSTS as readonly string[]).some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
};

/**
 * 读取并拼接请求体（非 GET 请求透传用）
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
 * 创建 /stock-proxy 中间件：白名单校验 -> 缓存回放 -> 转发上游（Referer 伪装与超时控制）
 *
 * 响应体按原始字节透传、Content-Type 原样回写：
 * SDK 对腾讯源固定按 GBK 解码字节、对 JSON 源按 UTF-8 解析，
 * 中间件做任何转码都会破坏其预期
 *
 * 方法透传：GET 之外的请求（如澎湃列表接口只认 POST）原样转发 method / 请求体 /
 * Content-Type；非 GET 请求**不读写缓存**（同 URL 不同请求体结果不同，缓存会串味）
 * @returns Connect 兼容中间件
 */
export const createStockProxyMiddleware = (): Connect.NextHandleFunction => {
  return async (req, res, _next) => {
    // Connect 挂载在 STOCK_PROXY_PATH 前缀下，此处 req.url 已剥离前缀，仅剩查询串
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    const target = requestUrl.searchParams.get('u');
    if (!target || !isAllowedTarget(target)) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: 'FORBIDDEN_TARGET' }));
      return;
    }

    const method = (req.method ?? 'GET').toUpperCase();
    const isReadOnly = method === 'GET';

    // 调用方可经 ?r= 指定上游 Referer（浏览器 forbidden header 无法经头透传）；
    // 缓存键包含 referer，避免同 URL 不同 Referer 的响应串味
    const customReferer = requestUrl.searchParams.get('r');
    const cacheKey = customReferer ? `${target}|r=${customReferer}` : target;

    // 短 TTL 命中：直接回放缓存，不打上游（仅 GET 参与缓存）
    const hit = isReadOnly ? cache.get(cacheKey) : undefined;
    if (hit && hit.expiresAt > Date.now()) {
      res.setHeader('Content-Type', hit.contentType);
      res.end(hit.body);
      return;
    }

    try {
      // 部分上游（东财/新浪系）校验 Referer：默认伪装为目标域页面请求，
      // 调用方显式指定（?r=）时优先使用（如新浪新闻要求 finance.sina.com.cn）；带通用 UA
      const referer = customReferer ?? new URL(target).origin;
      const contentType = req.headers['content-type'];
      const headers: Record<string, string> = {
        Referer: referer,
        'User-Agent': BROWSER_USER_AGENT,
        ...(contentType ? { 'Content-Type': contentType } : {}),
      };
      // 雪球榜单接口需 guest cookie：服务端注入缓存的游客 token（浏览器 forbidden header 无法经头透传）
      const targetHost = new URL(target).host;
      const needsXqCookie = targetHost === 'stock.xueqiu.com';
      if (needsXqCookie) {
        headers.Cookie = await ensureXqCookie();
      }
      // 请求体只读一次（重试复用同一 buffer；流式二次读取会挂起）
      const requestBody = isReadOnly ? undefined : await readRequestBody(req);
      const doFetch = () =>
        fetch(target, {
          method,
          headers,
          body: requestBody,
          signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        });
      let upstream = await doFetch();
      // 雪球 cookie 失效：刷新缓存后重试一次
      if (needsXqCookie && (upstream.status === 400 || upstream.status === 401)) {
        invalidateXqCookie();
        headers.Cookie = await ensureXqCookie();
        upstream = await doFetch();
      }
      const body = new Uint8Array(await upstream.arrayBuffer());
      const responseType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
      // 仅缓存成功响应，失败不缓存以便快速恢复
      if (upstream.ok && isReadOnly) {
        setCacheEntry(cacheKey, { body, contentType: responseType, expiresAt: Date.now() + PROXY_CACHE_TTL_MS });
      }
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', responseType);
      res.end(body);
    } catch (error) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'UPSTREAM_FAILED', message: String(error) }));
    }
  };
};

/**
 * Vite 插件：开发服务器与 preview 服务器挂载同源代理中间件
 *
 * 生产用 `vite preview` 托管时零新增部署代码即可获得代理能力
 * @returns Vite 插件对象
 */
export const stockProxyPlugin = (): Plugin => ({
  name: 'stock-proxy',
  configureServer(server) {
    server.middlewares.use(STOCK_PROXY_PATH, createStockProxyMiddleware());
  },
  configurePreviewServer(server) {
    server.middlewares.use(STOCK_PROXY_PATH, createStockProxyMiddleware());
  },
});
