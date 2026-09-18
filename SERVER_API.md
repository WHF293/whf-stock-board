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
- **本机关键约束（踩坑结论，2026-09-14 实测复现）**：
  - ⚠️ **东财行情域 `push2his.eastmoney.com` 与 `push2.eastmoney.com` 在本机长期表现为被 TCP 层封禁**（`fetch failed` / `UND_ERR_SOCKET`，即 AGENTS 里记的「东财封 IP」）。**带数字前缀的镜像域同样不可达**（实测 `1./13./45.push2his`、`1./7./20./45./91.push2` 全部失败）→ `stock-sdk` 的 `sdk.kline.*` / `sdk.batch.cn` 等走东财行情域的方法也随之失败。
  - 📌 **2026-09-18 补充实测（口径修正：突发限速，不是永久封禁）**：该域**间隔 ≥1s 时可用**——`push2his/api/qt/stock/kline/get?secid=90.BKxxxx`（板块指数日 K，含成交额）与 `push2/api/qt/clist/get`（板块快照）均返回 200 且数据非空；但**短时间连发会立刻拒连**（curl `000`），停顿约 20s 后自动恢复。**结论：可作兜底源，但必须严格低频（点击触发、串行 + ≥1s 间隔），不能当稳定主源或轮询源。**
  - 同属东财但**实测可达**的域：`push2delay.eastmoney.com`（快照列表 / 分时 `trends2`）、`push2ex`（涨停池）、`datacenter-web`、`np-listapi`（7×24 快讯）。
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

---

## 2. stock-sdk 方法调用（`sdk` 单例，`src/api/sdk.ts`）

`stock-sdk` 内部按方法路由到腾讯 / 东方财富不同域。**走东财行情域（`push2` / `push2his`）的方法在本机不可用**（已被 TCP 层封禁，见 §0），走腾讯源的方法（`quotes` / `calendar` / `search` / `timeline`）正常；「个股详情」的日 K 已改走新浪（见 §1）。

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
| `fetchMarketFundFlow` | `api/flow.api.ts` | `sdk.fundFlow.market()` | 东财 | 大盘资金流向历史（总览「资金速览」） |
| `fetchIndividualFundFlow` | `api/flow.api.ts` | `sdk.fundFlow.individual(symbol)` | 东财 | 个股资金流历史（详情页） |
| `fetchFundFlowRank` | `api/flow.api.ts` | `sdk.fundFlow.rank({indicator:'today'})` | 东财 | 个股主力资金流排名 |
| `fetchSectorFundFlowRank` | `api/flow.api.ts` | `sdk.fundFlow.sectorRank({sectorType:'industry'})` | 东财 | 板块资金流排名 |
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
- **股票主线（侧栏插件 `dsh-mainline`）**：`fetchThsBoardPage`(清单+结构快照，含 1 次分页) · `fetchThsBoardKline`(×90) · `fetchMarketTurnover`(复用宿主，算成交占比分母) · `fetchZtPool('zt', 基准日)`(涨停结构)
  ⚠️ 只由用户点击「扫描主线」触发、**不轮询**；同上游并发 3 + 连续间隔 500ms（`MAINLINE_SCAN_CONCURRENCY` / `MAINLINE_SCAN_DELAY_MS`）。
  单次扫描请求数 ≈ **94**（清单首页 1 + 分页 1 + 板块年 K 90 + 两市成交额 1 + 涨停池 1；板块失败补采轮另计）。
  **可靠性（2026-09-18 实测）**：`d.10jqka.com.cn` 的 openresty 网关会**瞬时 502 且按文件发生** —— 同一板块年文件 `2026.js` 502 而 `last.js` 200。三层兜底：① 回退链含近端 `last.js`（同源同口径，与年 K 重叠日期数值逐日一致）；② 同一候选 URL 对 5xx 原地重试一次（`THS_BOARD_KLINE_URL_ATTEMPTS`）；③ 整轮跑完隔 2s 对失败板块**补采一轮**（`MAINLINE_SCAN_RETRY_DELAY_MS`）。三层全失败才记 failures 并提示（保留本地旧数据）。
  **未实现的兜底（评估完成、待决策）**：跨源兜底（东财板块日 K `secid=90.BKxxxx` + 东财板块快照 `clist m:90+t:2` 的 f104/f105/f62）——技术可达，但东财行业分类与同花顺不同源（名称映射实测 62/90 直接命中、剥罗马数字后缀后 71/90），**混排会污染量能/占比序列**，只能「整段降级 + 标记来源」，见 `.ai/开发方案/2026-09-18-数据源兜底方案.md`。
  **口径（必须遵守，否则指标会错）**：
  - 全部指标取**基准交易日截面** —— 基准日 = 最近一个「有行情的板块数 ≥ 清单总数 × 85%」的交易日，且**当日数据未落定（本地 < 15:30）时排除当日**（盘中分子是半日混合、分母是半日全市场，实测占比仅 35.6% 而完整日为 98.5%）；
  - 未落定日的半日 bar **不写入历史**（写入会覆盖同日、永久污染占比分位序列）；
  - 板块当天没有基准日 bar → 记 `stale` 并**排除出阶段判定**（界面显示「滞后 N 日」），不静默当最新用。
  板块日 K 与结构字段落插件自有表（`ctx.db` 的 `plugin_dsh-mainline_board_history`，结构字段在 `days` JSON 列内），日常查看看板只读库不联网。
