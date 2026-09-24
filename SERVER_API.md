# SERVER_API.md — 接口与数据源清单

> 本文件盘点项目所有「请求了什么接口 / 调用了 stock-sdk 什么方法」，供排查取数失败、新增数据源时对照。
> 数据通道、代理白名单、频率红线的权威约定见 `AGENTS.md` / `CLAUDE.md`（根目录）的「数据通道」「请求频率红线」两节。

## 0. 数据通道总览

- **唯一出口**：所有 `fetch` 型请求都经 `src/api/proxy-fetch.ts`（`proxyFetch`）；`stock-sdk` 的 `fetchImpl` 也被注入为 `proxyFetch`（`src/api/sdk.ts`）。
  - 浏览器态：同源 `/stock-proxy?u=<encoded>` 由 `server/stock-proxy-middleware.ts` 转发。
  - Tauri 态：`tauri-plugin-http` 由 Rust 直连，域名白名单在 `src-tauri/capabilities/default.json`。
  - **方法透传**：中间件除 GET 外也转发 `method` / 请求体 / `Content-Type`（澎湃列表接口只认 POST）；**非 GET 不参与 3 秒缓存**（同 URL 不同请求体结果不同，避免串味）。
- **代理白名单**：`src/constants/proxy.constants.ts` 的 `STOCK_PROXY_ALLOWED_HOSTS`（后缀匹配）：
  `eastmoney.com`、`gtimg.cn`、`sina.com.cn`、`sina.cn`、`sinajs.cn`、`10jqka.com.cn`、`thepaper.cn`、`cls.cn`、`linkdiary.cn`。
  新增域名需同步改这里（浏览器）与 capability（Tauri）。
- **本机关键约束（踩坑结论，2026-09-18 复测更新；curl 与 node 两套栈结论一致）**：
  - ⚠️ **`push2.eastmoney.com` 仍被 TCP 层封禁**（`http=000`，带数字镜像同样不可达）→ `stock-sdk` 的 clist / ulist.np 等地址继续经 `src/api/eastmoney-reroute.ts` 改道到 push2delay。
  - ✅ **`push2his.eastmoney.com` 及数字镜像已恢复可达**（`1.` / `33.` 均 200）。**资金流历史必须走它**：`/api/qt/stock/fflow/daykline/get` 同参数下 push2his 返回 **121 条**（自 2026-03-27 起），而 **push2delay 只返回当日 1 条**（`lmt=0` 也一样）。
    - 因此 `fflow` 路径**已从改道清单剔除**（2026-09-18）。改道清单只保留 push2delay 确实同构的路径：`clist` / `ulist.np` / `stock.get` / `trends2`。
    - ⚠️ 回归症状：把 fflow 放回改道清单 → 「主力净流入（近10日）」图表只 1 个点、表格只 1 行，且**不报错**。
    - ⚠️ **2026-09-20 复测：push2his API 路径再次对本机 TCP RST**（`http=000`，数字镜像 `1.` / `33.` 同封；根路径仍返回 404，即按 IP+路径封禁）。诱因是 30 板块 daykline 连发无间隔（现已在 `api/board-flow-history.api.ts` 落实并发 3 + 每请求 500ms 错峰）；push2delay 的 clist 同时段正常。**仍勿改道**（push2delay 的 daykline 只有当日 1 条）。
  - 📌 **失败形态（2026-09-18 复测，决定重试策略）**：多半是**连接层被掐断**而非 HTTP 错误码 —— `fetch failed` / `UND_ERR_SOCKET other side closed`（curl 侧 `000`，约 0.2s 即返回，实测 8 次里成功 1 次；间隔 1.5s 连打 12 次成功 3 次）。**稍候重试能恢复**（实测同 URL 第 2 次即 200）→ 因此「同 URL 原地重试 + 拉长间隔」是本域唯一有效的兜底手段，胜于换镜像域（镜像域实测全不可达）。
  - 📌 **两源量级对照（2026-09-18 实测，说明为何绝不混排）**：同一天同一板块，东财 `半导体(BK1036)` 成交额 3070.2 亿 vs 同花顺 `半导体(881121)` 2348.7 亿，**比值 1.31**（成分口径不同）；两套指数点位也不可比（东财 2868.43 vs 同花顺 8993 上下）。跨源拼接会让成交额口径在接缝处跳变，直接污染量能倍数与占比分位 → 两源数据必须**整表降级 + 分开存放**。
  - 同属东财但**实测可达**的域：`push2his`（行情历史 / 资金流 / 分时；⚠️ 间歇性被临时封禁，见上）、`push2delay`（快照列表 / 分时 `trends2`）、`push2ex`（涨停池）、`datacenter-web`、`np-listapi`（7×24 快讯）。
  - ⚠️ **`push2delay` 不提供历史 K 线**：`/api/qt/stock/kline/get` 返回 **HTTP 200 但 `data` 为 null / `klines` 为空**。调用方若把「200 但无数据」当成功，会静默返回空数组 —— 表现为**图表空白、列表为空且没有任何错误提示**（本模块曾踩此坑）。解析上游必须校验「拿到非空数据」才算成功。
  - **指数日 K 成交额因此改走腾讯** `web.ifzq.gtimg.cn/appstock/app/newfqkline/get`（见 §1 `fetchMarketTurnover`）。该域已在代理白名单 `gtimg.cn` 与 Tauri capability `https://*.gtimg.cn/*` 内，无需新增配置。
  - 新浪 `quotes.sina.cn` K 线**无成交金额字段**（仅 `volume` 成交量），且 `volume×收盘价` 对指数不成立（实测约为真实成交额的 235 倍），故成交额不依赖新浪推算。
  - 腾讯历史日 K：`appstock/app/kline/kline` 与 `appstock/app/fqkline/get` 只有 6 段（无成交额），**只有 `appstock/app/newfqkline/get` 返回成交额**（见 §1）。
