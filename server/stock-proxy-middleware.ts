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
const cache = new Map<string, StockProxyCacheEntry>();

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
 * 创建 /stock-proxy 中间件：白名单校验 -> 缓存回放 -> 转发上游（Referer 伪装与超时控制）
 *
 * 响应体按原始字节透传、Content-Type 原样回写：
 * SDK 对腾讯源固定按 GBK 解码字节、对 JSON 源按 UTF-8 解析，
 * 中间件做任何转码都会破坏其预期
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

    // 调用方可经 ?r= 指定上游 Referer（浏览器 forbidden header 无法经头透传）；
    // 缓存键包含 referer，避免同 URL 不同 Referer 的响应串味
    const customReferer = requestUrl.searchParams.get('r');
    const cacheKey = customReferer ? `${target}|r=${customReferer}` : target;

    // 短 TTL 命中：直接回放缓存，不打上游
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      res.setHeader('Content-Type', hit.contentType);
      res.end(hit.body);
      return;
    }

    try {
      // 部分上游（东财/新浪系）校验 Referer：默认伪装为目标域页面请求，
      // 调用方显式指定（?r=）时优先使用（如新浪新闻要求 finance.sina.com.cn）；带通用 UA
      const referer = customReferer ?? new URL(target).origin;
      const upstream = await fetch(target, {
        headers: { Referer: referer, 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });
      const body = new Uint8Array(await upstream.arrayBuffer());
      const contentType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
      // 仅缓存成功响应，失败不缓存以便快速恢复
      if (upstream.ok) {
        setCacheEntry(cacheKey, { body, contentType, expiresAt: Date.now() + PROXY_CACHE_TTL_MS });
      }
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', contentType);
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
