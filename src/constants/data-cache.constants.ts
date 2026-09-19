/**
 * 接口数据内存快照缓存键集中管理（代替魔法字符串）
 */
export const DATA_CACHE_KEY = {
  /** 总览：指数行情 */
  DASHBOARD_INDEX_QUOTES: 'dashboard.indexQuotes',
  /** 总览：市场宽度聚合（分布 / 成交额 / 板块 / 资金流 / 北向） */
  DASHBOARD_BREADTH: 'dashboard.breadth',
  /** 总览：沪深两市总成交额历史（成交量变化模块） */
  DASHBOARD_TURNOVER: 'dashboard.turnover',
  /** 自选：报价映射 */
  WATCHLIST_QUOTES_MAP: 'watchlist.quotesMap',
  /** 板块排行（按 tab） */
  BOARDS_LIST: 'boards.list',
  /** 板块成分股（前缀 + 板块代码） */
  BOARDS_CONSTITUENTS_PREFIX: 'boards.constituents.',
  /** 资金动向四象限 */
  FUNDS_MARKET_FLOW: 'funds.marketFlow',
  FUNDS_SECTOR_RANK: 'funds.sectorRank',
  FUNDS_STOCK_RANK: 'funds.stockRank',
  FUNDS_NORTH_RANK: 'funds.northRank',
  /** 行业资金曲线（含归属交易日，会话内复用） */
  FUNDS_SECTOR_CURVE: 'funds.sectorCurve',
  /** 股池（前缀 + 池类型） */
  EVENT_POOL_PREFIX: 'event.pool.',
  EVENT_STOCK_CHANGES: 'event.stockChanges',
  EVENT_BOARD_CHANGES: 'event.boardChanges',
  /** 龙虎榜 / 大宗明细 */
  DRAGON_TIGER_ITEMS: 'dragonTiger.items',
  BLOCK_TRADE_ITEMS: 'blockTrade.items',
  /** 行情全景：美股 / 全球宏观（A股板块排行复用 BOARDS_LIST 键） */
  PANORAMA_US_BOARDS: 'panorama.usBoards',
  PANORAMA_MACRO: 'panorama.macro',
  /** 个股详情（前缀 + 符号 / 口径） */
  DETAIL_QUOTE_PREFIX: 'detail.quote.',
  DETAIL_TIMELINE_PREFIX: 'detail.timeline.',
  DETAIL_KLINE_PREFIX: 'detail.kline.',
  HOT_NEWS_ITEMS: 'hot-news.items.',
  /** 市场榜单：全 A 股报价快照（按 sortKey 客户端排序） */
  MARKET_RANK_QUOTES: 'marketRank.quotes',
  /** 板块日历：交易日轴（会话内复用，避免每次挂载都请求腾讯） */
  BOARD_CALENDAR_DATES: 'boardCalendar.dates',
  /** 板块日历：矩阵原始行（切页秒出，接口返回后覆盖） */
  BOARD_CALENDAR_MATRIX: 'boardCalendar.matrix',
  /** 板块日历详情：成分股涨跌幅矩阵（前缀 + 板块代码 + 范围，切页回来秒出） */
  BOARD_DETAIL_MATRIX_PREFIX: 'boardDetail.matrix.',
} as const;