- **频率红线**：东财系高频会封 IP；全市场快照小并发 `batchSize 500 / concurrency 3`（**上限 3**），同上游连续请求 `delay(500)` 错峰，重接口（快照/K线/资金流/分时）一律用户点击触发、不轮询。

---

## 1. 直连 fetch 接口（`src/api/*` 中直接 `proxyFetch` 的源）

| 封装函数 | 文件 | 上游 URL（host） | 方法 | 说明 / 字段 |
| --- | --- | --- | --- | --- |
| `fetchSinaKline` | `api/sina-kline.api.ts` | `quotes.sina.cn/cn/api/jsonp_v2.php/var _=/CN_MarketDataService.getKLineData` | GET(JSONP) | 新浪 K 线（日/周/月/分钟）。返回 `day,open,high,low,close,volume`；日 K **无 amount（成交金额）**。带 `Referer: finance.sina.com.cn`。用于个股详情 `StockDetailPanel`、原成交额模块已弃用 |
| `fetchSinaHotNews` | `api/news.api.ts` | `feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516/2517` | GET | 新浪滚动热点（财经综合 2516 / 股市快讯 2517）。带 `Referer: finance.sina.com.cn` |
| `fetchEastmoneyHotNews` | `api/news.api.ts` | `np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102` | GET | 东财 7×24 快讯，游标翻页（`sortEnd`）。无原文链接，点击跳 `so.eastmoney.com/news/s?keyword=` |
| `fetchThsHotNews` | `api/news.api.ts` | `news.10jqka.com.cn/tapp/news/push/stock/?page=&limit=` | GET | 同花顺股市快讯。带 `Referer: 10jqka.com.cn` |
| `fetchThepaperHotNews` | `api/news.api.ts` | `api.thepaper.cn/contentapi/nodeCont/getByChannelId` | **POST**(JSON) | 澎湃财经频道（`channel_25951`）。⚠️ 只认 POST（GET 返回 `code 99998`）；`pageNum` 被忽略，翻页游标是 **`startTime`**（上一页末条毫秒时间戳，`hasNext` 决定终止）；`pageSize` 上限 20；列表**无摘要字段**（`summary` 恒空）；时间取 `pubTimeLong`（毫秒→秒） |
| `fetchMarketTurnover` | `api/turnover.api.ts` | `web.ifzq.gtimg.cn/appstock/app/newfqkline/get` | GET | **沪深两市成交额**。`param=<sh000001\|sz399001>,day,,,400,qfq`（日 K 前复权，最多 400 条），取每行**下标 8「成交额(万元)」×1e4 → 元**，两指数按交易日相加。带 `Referer: gu.qq.com`。⚠️ 行结构：`[日期,开,收,高,低,成交量(手),{},?,成交额(万元),…]`；`fqkline`/`kline` 两个老接口**没有**这一段，别混用 |
| `fetchClist` / `fetchGlobalIndexPanorama` | `api/panorama.api.ts` | `push2delay.eastmoney.com/api/qt/clist/get` | GET | 行情全景：全球指数（`fs=m:100`）、A股板块等快照列表 |
| `fetchUsSectorPanorama` | `api/panorama.api.ts` | `push2delay.eastmoney.com/api/qt/ulist.np/get` | GET | 美股行业 ETF（按 `secids` 精确查询） |
| 更新检查 | `constants/app-info.constants.ts` + `views/SettingsView.vue` | `api.github.com/repos/WHF293/whf-stock-board/releases/latest` | GET | 检查更新（非行情数据） |
| 连通性探针 | `views/SettingsView.vue` | `qt.gtimg.cn/q=sh000001` | GET | 设置页「网络诊断」用腾讯源直连测连通性 |
| `fetchThsBoardPage` | `plugins/mainline/ths-data.ts` | 清单页 `q.10jqka.com.cn/thshy/` + 分页 `q.10jqka.com.cn/thshy/index/field/199112/order/desc/page/<n>/ajax/1/` | GET | 同花顺行业板块清单 + **当日结构快照**（**GBK HTML**）。首页锚点正则抽 `detail/code/88xxxx` 得**全部 90 个**行业板块；表格行解析得 `涨跌幅 / 总成交额(亿元) / 净流入(亿元) / 上涨家数 / 下跌家数 / 均价 / 领涨股`。⚠️ **表格每页只有 50 行**（90 个板块分布在 2 页：50 + 40，第 2 页须走 ajax 形态），两页并集与锚点集合实测完全一致。带 `Referer: q.10jqka.com.cn` |
| `fetchThsBoardKline` | `plugins/mainline/ths-data.ts` | `d.10jqka.com.cn/v6/line/48_<板块码>/<复权>/<文件>.js` | GET(JSONP) | 同花顺板块**日 K**（含成交额）：剥 JSONP 壳后 `data` 为 `日期,开,高,低,收,量,额,…` 逐日分号分隔。**三文件 × 两复权 = 6 个候选按序回退**（`buildKlineCandidates`）：当年 `2026` → 近端 `last` → 去年 `2025`，各试 `01` 前复权/`00` 不复权；同一候选遇 5xx 原地重试一次。⚠️ 近端 `last.js` 是**同源同口径**的第二份数据（≈140 个交易日，与年 K 重叠日期数值逐日一致，实测 140/140 全等）→ 是年文件 502 的主要救援手段。带 `Referer` |
| `fetchEmBoardUniverse` | `plugins/mainline/em-data.ts` | `push2delay.eastmoney.com/api/qt/clist/get?fs=m:90+t:2` | GET | **东财兜底（L2.5）**：行业板块清单全表（`pn` 分页 `pz=100`，实测 484~496 行，一/二/三级混合）。字段 `f12` 代码 / `f14` 名称 / `f3` 涨跌幅 / `f6` 成交额(元) / `f62` **主力净流入**(元) / `f104` 上涨家数 / `f105` 下跌家数 / `f128` 领涨股（实测八字段 100% 有值）。⚠️ **不当板块全集用**，只当「同花顺板块名 → 东财板块代码」的映射表（同花顺才是板块口径的定义者）。带 `Referer: quote.eastmoney.com`；串行 + `EM_SCAN_DELAY_MS`(1200ms)；连接被掐断时原地重试 `EM_FETCH_ATTEMPTS`(3) 次 |
| `fetchEmBoardKline` | `plugins/mainline/em-data.ts` | `push2his.eastmoney.com/api/qt/stock/kline/get?secid=90.<BKxxxx>` | GET | **东财兜底（L2.5）**：板块**日 K**，`klt=101` 日线 / `fqt=1` 前复权 / `beg=<去年>0101`（实测 417 个交易日，够 60 日分位与 5/20 日量能）。`data.klines` 每行 **`日期,开,收,高,低,成交量,成交额`（f51~f57，顺序如此，成交额单位元、日期已是 `YYYY-MM-DD`）**。⚠️ 本域连接会被随机掐断 → 原地重试 3 次（间隔 1.2s）。与同花顺**不同源**，量级与点位都不可比（见 §0） |
| `fetchDividendRank` | `plugins/dividend-screen/em-data.ts` | `push2delay.eastmoney.com/api/qt/clist/get?fid=f133` | GET | **股息筛选**：全市场 A 股按 `f133` 股息率（TTM，东财口径）降序取前 N（`fltt=2&invt=2` 下 f2 现价 / f20 总市值 / f38 总股本 / f115 PE-TTM 均为真值小数）。⚠️ 实测 `pz>100` 只回 100 行（上游硬上限）→ 分页串行 1s 间隔 + 按代码去重；f133 随现价实时变、页边界会漂移，但排行只用于**选样本池**（展示口径全部由推算层自算），漂移只影响池边界个别股票。带 `Referer: quote.eastmoney.com` |
| `fetchPerfByCodes` | `plugins/dividend-screen/em-data.ts` | `datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD` | GET | **股息筛选**：业绩报表，按**报告期 + 代码集合**过滤（`in` 分块 ≤100 代码）。字段 `PARENT_NETPROFIT` 归母净利 / `SJLTZ` 净利同比 / `YSTZ` 营收同比 / `BOARD_NAME` 行业；报告期字段名是 `REPORTDATE`（无下划线）。缺席 = 未披露（合法空）。带 `Referer: data.eastmoney.com` |
| `fetchDividendsByCodes` | `plugins/dividend-screen/em-data.ts` | `datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET` | GET | **股息筛选**：分红送配明细，同样按报告期 + 代码集合过滤。字段 `PRETAX_BONUS_RMB` 每 10 股派息（含税，纯转增为 null）/ `TOTAL_SHARES` 公告时总股本 / `EX_DIVIDEND_DATE` 除权除息日（TTM 归集锚点）；⚠️ 报告期字段名是 **`REPORT_DATE`（带下划线，与业绩报表的 `REPORTDATE` 不同名，混用会被 `success:false` 拒绝）**；同一报告期可能多条方案 → 每股派息按代码**求和**。⚠️ **排行字段 `f133` 口径实测有偏**（2026-09-20 招商银行案：f133=2.47% 只含 2025 年度末期 10派10.03，漏除息在近 12 个月内的中期 10派10.13；同花顺 TTM 为 4.97%）→ f133 ≈ 最新年报期分红 ÷ 现价，只用于选样本池；TTM / 去年分红由明细自算（去年分红 = 财务年度内中期 + 末期 + 季度方案合计）。带 `Referer: data.eastmoney.com` |
| `fetchBoardFlowHistories` / `fetchBoardFlowHotBoards` | `api/board-flow-history.api.ts` | `push2his.eastmoney.com/api/qt/stock/fflow/daykline/get`（逐日历史）+ `push2delay.eastmoney.com/api/qt/clist/get`（热点名单 f174 排行） | GET | 板块（行业/概念）**逐日主力净流入历史**。消费方：Agent MCP `get_board_flow_history` + 市场榜单「板块净流入 → 查看历史净流入」页。历史在本机渐进累积（`localStorage['whf:sector-flow-history']`，独立 key 防整包写放大）：盘中进页拉新合并（同日 5 分钟节流）、盘后 / 非交易日只读本地、首次一次拉全量，每板块保留 250 交易日。**并发 3 + 每请求 500ms 错峰**（⚠️ 30 连发无间隔是 push2his 对本机 IP 封禁诱因之一，见 §0 2026-09-20 记录） |
| `fetchRankRowByCode` | `plugins/dividend-screen/em-data.ts` | `push2delay.eastmoney.com/api/qt/ulist.np/get?secids=<0\|1>.<代码>` | GET | **股息筛选**：单股精确行情（自选 tab 搜索预览用，样本池外个股按需补一次，点击触发不轮询）。字段与排行 clist **完全同构**（f12/f14/f2/f3/f20/f23/f38/f115/f133，`fltt=2&invt=2` 真值小数），返回体同为 `data.diff` 数组 → 直接复用 `parseRankPage` 解析成 `RankBaseRow`。secid 前缀 `1.` = 沪（6 开头）/ `0.` = 深（股息语境只有沪深 A 股，北交所不在范围）。带 `Referer: quote.eastmoney.com`。实测（2026-09-20）：600036 招行 f2=40.59 / f133=2.47 全部有值 |
| `fetchFinancialSummary` / `fetchBalanceSheetDigest` / `fetchCashFlowDigest` / `fetchProfitForecast` | `api/financial.api.ts` | `datacenter-web.eastmoney.com/api/data/v1/get` | GET | **Agent 财务工具（MCP `financial-data`）**：`reportName` 四张报表 —— `RPT_LICO_FN_CPD` 财务摘要（营收/归母净利/同比环比/EPS/ROE/毛利率；报告期字段 `REPORTDATE`）/ `RPT_DMSK_FN_BALANCE` 资产负债表 / `RPT_DMSK_FN_CASHFLOW` 现金流量表（两者报告期字段 `REPORT_DATE`，带下划线）/ `RPT_PUBLIC_OP_NEWPREDICT` 业绩预告（排序 `NOTICE_DATE`）。公共参数：`columns=ALL` + `filter=(SECURITY_CODE="<6位代码>")` + `pageSize`/`pageNumber=1` + `sortTypes=-1` + `source=WEB&client=WEB`。⚠️ **字段名两套并存**（`REPORTDATE` vs `REPORT_DATE`，与 §1 分红明细同样的坑）；`result:null` = 该票无此数据（合法空，`success` 仍 true）。⚠️ 未接入端点：`datacenter.eastmoney.com` 的 F10 `RPT_F10_FINANCE_MAINFINADATA` **fields 必须显式列字段名**（`fields=ALL` 报 9501「返回字段参数不能为空」）；业绩快报 `RPT_PUBLIC_OP_NEWDISCOVER` **报表不存在**（9501）。2026-09-24 实测四参数三报表全通（600519 茅台 2026 半年报全字段有值）。带 `Referer: data.eastmoney.com` |

