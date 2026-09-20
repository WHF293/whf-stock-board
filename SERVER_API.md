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
| `fetchThsBoardList` | `plugins/mainline/ths-data.ts` | `q.10jqka.com.cn/thshy/` | GET | 同花顺行业板块清单（**GBK HTML**）。按 `detail/code/88xxxx` 锚点正则抽取后去重（页面含同一板块多份重复链接），只留 `88` 开头的行业板块。带 `Referer: q.10jqka.com.cn` |
| `fetchThsBoardKline` | `plugins/mainline/ths-data.ts` | `d.10jqka.com.cn/v6/line/48_<板块码>/<复权>/<年>.js` | GET(JSONP) | 同花顺板块**年 K**（含成交额）：剥 JSONP 壳后 `data` 为 `日期,开,高,低,收,量,额,…` 逐日分号分隔。⚠️ **复权口径必须回退**：部分板块 `01`（前复权）年文件被上游网关拒（502）、另一些仅 `00`（不复权）可用 → 按「当年 01 → 当年 00 → 去年 01 → 去年 00」逐个尝试，首个有数据者胜出。带 `Referer` |
| `fetchBoardFlowHistories` / `fetchBoardFlowHotBoards` | `api/board-flow-history.api.ts` | `push2his.eastmoney.com/api/qt/stock/fflow/daykline/get`（逐日历史）+ `push2delay.eastmoney.com/api/qt/clist/get`（热点名单 f174 排行） | GET | 板块（行业/概念）**逐日主力净流入历史**。消费方：Agent MCP `get_board_flow_history` + 市场榜单「板块净流入 → 查看历史净流入」页。历史在本机渐进累积（`localStorage['whf:sector-flow-history']`，独立 key 防整包写放大）：盘中进页拉新合并（同日 5 分钟节流）、盘后 / 非交易日只读本地、首次一次拉全量，每板块保留 250 交易日。**并发 3 + 每请求 500ms 错峰**（⚠️ 30 连发无间隔是 push2his 对本机 IP 封禁诱因之一，见 §0 2026-09-20 记录） |

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
| `fetchZtPool` | `api/event.api.ts` | `sdk.marketEvent.ztPool(type)` | 东财 | 涨停/跌停等股池 |
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
- **股票主线（侧栏插件 `dsh-mainline`）**：`fetchThsBoardList` · `fetchThsBoardKline` · `fetchMarketTurnover`(复用宿主，算成交占比分母)
  ⚠️ 只由用户点击「扫描主线」触发、**不轮询**；同上游并发 3 + 连续间隔 500ms（`MAINLINE_SCAN_CONCURRENCY` / `MAINLINE_SCAN_DELAY_MS`）。
  板块日 K 落插件自有表（`ctx.db` 的 `plugin_dsh-mainline_board_history`），日常查看看板只读库不联网。
- **搜索**：`searchStocks`

---

## 4. 取数失败排查清单

1. **先看是不是东财行情域**：`push2` 在本机仍全封（含数字前缀镜像，`fetch failed` / TCP RST），`push2his` 已恢复可达（2026-09-18）→ **不要因为「历史上封过」就把 fflow / 分时也改道到 push2delay**（资金流历史在 push2delay 上只有当日 1 条，见 §0）。指数成交额走 §1 腾讯 `newfqkline`；个股日 K 仍走新浪 `fetchSinaKline`（复权口径决定，与封禁无关）。
2. **HTTP 200 不等于有数据**：`push2delay` 的 kline 返回 200 但 `klines` 空。解析前必须校验拿到非空数据，否则会把「上游无数据」当成成功，页面表现为**空白且无报错**。
3. **新域名 403 FORBIDDEN_TARGET**：补 `proxy.constants.ts` 白名单（浏览器）+ capability scope（Tauri）。
4. **403 / 空数据**：检查 `Referer`（新浪/同花顺需带），或上游换了字段（参考 `.ai/` 下的新浪接口文档、新浪新闻接口文档）。
5. **JSONP 源乱码**：确保 `proxyFetch` 按 `arrayBuffer` 透传、腾讯源由 SDK 按 GBK 解码，不要自行转码。
6. **同花顺板块年 K 502 / 空**：不是封禁，而是该板块在该复权口径下不可用 → 按回退链换口径/年份；若四种组合全空才记该板块取数失败（扫描结果里会计入失败数，不静默）。
7. **封 IP**：东财高频 → 全域名 TCP RST 数十分钟；重接口严格错峰、低并发（≤3）、不轮询。
8. **境外财经站（已评估否决，勿重复尝试）**：**华尔街日报中文版 `cn.wsj.com` 不可接入**——境内 DNS 污染（解析到 108.160.169.55 / 31.13.69.245 等无关段）+ TCP 443 全超时；走本机代理（Clash 7897）或 DoH 取真实 Akamai IP 后，仍被 **DataDome 反爬**挡回 `401`（响应含 `set-cookie: datadome=…`，正文是「Please enable JS and disable any ad blocker」）→ **纯 HTTP 抓取永远拿不到 HTML，必须能执行 JS 的真浏览器**；存档站 `archive.org` 整域不可达，三方中转（allorigins / corsproxy / codetabs / r.jina.ai）全灭；WSJ 官方 RSS（`feeds.a.dj.com`）**已停更**（冻结在 2025-01-27）。同集团 MarketWatch 的 `feeds.content.dowjones.io/public/rss/mw_topstories`、`mw_bulletins` 实测**实时可达**（英文），是唯一可用的道琼斯系替代源。财联社 `www.cls.cn` 同理：站点下发 Next.js 壳、正文靠客户端再拉，需 `sign = md5(sha1(sortedQuery))`，暂缓。
