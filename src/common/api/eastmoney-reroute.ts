/**
 * 东财镜像域改道（2026-09-15 实测新增）
 *
 * 背景（实测结论，勿凭猜测回退）：
 * - 2026-09-15：本机出口对 **push2 / push2his 两个域及其数字镜像**（`7.push2` /
 *   `91.push2` / `33.push2his` / `push2his.eastmoney.com` …）在 TCP 层直接断连
 *   （curl `http=000`）；stock-sdk 的 clist / 资金流 / K 线等地址是**硬编码常量**，
 *   无法用构造选项覆盖。
 * - 2026-09-18 复测（curl 与 node/undici 两套栈一致）：
 *   · `push2.eastmoney.com` **仍然不可达**（`http=000`）→ 其路径继续改道；
 *   · `push2his.eastmoney.com` **及数字镜像已恢复可达**（`1.` / `33.` 均 200）
 *     → 该域请求**不再需要改道**（资金流历史直连可得 121 条，见下方说明）。
 * - 同参数的**同款接口在 `push2delay.eastmoney.com` 可用**（实测 200 且有数据）：
 *   `/api/qt/clist/get`（板块 / 全市场）、`/api/qt/ulist.np/get`、`/api/qt/stock/get`、
 *   `/api/qt/stock/trends2/get`。
 * - 例外一：`/api/qt/stock/kline/get`（历史 K 线）在 push2delay 上返回
 *   `rc=102 + data:null`，**不可改道**；本项目 K 线已统一走新浪源，故不影响。
 * - 例外二：`/api/qt/stock/fflow/daykline/get` 在 push2delay 上**只回当日 1 条**
 *   （历史被截断），**已从改道清单剔除**，详见 `REROUTE_PATHS` 上方注释。
 *
 * 因此只对「push2delay 确实提供同构响应」的路径做域替换，其余原样透传，
 * 避免把「硬失败」静默变成「空数据」或「半截数据」。
 */

/**
 * 东财行情域（含数字镜像前缀，如 91.push2 / 33.push2his）
 *
 * 命名不再叫「dead」：push2his 已于 2026-09-18 恢复可达，
 * 是否真的要改道由 `REROUTE_PATHS` 逐路径二次判定。
 */
const EASTMONEY_QUOTE_HOST = /^https?:\/\/(?:[0-9]+\.)?push2(?:his)?\.eastmoney\.com/i;

/** 改道目标域（SDK 镜像域之一，本项目实测连通性最稳） */
const REROUTE_HOST = 'https://push2delay.eastmoney.com';

/**
 * push2delay 确认「同参数同响应结构」的路径前缀（其余路径一律不做改道）
 *
 * 已由 `.ai/项目资源/数据接口说明.md` §12/§3 记录：clist / ulist.np / stock.get /
 * trends2 与 push2 系同参数同响应结构。
 *
 * ⚠️ `/api/qt/stock/fflow/`（资金流历史）**已从清单剔除**（2026-09-18 实测）：
 * 同一份请求打到 push2delay 只回 **当日 1 条** kline（`lmt=0` 也一样），
 * 而 `push2his` 直连返回 **121 条**（自 2026-03-27 起）。
 * 表现为「主力净流入（近10日）」图表只有 1 个点、列表只有 1 行 —— 正是上面
 * 「把硬失败静默变成空数据」的变体。若 push2his 日后再次不可达，宁可整体报错，
 * **也不要**把它放回本清单（那只会退化成 1 天数据而不报错）。
 *
 * trends2 保留改道：两域实测均为 241 点、无差别，不动以免影响分时链路。
 */
const REROUTE_PATHS = [
  '/api/qt/clist/get',
  '/api/qt/ulist.np/get',
  '/api/qt/stock/get',
  '/api/qt/stock/trends2/get',
] as const;

/**
 * 判断是否为「东财行情域 + push2delay 可替代路径」的请求
 * @param url 上游请求地址
 * @returns 需要改道时为 true
 */
export const shouldRerouteEastmoneyHost = (url: string): boolean => {
  if (!EASTMONEY_QUOTE_HOST.test(url)) {
    return false;
  }
  return REROUTE_PATHS.some((path) => url.includes(path));
};

/**
 * 把东财行情域上的可替代请求改写到 push2delay（参数与路径原样保留）
 *
 * 非目标域 / 非可替代路径一律原样返回，调用方无需分支。
 * @param url 上游请求地址
 * @returns 改道后的地址（无需改道时与原值相同）
 */
export const rerouteEastmoneyHost = (url: string): string => {
  if (!shouldRerouteEastmoneyHost(url)) {
    return url;
  }
  return url.replace(EASTMONEY_QUOTE_HOST, REROUTE_HOST);
};