---

## 2. stock-sdk 方法调用（`sdk` 单例，`src/api/sdk.ts`）

`stock-sdk` 内部按方法路由到腾讯 / 东方财富不同域。**走东财 `push2` 的方法在本机不可用**（TCP 层封禁，改道 push2delay，见 §0）；**`push2his` 资金流历史依赖它，不要再改道**（2026-09-18 恢复过，2026-09-20 又被临时封禁，间歇性，恢复后即用，见 §0）；走腾讯源的方法（`quotes` / `calendar` / `search` / `timeline`）正常；「个股详情」的日 K 仍走新浪（复权口径原因，见 §1）。

| 封装函数 | 文件 | SDK 方法 | 上游域（实测） | 说明 |
| --- | --- | --- | --- | --- |
| `fetchFullQuotes` | `api/quotes.api.ts` | `sdk.quotes.cn(codes)` | 腾讯 | 批量实时行情（腾讯源），codes 为 `sh600519` 完整形态；指数卡、个股报价头 |
| `fetchAllMarketQuotes` | `api/quotes.api.ts` | `sdk.batch.cn({batchSize:500,concurrency:3})` | 东财 clist | 全市场 A 股快照（涨跌分布/市场宽度）；小并发分页约 11 页（4 轮） |
| `fetchIndustryBoards` | `api/board.api.ts` | `sdk.board.industry.list()` | 东财 | 行业板块列表 |
| `fetchConceptBoards` | `api/board.api.ts` | `sdk.board.concept.list()` | 东财 | 概念板块列表 |
| `fetchIndustryConstituents` | `api/board.api.ts` | `sdk.board.industry.constituents(symbol)` | 东财 | 行业板块成分股（点击触发，重接口） |
| `fetchConceptConstituents` | `api/board.api.ts` | `sdk.board.concept.constituents(symbol)` | 东财 | 概念板块成分股（点击/选股器触发） |
| `fetchZtPool` | `api/event.api.ts` | `sdk.marketEvent.ztPool(type, date?)` | 东财 | 涨停/跌停等股池。**`date` 参数生效**（可取指定交易日，实测同一只票连板数逐日递进：9/15 = 1 板 → 9/16 = 2 板 → 9/17 = 3 板），但**只覆盖近端**（约一个月前的日期返回空池）；`qdate` 字段恒为当日，不代表实际请求日，不要用它判断日期。字段 `hybk`(行业，长名**被截断到 4 个汉字**)、`lbc`(连板数)、`fund`(封板资金)、`zttj`(N 天 M 板) |
| `fetchStockChanges` | `api/event.api.ts` | `sdk.marketEvent.stockChanges('all')` | 东财 | 全市场盘口异动（滚动时间轴） |
| `fetchBoardChanges` | `api/event.api.ts` | `sdk.marketEvent.boardChanges()` | 东财 | 板块异动汇总 |
| `fetchMarketFundFlow` | `api/flow.api.ts` | `sdk.fundFlow.market()` | 东财 **push2his（直连，勿改道）** | 大盘资金流向历史（总览「资金速览 / 主力净流入（近10日）」）。`lmt=0` 实测返回 **121 条**，前端 `slice(-10)` 取近 10 日 |
| `fetchIndividualFundFlow` | `api/flow.api.ts` | `sdk.fundFlow.individual(symbol)` | 东财 **push2his（直连，勿改道）** | 个股资金流历史（详情页）。同上述 fflow 域约束 |
| `fetchFundFlowRank` | `api/flow.api.ts` | `sdk.fundFlow.rank({indicator:'today'})` | 东财 | 个股主力资金流排名 |
| `fetchSectorFundFlowRank` | `api/flow.api.ts` | `sdk.fundFlow.sectorRank({sectorType:'industry'})` | 东财 | 板块资金流排名 |
| `fetchSectorFlowCurve(s)` | `api/sector-flow-curve.api.ts` | 直连 `push2delay.eastmoney.com/api/qt/stock/fflow/kline/get?secid=90.BKxxxx&klt=1&lmt=0` | 东财 **push2delay（直连，勿走 push2his）** | 行业板块**当日分时**资金流曲线（klt=1 分钟线，每分钟累计主力净流入，241 点；实测 2026-09-19）。⚠️ 与 fflow/daykline 口径相反：daykline 在 push2delay 只回 1 条被剔除改道，但 kline 分时在 push2delay 完整、在 push2his 反而返回空 klines；批量并发 3（市场榜单「板块净流入」页签的曲线视图，进视图触发一次不轮询） |
| `fetchNorthboundHoldingRank` | `api/flow.api.ts` | `sdk.northbound.holdingRank({market:'all',period:'today'})` | 东财 | 北向持股排名 |
| `fetchIsTradingDay` | `api/calendar.api.ts` | `sdk.calendar.isTradingDay()` | 腾讯日历 | 是否 A 股交易日（异步，带缓存） |
| `getMarketStatus` | `api/calendar.api.ts` | `sdk.calendar.marketStatus(market)` | 同步 | 当前市场状态（盘前/交易中/午休/盘后/休市，不识假） |
| `fetchTodayTimeline` | `api/kline.api.ts` | `sdk.quotes.timeline(symbol)` | 腾讯(JSONP) | 当日分时（昨收+逐分钟价/均价） |
| `fetchKlineWithIndicators` | `api/kline.api.ts` | `sdk.kline.withIndicators(symbol,{period,adjust,startDate,indicators})` | 东财 K线(push2 系列) | ⚠️ 上游为东财行情域，**本机被封 → 大概率失败**；个股详情主图 K 线已改用新浪源 `fetchSinaKline`；信号扫描 / MA 回测也已改走新浪 + SDK 纯函数（2026-09-14 方案 A） |
| `fetchKlineSignals` | `api/kline.api.ts` | `sdk.kline.signals(symbol,{...})` | 东财 | 技术信号（MA/MACD 金叉死叉等 14 种） |
| `searchStocks` | `api/search.api.ts` | `sdk.search(keyword)` | 腾讯搜索 | 模糊搜索（代码/名称/拼音） |
| `fetchDragonTigerDetail` | `api/dragon-tiger.api.ts` | `sdk.dragonTiger.detail({startDate,endDate})` | 东财 | 龙虎榜明细（近 N 日） |
| `fetchBlockTradeDetail` | `api/dragon-tiger.api.ts` | `sdk.blockTrade.detail({startDate,endDate})` | 东财 | 大宗交易明细 |
| `runScreener` | `api/screener.api.ts` | `screen(quotes)` + `fetchAllMarketQuotes` | 东财 | 基础条件筛选（全市场快照链式 `where`，按成交额降序取前 N） |
| `runMaCrossBacktest` | `api/screener.api.ts` | `fetchSinaKline`(daily) + `calcMA[5,20]` + `backtest()` | 新浪 | MA 金叉死叉回测（近一年窗口本地截取）。⚠️ 新浪不复权，除权日附近为近似口径 |
| 信号扫描 | `api/analysis.api.ts` | `fetchScanBars`（`fetchSinaKline` daily + `calcMA/calcMACD/calcRSI/calcBOLL` 纯函数，并发 3，单票失败跳过） | 新浪 | 对股票池逐票拉日 K 判定 MA/MACD/RSI/BOLL 信号。原 `sdk.kline.withIndicators`（东财）已弃用 |
| 尾盘选股 | `api/analysis.api.ts` | `sdk.quotes.timeline`（并发 2，单票失败跳过） + `fetchAllMarketQuotes` | 腾讯+东财 | 全市场快照基础过滤 + 分时强度精筛 |
| `fetchGlobalFuturesPanorama` | `api/panorama.api.ts` | `sdk.futures.globalSpot({pageSize})` | 东财 futsseapi | 外盘商品期货 |
| — | `api/sdk.ts` | `sdk.clearCaches()` | — | 强刷实例缓存（设置页「清除缓存」调用） |

