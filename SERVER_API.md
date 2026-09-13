# SERVER_API.md — 接口与数据源清单

> 本文件盘点项目所有「请求了什么接口 / 调用了 stock-sdk 什么方法」，供排查取数失败、新增数据源时对照。
> 数据通道、代理白名单、频率红线的权威约定见 `AGENTS.md` / `CLAUDE.md`（根目录）的「数据通道」「请求频率红线」两节。

## 0. 数据通道总览

- **唯一出口**：所有 `fetch` 型请求都经 `src/api/proxy-fetch.ts`（`proxyFetch`）；`stock-sdk` 的 `fetchImpl` 也被注入为 `proxyFetch`（`src/api/sdk.ts`）。
  - 浏览器态：同源 `/stock-proxy?u=<encoded>` 由 `server/stock-proxy-middleware.ts` 转发。
  - Tauri 态：`tauri-plugin-http` 由 Rust 直连，域名白名单在 `src-tauri/capabilities/default.json`。
- **代理白名单**：`src/constants/proxy.constants.ts` 的 `STOCK_PROXY_ALLOWED_HOSTS`（后缀匹配）：
  `eastmoney.com`、`gtimg.cn`、`sina.com.cn`、`sina.cn`、`sinajs.cn`、`10jqka.com.cn`、`cls.cn`、`linkdiary.cn`。
  新增域名需同步改这里（浏览器）与 capability（Tauri）。
- **本机关键约束（踩坑结论）**：
  - ⚠️ **东方财富 `push2his.eastmoney.com` 在本机被 TCP 层封禁**（`UND_ERR_SOCKET`，即 AGENTS 里记的「东财封 IP」只落在这个子域）。`stock-sdk` 的 `sdk.kline.cn` 走此域 → **不可用**。
  - 同属东财但**可达**的域：`push2.eastmoney.com`、`push2delay.eastmoney.com`（panorama / sdk 的 clist·kamtbs·fundFlow·board 等均走这些，正常工作）。
  - **指数日 K 成交额**因此改用 `push2.eastmoney.com/api/qt/stock/kline/get` 直连（见 §1 的 `fetchMarketTurnover`），不依赖 `sdk.kline.cn`。
  - 新浪 `quotes.sina.cn` K 线、**无成交金额字段**（仅 `volume` 成交量），且 `volume×收盘价` 对指数不成立（实测约为真实成交额的 235 倍），故个股详情/成交额均不依赖新浪算金额。
- **频率红线**：东财系高频会封 IP；全市场快照串行 `batchSize 500 / concurrency 1`，同上游连续请求 `delay(500)` 错峰，重接口（快照/K线/资金流/分时）一律用户点击触发、不轮询。

---

## 1. 直连 fetch 接口（`src/api/*` 中直接 `proxyFetch` 的源）

| 封装函数 | 文件 | 上游 URL（host） | 方法 | 说明 / 字段 |
| --- | --- | --- | --- | --- |
| `fetchSinaKline` | `api/sina-kline.api.ts` | `quotes.sina.cn/cn/api/jsonp_v2.php/var _=/CN_MarketDataService.getKLineData` | GET(JSONP) | 新浪 K 线（日/周/月/分钟）。返回 `day,open,high,low,close,volume`；日 K **无 amount（成交金额）**。带 `Referer: finance.sina.com.cn`。用于个股详情 `StockDetailPanel`、原成交额模块已弃用 |
| `fetchSinaHotNews` | `api/news.api.ts` | `feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516/2517` | GET | 新浪滚动热点（财经综合 2516 / 股市快讯 2517）。带 `Referer: finance.sina.com.cn` |
| `fetchEastmoneyHotNews` | `api/news.api.ts` | `np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102` | GET | 东财 7×24 快讯，游标翻页（`sortEnd`）。无原文链接，点击跳 `so.eastmoney.com/news/s?keyword=` |
| `fetchThsHotNews` | `api/news.api.ts` | `news.10jqka.com.cn/tapp/news/push/stock/?page=&limit=` | GET | 同花顺股市快讯。带 `Referer: 10jqka.com.cn` |
| `fetchMarketTurnover` | `api/turnover.api.ts` | `push2.eastmoney.com/api/qt/stock/kline/get`（兜底 `push2delay.eastmoney.com`） | GET | **沪深两市成交额**。secid `1.000001`(上证)/`0.399001`(深证)，`klt=101` 日 K，`fields2` 含 `f57`(成交额)。解析 kline 串第 6 段（成交额，元）按日相加。绕开被封的 `push2his` |
| `fetchClist` / `fetchGlobalIndexPanorama` | `api/panorama.api.ts` | `push2delay.eastmoney.com/api/qt/clist/get` | GET | 行情全景：全球指数（`fs=m:100`）、A股板块等快照列表 |
| `fetchUsSectorPanorama` | `api/panorama.api.ts` | `push2delay.eastmoney.com/api/qt/ulist.np/get` | GET | 美股行业 ETF（按 `secids` 精确查询） |
| 更新检查 | `constants/app-info.constants.ts` + `views/SettingsView.vue` | `api.github.com/repos/WHF293/whf-stock-board/releases/latest` | GET | 检查更新（非行情数据） |
| 连通性探针 | `views/SettingsView.vue` | `qt.gtimg.cn/q=sh000001` | GET | 设置页「网络诊断」用腾讯源直连测连通性 |