- **搜索**：`searchStocks`

---

## 4. 取数失败排查清单

1. **先看是不是东财行情域**：`push2` / `push2his`（含数字前缀镜像）在本机全封，凡走这些域的请求都会 `fetch failed` / TCP RST。指数成交额走 §1 腾讯 `newfqkline`；个股日 K 走新浪 `fetchSinaKline`。
2. **HTTP 200 不等于有数据**：`push2delay` 的 kline 返回 200 但 `klines` 空。解析前必须校验拿到非空数据，否则会把「上游无数据」当成成功，页面表现为**空白且无报错**。
3. **新域名 403 FORBIDDEN_TARGET**：补 `proxy.constants.ts` 白名单（浏览器）+ capability scope（Tauri）。
4. **403 / 空数据**：检查 `Referer`（新浪/同花顺需带），或上游换了字段（参考 `.ai/` 下的新浪接口文档、新浪新闻接口文档）。
5. **JSONP 源乱码**：确保 `proxyFetch` 按 `arrayBuffer` 透传、腾讯源由 SDK 按 GBK 解码，不要自行转码。
6. **同花顺板块日 K 502 / 空**：分两种——① **瞬时 502**（openresty 网关，**按文件**发生且呈突发簇：同一板块年文件 502 而 `last.js` 200）→ 回退链已含近端 `last.js`、同一候选对 5xx 原地重试一次、扫描整轮跑完再补采一轮，三层叠加后仍失败才记该板块失败；② 该板块在该复权口径下确实无数据 → 继续沿回退链换文件/复权，6 个候选全空才记失败（扫描结果里计入失败数，不静默）。
7. **封 IP**：东财高频 → 全域名 TCP RST 数十分钟；重接口严格错峰、低并发（≤3）、不轮询。
8. **境外财经站（已评估否决，勿重复尝试）**：**华尔街日报中文版 `cn.wsj.com` 不可接入**——境内 DNS 污染（解析到 108.160.169.55 / 31.13.69.245 等无关段）+ TCP 443 全超时；走本机代理（Clash 7897）或 DoH 取真实 Akamai IP 后，仍被 **DataDome 反爬**挡回 `401`（响应含 `set-cookie: datadome=…`，正文是「Please enable JS and disable any ad blocker」）→ **纯 HTTP 抓取永远拿不到 HTML，必须能执行 JS 的真浏览器**；存档站 `archive.org` 整域不可达，三方中转（allorigins / corsproxy / codetabs / r.jina.ai）全灭；WSJ 官方 RSS（`feeds.a.dj.com`）**已停更**（冻结在 2025-01-27）。同集团 MarketWatch 的 `feeds.content.dowjones.io/public/rss/mw_topstories`、`mw_bulletins` 实测**实时可达**（英文），是唯一可用的道琼斯系替代源。财联社 `www.cls.cn` 同理：站点下发 Next.js 壳、正文靠客户端再拉，需 `sign = md5(sha1(sortedQuery))`，暂缓。