---

## 3. 调用关系速查（页面 → 接口）

- **市场总览 `DashboardView`**：`fetchFullQuotes`(指数卡) · `fetchMarketFundFlow`(资金速览) · `fetchMarketTurnover`(成交额变化) · `fetchIndustryBoards`(板块热力) · `fetchAllMarketQuotes`(涨跌分布)
- **自选股 `WatchlistView`**：`fetchFullQuotes`
- **自选盯盘（侧栏插件 `dsh-sidebar-watch`）**：`fetchFullQuotes` —— 由**插件级盯盘引擎**（`plugins/sidebar-watch/monitor.ts`）轮询「候选池 ∩ 自选股」，与面板是否折叠无关。
  ⚠️ 已知重叠：在自选股页时，该引擎与 `WatchlistView` 会**各自轮询同一批符号**（各一次 `fetchFullQuotes`，间隔取用户设置与 `QUOTES_INTRADAY` 的较大值）。这是改动前就有的重叠（原先是面板组件自己轮询），若要收敛需引入宿主级报价总线，目前未做。
- **行情全景 `PanoramaView`**：`fetchGlobalIndexPanorama` · `fetchUsSectorPanorama` · `fetchGlobalFuturesPanorama`
- **资金动向 `FundFlowView`**：`fetchMarketFundFlow` · `fetchFundFlowRank` · `fetchSectorFundFlowRank` · `fetchNorthboundHoldingRank`
- **涨停与异动 `MarketMoodView`**：`fetchZtPool` · `fetchStockChanges` · `fetchBoardChanges`
- **龙虎榜·大宗 `DragonTigerView`**：`fetchDragonTigerDetail` · `fetchBlockTradeDetail`
- **选股器 `ScreenerView`**：`runScreener` · `runMaCrossBacktest` · 信号扫描 / 尾盘选股（`analysis.api`）
- **热点新闻 `HotNewsView`**：`fetchSinaHotNews` · `fetchEastmoneyHotNews` · `fetchThsHotNews` · `fetchThepaperHotNews`
- **个股详情（停靠面板）`StockDetailPanel`**：`fetchSinaKline`(K线) · `fetchTodayTimeline`(分时) · `fetchIndividualFundFlow` · `fetchKlineWithIndicators` · `fetchKlineSignals`
- **股票主线（侧栏插件 `dsh-mainline`）**：`fetchThsBoardPage`(清单+结构快照，含 1 次分页) · `fetchThsBoardKline`(×90) · `fetchMarketTurnover`(复用宿主，算成交占比分母) · `fetchZtPool('zt', 基准日)`(涨停结构)；**跨源兜底专用** `fetchEmBoardUniverse`(东财板块清单) · `fetchEmBoardKline`(东财板块日 K)
  ⚠️ 只由用户点击「扫描主线」触发、**不轮询**；同上游并发 3 + 连续间隔 500ms（`MAINLINE_SCAN_CONCURRENCY` / `MAINLINE_SCAN_DELAY_MS`）；东财侧**串行 1 + 间隔 1200ms**（`EM_SCAN_CONCURRENCY` / `EM_SCAN_DELAY_MS`，实测 `push2his` 突发限流，连接会被切断）。
  单次扫描请求数 ≈ **94**（清单首页 1 + 分页 1 + 板块年 K 90 + 两市成交额 1 + 涨停池 1；板块失败补采轮另计）；降级东财时 ≈ **96 + 6 页清单**（清单分页 ≤6 + 90 个板块日 K）。
  **可靠性（2026-09-18 实测）**：`d.10jqka.com.cn` 的 openresty 网关会**瞬时 502 且按文件发生** —— 同一板块年文件 `2026.js` 502 而 `last.js` 200。三层兜底：① 回退链含近端 `last.js`（同源同口径，与年 K 重叠日期数值逐日一致）；② 同一候选 URL 对 5xx 原地重试一次（`THS_BOARD_KLINE_URL_ATTEMPTS`）；③ 整轮跑完隔 2s 对失败板块**补采一轮**（`MAINLINE_SCAN_RETRY_DELAY_MS`）。三层全失败才记 failures 并提示（保留本地旧数据）。
  **已实现的跨源兜底（L2.5 简化版，2026-09-18）**：**只在同花顺整体不可用（全部板块日 K 均失败）时整表降级东财**（板块日 K `push2his secid=90.BKxxxx`，字段 `f51~f57 = 日期/开/收/高/低/成交量/成交额`，日期已是 `YYYY-MM-DD`，成交额单位元；板块快照 `push2 clist m:90+t:2` 取 `f12/f14/f3/f6/f62/f104/f105/f128`）。单板块失败仍走同源兜底（`last.js` + 本地缓存），**绝不单板混源**。
  - **板块清单三级解析**（降级判定与清单解耦）：实时清单页 → 本地缓存（上次成功扫描的清单）→ 内置静态清单 `MAINLINE_THS_BOARD_FALLBACK`。清单页失败**不等于**换源，仍用缓存清单取同花顺日 K，只是丢掉当日结构快照。
  - **名称映射（实测 84/90，东财全表 496 个板块）**：东财行业分类与同花顺不同源 —— 等值 + 剥罗马数字后缀（优先Ⅱ）+ 唯一前缀 + 人工别名 12 条，合计命中 84；剩 **6 个故意不猜**（汽车整车 / 零售 / 旅游及酒店 / 军工装备 / 饮料制造 / 其他社会服务），界面标「东财无同义板块」。`matchThsToEm` **不做前缀兜底**（会把东财一级行业 `汽车` 与已映射的 `汽车零部件` 重复计数）。
  - ⚠️ **清单分页必须用稳定排序字段**（血的教训，2026-09-18）：原先用 `fid=f3`（涨跌幅）排序，而分页是逐页串行请求、f3 盘中每秒都在变 → **行在页边界来回搬家**，实测上游 `total` 报 496 却只收到 491 行 + 5 个重复，**5 个板块被静默丢掉**（丢的恰是化学纤维 / 非金属材料 / 生物制品），表现为「未映射名单每次跑都不一样」。改用 `fid=f12`（代码）升序后实测 496 行 / 0 重复 / 与 `total` 一致；`fetchEmBoardUniverse` 另加「与 `total` 对账，短了整轮重跑一次（`EM_UNIVERSE_ROUNDS`），仍短则抛错」的护栏 —— 清单缺行绝不能报成「东财无同义板块」。
  - **两源数据绝不混排**：按 `source:code` 分表存储，界面同一时刻只展示一源，并显式标注**数据源徽标 + 降级原因 + 口径差异提示**（实测半导体成交额，**同为 2026-09-18 完整日**：东财 3200.3 亿 vs 同花顺 3010.2 亿 ≈ **1.06×**，因指数成分不同；⚠️ 早前记的 1.31× 是**错配对比** —— 拿东财完整日比同花顺盘中半日值，不可复用）；同花顺恢复后自动切回，东财历史保留。
  - 方案全文见 `.ai/开发方案/2026-09-18-数据源兜底方案.md`。
  **口径（必须遵守，否则指标会错）**：
  - 全部指标取**基准交易日截面** —— 基准日 = 最近一个「有行情的板块数 ≥ 清单总数 × 85%」的交易日，且**当日数据未落定（本地 < 15:30）时排除当日**（盘中分子是半日混合、分母是半日全市场，实测占比仅 35.6% 而完整日为 98.5%）；
  - 未落定日的半日 bar **不写入历史**（写入会覆盖同日、永久污染占比分位序列）；
  - 板块当天没有基准日 bar → 记 `stale` 并**排除出阶段判定**（界面显示「滞后 N 日」），不静默当最新用。
  板块日 K 与结构字段落插件自有表（`ctx.db` 的 `plugin_dsh-mainline_board_history`，结构字段在 `days` JSON 列内），日常查看看板只读库不联网。