---

## 2. stock-sdk 方法调用（`sdk` 单例，`src/api/sdk.ts`）

`stock-sdk` 内部按方法路由到腾讯 / 东方财富不同域；除 `sdk.kline.cn`（push2his，被封）外均正常。

| 封装函数 | 文件 | SDK 方法 | 上游域（实测） | 说明 |
| --- | --- | --- | --- | --- |
| `fetchFullQuotes` | `api/quotes.api.ts` | `sdk.quotes.cn(codes)` | 腾讯 | 批量实时行情（腾讯源），codes 为 `sh600519` 完整形态；指数卡、个股报价头 |
| `fetchAllMarketQuotes` | `api/quotes.api.ts` | `sdk.batch.cn({batchSize:500,concurrency:1})` | 东财 clist | 全市场 A 股快照（涨跌分布/市场宽度）；串行分页约 11 页 |
| `fetchIndustryBoards` | `api/board.api.ts` | `sdk.board.industry.list()` | 东财 | 行业板块列表 |
| `fetchConceptBoards` | `api/board.api.ts` | `sdk.board.concept.list()` | 东财 | 概念板块列表 |
| `fetchIndustryConstituents` | `api/board.api.ts` | `sdk.board.industry.constituents(symbol)` | 东财 | 行业板块成分股（点击触发，重接口） |
| `fetchConceptConstituents` | `api/board.api.ts` | `sdk.board.concept.constituents(symbol)` | 东财 | 概念板块成分股（点击/选股器触发） |
| `fetchZtPool` | `api/event.api.ts` | `sdk.marketEvent.ztPool(type)` | 东财 | 涨停/跌停等股池 |
| `fetchStockChanges` | `api/event.api.ts` | `sdk.marketEvent.stockChanges('all')` | 东财 | 全市场盘口异动（滚动时间轴） |
| `fetchBoardChanges` | `api/event.api.ts` | `sdk.marketEvent.boardChanges()` | 东财 | 板块异动汇总 |
| `fetchMarketFundFlow` | `api/flow.api.ts` | `sdk.fundFlow.market()` | 东财 | 大盘资金流向历史（总览「资金速览」） |
| `fetchIndividualFundFlow` | `api/flow.api.ts` | `sdk.fundFlow.individual(symbol)` | 东财 | 个股资金流历史（详情页） |
| `fetchFundFlowRank` | `api/flow.api.ts` | `sdk.fundFlow.rank({indicator:'today'})` | 东财 | 个股主力资金流排名 |
| `fetchSectorFundFlowRank` | `api/flow.api.ts` | `sdk.fundFlow.sectorRank({sectorType:'industry'})` | 东财 | 板块资金流排名 |
| `fetchNorthboundHoldingRank` | `api/flow.api.ts` | `sdk.northbound.holdingRank({market:'all',period:'today'})` | 东财 | 北向持股排名 |
| `fetchIsTradingDay` | `api/calendar.api.ts` | `sdk.calendar.isTradingDay()` | 腾讯日历 | 是否 A 股交易日（异步，带缓存） |
| `getMarketStatus` | `api/calendar.api.ts` | `sdk.calendar.marketStatus(market)` | 同步 | 当前市场状态（盘前/交易中/午休/盘后/休市，不识假） |
| `fetchTodayTimeline` | `api/kline.api.ts` | `sdk.quotes.timeline(symbol)` | 腾讯(JSONP) | 当日分时（昨收+逐分钟价/均价） |
| `fetchKlineWithIndicators` | `api/kline.api.ts` | `sdk.kline.withIndicators(symbol,{period,adjust,startDate,indicators})` | 东财 K线(push2 系列) | 日/周 K + MA[5,20]/MACD（**非被封的 push2his**） |
| `fetchKlineSignals` | `api/kline.api.ts` | `sdk.kline.signals(symbol,{...})` | 东财 | 技术信号（MA/MACD 金叉死叉等 14 种） |
| `searchStocks` | `api/search.api.ts` | `sdk.search(keyword)` | 腾讯搜索 | 模糊搜索（代码/名称/拼音） |
| `fetchDragonTigerDetail` | `api/dragon-tiger.api.ts` | `sdk.dragonTiger.detail({startDate,endDate})` | 东财 | 龙虎榜明细（近 N 日） |
| `fetchBlockTradeDetail` | `api/dragon-tiger.api.ts` | `sdk.blockTrade.detail({startDate,endDate})` | 东财 | 大宗交易明细 |
| `runScreener` | `api/screener.api.ts` | `screen(quotes)` + `fetchAllMarketQuotes` | 东财 | 基础条件筛选（全市场快照链式 `where`，按成交额降序取前 N） |
| `runMaCrossBacktest` | `api/screener.api.ts` | `sdk.kline.withIndicators` + `backtest()` | 东财 | MA 金叉死叉回测（近一年日 K 前复权） |
| 信号扫描 | `api/analysis.api.ts` | `sdk.kline.withIndicators`（并发 3） | 东财 | 对股票池逐票拉日 K 判定 MA/MACD/RSI/BOLL 信号 |
| 尾盘选股 | `api/analysis.api.ts` | `sdk.quotes.timeline`（并发 2） + `fetchAllMarketQuotes` | 腾讯+东财 | 全市场快照基础过滤 + 分时强度精筛 |
| `fetchGlobalFuturesPanorama` | `api/panorama.api.ts` | `sdk.futures.globalSpot({pageSize})` | 东财 futsseapi | 外盘商品期货 |
| — | `api/sdk.ts` | `sdk.clearCaches()` | — | 强刷实例缓存（设置页「清除缓存」调用） |

