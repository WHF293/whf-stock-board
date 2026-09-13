/**
 * 同源代理路径前缀（Vite 中间件与生产 preview 中间件共同约定）
 *
 * fetch 型上游请求由 stock-sdk 的 fetchImpl 改道到 `${STOCK_PROXY_PATH}?u=<encoded>`，
 * 由服务端中间件转发以绕过浏览器 CORS
 */
export const STOCK_PROXY_PATH = '/stock-proxy';

/**
 * 代理白名单：仅允许转发这些上游域及其子域（防止沦为开放代理）
 *
 * 匹配规则为后缀匹配（host === 白名单项 或 host 以 `.白名单项` 结尾），
 * 覆盖 SDK 实际使用的带数字前缀镜像域（如 91.push2.eastmoney.com）；
 * 接入新数据源若出现 403 FORBIDDEN_TARGET，把上游域名补充到这里即可
 */
export const STOCK_PROXY_ALLOWED_HOSTS = [
  // 东方财富（行情快照 / 资金流向 / 板块 / 龙虎榜等深度数据；含数字前缀镜像与期货/基金接口）
  'eastmoney.com',
  // 腾讯行情 / 交易日历 / 搜索
  'gtimg.cn',
  // 新浪（行情快照 hq.sinajs.cn / K 线 quotes.sina.cn / 新闻 feed.mix.sina.com.cn）
  'sina.com.cn',
  'sina.cn',
  'sinajs.cn',
  // 同花顺（热点新闻 news.10jqka.com.cn）
  '10jqka.com.cn',
  // stock-sdk 静态资源（代码表等参考数据）
  'linkdiary.cn',
] as const;

/** 代理转发上游超时（毫秒） */
export const PROXY_TIMEOUT_MS = 12_000;

/** 代理短 TTL 缓存时长（毫秒）：行情类 3 秒足够新，同时收敛对公共上游的压力 */
export const PROXY_CACHE_TTL_MS = 3_000;

/** 代理缓存最大条目数：超出后按写入顺序淘汰最旧条目，防止长驻进程内存膨胀 */
export const PROXY_CACHE_MAX_ENTRIES = 300;