- **搜索**：`searchStocks`
- **股息筛选（插件 `dsh-dividend-screen`）**：`fetchDividendRank`(TTM 股息率排行前 N，push2delay clist) · `fetchPerfByCodes` ×3 期(今年中报 / 去年中报 / 去年年报，业绩报表 in 分块，年报行带 `MGJYXJJE` 每股经营现金流) · `fetchDividendsByCodes`(多期合并一次查：5 个年度 + 今年中期，分红明细 `REPORT_DATE in (...)`，**每分块仅 1 次请求**) · `fetchDebtRatioByCodes`(负债率，`RPT_DMSK_FN_BALANCE`，报告期字段 `REPORT_DATE` 带下划线，中报 + 去年年报两期一次查逐代码择新，`DEBT_ASSET_RATIO` 为百分数真值)
  ⚠️ 只由用户点击「扫描排行」触发、**不轮询**；全部串行 + 同上游间隔（行情域 1s / datacenter 600ms），样本池 200 时单次扫描约 12 个请求（排行 2 + 业绩 3×2 块 + 分红 1×2 块 + 负债 1×2 块）。结果落插件自有表（`ctx.db` 的 `plugin_dsh_dividend_screen_screen_rows` / `scan_meta` / `config`），重进页面只读库渲染、零联网（持久化缓存，避免重复查询触发东财限速）。推算口径：去年分红率 × 去年全年净利 ×（今年中报净利 ÷ 去年中报净利）÷ 总股本 ÷ 现价。
  **可配置规则引擎（2026-09-20 增）**：页内「+」添加规则，分两组——筛选组（全满足才保留）/ 排除组（命中即剔除标原因），配置持久化 `config` 表。默认预置「伪高股息剔除 + 真高股息筛选」：TTM 股息率>4% ∧ 连续 5 年分红 ∧ 分红率 30~70% ∧ 经营现金流覆盖分红 ≥1 ∧ 负债率 ≤60%；剔除：周期行业关键词（子串匹配 BOARD_NAME）、中报净利同比 <0、分红率 >100%、经营现金流 <0。「非周期顶点」无直接字段，用行业关键词 + 盈利塌陷两层代理。规则评估纯客户端（改规则零联网）。判定三值语义：数据缺失在筛选组 = 不放行、在排除组 = 不剔除。
  - **备选源评估结论：集思录（2026-09-20 实测，暂不接入）** —— 用户提供 `jisilu.cn/data/stock/dividend_rate/`，接口是 `POST https://www.jisilu.cn/data/stock/dividend_rate_list/`（带 `?___jsl=LST___t=<ms>`；页面用 `SimpleTableBuilder`，其 `url_method` 默认 **POST**）。**GET 参数全部被忽略**（8 种查询串返回同一 md5），只认 POST body。**无需登录**，需带 Chrome UA + `Referer`，不限速（连续 6 次 / 0.8s 间隔全部 200，响应 300~670ms）。
  - **免费额度是硬限制**：非会员**无分页**（`page` 参数无效）、每次最多 100 行；**不能按代码查**（`stock_id` / `code` 均被忽略 → 返回默认榜）。只认页头 SearchForm 的字段：`market`(sh/sz)、`industry`、`province`、`pe`、`pb`、`dividend_rate`、`roe`、`pe_temperature`、`pb_temperature`、`aft_dividend`、`roe_average`、`revenue_average`、`profit_average`、`eps_growth_ttm` 等；**数值字段筛选生效时结果按该字段降序**。阈值分档拿不到更深数据：`dividend_rate≥5`（201 只满足）与 `≥3`（642 只）返回的是**同一批 top100**，只有 `≥7`（54 只）跌进 100 以内才给全量。
  - **覆盖率实测**：换筛选字段 = 换一批 top100 → 7 个维度（`dividend_rate≥0` 全市场/沪/深、默认榜沪/深、`roe≥8`、`eps_growth_ttm≥0`）合并得 384 只，**覆盖东财 top200 的 83%**（166/200）；单用 `dividend_rate≥0` 只有 40.5%。未覆盖的多是排名边缘大盘蓝筹（中国石油 / 伊利 / 中国电信这类）。
  - **口径（⚠️ 与本项目自算值不可互换）**：`dividend_rate2` 是**静态股息率，按「分红到账的自然年」归集**，而本项目「去年股息率」按**财务报告期**（FY 年度分红方案）归集 → 实测达仁堂 3.71% vs 自算 6.78%、汇洁股份 6.22% vs 自算 11.05%（差异源于跨年到账）。反向地，`eps_growth_ttm`（最新报告期归母净利同比）与本项目推算的「今年中报 ÷ 去年中报」**完全同口径**（荣晟环保 65.54% vs 自算 65.5%）→ 可作推算核心输入的交叉校验源。
  - **独有增量字段**（东财 clist 一个都没有，可用于检验「去年分红率可延续」这一推算假设）：`aft_dividend`/`dividend_rate5`(5 年平均股息率)、`roe_average`、`revenue_average`·`profit_average`·`cashflow_average`(5 年复合增长)、`debt_rate`·`int_debt_rate`(资产负债率/有息负债率)、`pe_temperature`·`pb_temperature`、`industry_nm2`、`province`、`last_dt`(数据时点=最近交易日)。会员占位：`stdevry`(波动率)、`pledge_rt`(质押比例)返回字符串 `'buy'`，解析必须过滤非数值。
  - **未接入原因**：100 行/次 + 不可按代码查 → 只能靠多维度 top100 拼批、无法保证覆盖任一给定样本池；且两个股息率口径不同，并列展示易被误读。探针脚本 `.ai/tmp/jsl_probe.py`·`jsl_probe2.py`·`jsl_probe3.py`，覆盖率实验 `jsl_coverage.py`，口径对账 `jsl_reconcile.py`。