---

## 3. 调用关系速查（页面 → 接口）

- **市场总览 `DashboardView`**：`fetchFullQuotes`(指数卡) · `fetchMarketFundFlow`(资金速览) · `fetchMarketTurnover`(成交额变化) · `fetchIndustryBoards`(板块热力) · `fetchAllMarketQuotes`(涨跌分布)
- **自选股 `WatchlistView`**：`fetchFullQuotes`
- **行情全景 `PanoramaView`**：`fetchGlobalIndexPanorama` · `fetchUsSectorPanorama` · `fetchGlobalFuturesPanorama`
- **资金动向 `FundFlowView`**：`fetchMarketFundFlow` · `fetchFundFlowRank` · `fetchSectorFundFlowRank` · `fetchNorthboundHoldingRank`
- **涨停与异动 `MarketMoodView`**：`fetchZtPool` · `fetchStockChanges` · `fetchBoardChanges`
- **龙虎榜·大宗 `DragonTigerView`**：`fetchDragonTigerDetail` · `fetchBlockTradeDetail`
- **选股器 `ScreenerView`**：`runScreener` · `runMaCrossBacktest` · 信号扫描 / 尾盘选股（`analysis.api`）
- **热点新闻 `HotNewsView`**：`fetchSinaHotNews` · `fetchEastmoneyHotNews` · `fetchThsHotNews`
- **个股详情（停靠面板）`StockDetailPanel`**：`fetchSinaKline`(K线) · `fetchTodayTimeline`(分时) · `fetchIndividualFundFlow` · `fetchKlineWithIndicators` · `fetchKlineSignals`
- **搜索**：`searchStocks`

---

## 4. 取数失败排查清单

1. **先看是不是 `push2his` 域**：凡走 `sdk.kline.cn` 的都会 TCP RST；改用 §1 的 `push2.eastmoney.com` 直连或 `sdk.kline.withIndicators`（push2 系列）。
2. **新域名 403 FORBIDDEN_TARGET**：补 `proxy.constants.ts` 白名单（浏览器）+ capability scope（Tauri）。
3. **403 / 空数据**：检查 `Referer`（新浪/同花顺需带），或上游换了字段（参考 `.ai/` 下的新浪接口文档、新浪新闻接口文档）。
4. **JSONP 源乱码**：确保 `proxyFetch` 按 `arrayBuffer` 透传、腾讯源由 SDK 按 GBK 解码，不要自行转码。
5. **封 IP**：东财高频 → 全域名 TCP RST 数十分钟；严格串行/错峰/不轮询重接口。
