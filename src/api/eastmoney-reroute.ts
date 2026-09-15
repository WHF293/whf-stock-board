/**
 * 东财镜像域改道（2026-09-15 实测新增）
 *
 * 背景（实测结论，勿凭猜测回退）：
 * - 本机出口对 **push2 / push2his 两个域及其数字镜像**（`7.push2` / `91.push2` /
 *   `33.push2his` / `push2his.eastmoney.com` …）在 TCP 层直接断连（curl `http=000`）；
 *   stock-sdk 的 clist / 资金流 / K 线等地址是**硬编码常量**，无法用构造选项覆盖。
 * - 同参数的**同款接口在 `push2delay.eastmoney.com` 全部可用**（实测 200 且有数据）：
 *   `/api/qt/clist/get`（板块 / 全市场）、`/api/qt/ulist.np/get`、`/api/qt/stock/get`、
 *   `/api/qt/stock/fflow/daykline/get`、`/api/qt/stock/trends2/get`。
 * - 例外：`/api/qt/stock/kline/get`（历史 K 线）在 push2delay 上返回
 *   `rc=102 + data:null`，**不可改道**；本项目 K 线已统一走新浪源，故不影响。
 *
 * 因此只对「push2delay 确实提供」的路径做域替换，其余原样透传，
 * 避免把「硬失败」静默变成「空数据」。
 */

/** 已确认 TCP 层不可达的东财域（含数字镜像前缀，如 91.push2 / 33.push2his） */
const DEAD_EASTMONEY_HOST = /^https?:\/\/(?:[0-9]+\.)?push2(?:his)?\.eastmoney\.com/i;

/** 改道目标域（SDK 镜像域之一，本项目实测连通性最稳） */
const REROUTE_HOST = 'https://push2delay.eastmoney.com';

/**
 * push2delay 确认可用的路径前缀（其余路径不做改道）
 *
 * 已由 `.ai/项目资源/数据接口说明.md` §12/§3 记录：clist / ulist.np / stock.get /
 * fflow.daykline / trends2 与 push2 系同参数同响应结构。
 */
const REROUTE_PATHS = [
  '/api/qt/clist/get',
  '/api/qt/ulist.np/get',
  '/api/qt/stock/get',
  '/api/qt/stock/fflow/',
  '/api/qt/stock/trends2/get',
] as const;

/**
 * 判断是否为「已封禁域 + 可替代路径」的东财请求
 * @param url 上游请求地址
 * @returns 需要改道时为 true
 */
export const shouldRerouteEastmoneyHost = (url: string): boolean => {
  if (!DEAD_EASTMONEY_HOST.test(url)) {
    return false;
  }
  return REROUTE_PATHS.some((path) => url.includes(path));
};

/**
 * 把已封禁东财域上的可替代请求改写到 push2delay（参数与路径原样保留）
 *
 * 非目标域 / 非可替代路径一律原样返回，调用方无需分支。
 * @param url 上游请求地址
 * @returns 改道后的地址（无需改道时与原值相同）
 */
export const rerouteEastmoneyHost = (url: string): string => {
  if (!shouldRerouteEastmoneyHost(url)) {
    return url;
  }
  return url.replace(DEAD_EASTMONEY_HOST, REROUTE_HOST);
};