---

## 4. 取数失败排查清单

1. **先看是不是东财行情域**：`push2` 在本机仍全封（含数字前缀镜像，`fetch failed` / TCP RST），`push2his` 已恢复可达（2026-09-18）→ **不要因为「历史上封过」就把 fflow / 分时也改道到 push2delay**（资金流历史在 push2delay 上只有当日 1 条，见 §0）。指数成交额走 §1 腾讯 `newfqkline`；个股日 K 仍走新浪 `fetchSinaKline`（复权口径决定，与封禁无关）。
2. **HTTP 200 不等于有数据**：`push2delay` 的 kline 返回 200 但 `klines` 空。解析前必须校验拿到非空数据，否则会把「上游无数据」当成成功，页面表现为**空白且无报错**。
3. **新域名 403 FORBIDDEN_TARGET**：补 `proxy.constants.ts` 白名单（浏览器）+ capability scope（Tauri）。
4. **403 / 空数据**：检查 `Referer`（新浪/同花顺需带），或上游换了字段（参考 `.ai/` 下的新浪接口文档、新浪新闻接口文档）。
5. **JSONP 源乱码**：确保 `proxyFetch` 按 `arrayBuffer` 透传、腾讯源由 SDK 按 GBK 解码，不要自行转码。
6. **同花顺板块日 K 502 / 空**：分两种——① **瞬时 502**（openresty 网关，**按文件**发生且呈突发簇：同一板块年文件 502 而 `last.js` 200）→ 回退链已含近端 `last.js`、同一候选对 5xx 原地重试一次、扫描整轮跑完再补采一轮，三层叠加后仍失败才记该板块失败；② 该板块在该复权口径下确实无数据 → 继续沿回退链换文件/复权，6 个候选全空才记失败（扫描结果里计入失败数，不静默）。
7. **封 IP**：东财高频 → 全域名 TCP RST 数十分钟；重接口严格错峰、低并发（≤3）、不轮询。
8. **境外财经站（已评估否决，勿重复尝试）**：**华尔街日报中文版 `cn.wsj.com` 不可接入**——境内 DNS 污染（解析到 108.160.169.55 / 31.13.69.245 等无关段）+ TCP 443 全超时；走本机代理（Clash 7897）或 DoH 取真实 Akamai IP 后，仍被 **DataDome 反爬**挡回 `401`（响应含 `set-cookie: datadome=…`，正文是「Please enable JS and disable any ad blocker」）→ **纯 HTTP 抓取永远拿不到 HTML，必须能执行 JS 的真浏览器**；存档站 `archive.org` 整域不可达，三方中转（allorigins / corsproxy / codetabs / r.jina.ai）全灭；WSJ 官方 RSS（`feeds.a.dj.com`）**已停更**（冻结在 2025-01-27）。同集团 MarketWatch 的 `feeds.content.dowjones.io/public/rss/mw_topstories`、`mw_bulletins` 实测**实时可达**（英文），是唯一可用的道琼斯系替代源。财联社 `www.cls.cn` 同理：站点下发 Next.js 壳、正文靠客户端再拉，需 `sign = md5(sha1(sortedQuery))`，暂缓。
