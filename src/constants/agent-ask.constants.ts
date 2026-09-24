/**
 * 「AI 分析」跨页调用常量（热点新闻 AI 总结 / 个股详情 / 市场榜单 AI 分析 → Agent）
 */

/** Tauri 全局事件：主窗口 → Agent 窗口投递分析请求（payload = { prompt }） */
export const AGENT_ASK_EVENT = 'agent:ask';

/** Tauri 全局事件：Agent 窗口就绪回执（新窗口创建后握手，防请求早于监听挂载丢失） */
export const AGENT_READY_EVENT = 'agent:ready';

/** 新窗口创建后等待就绪回执的超时（毫秒；超时按尽力投递处理，直接 emit） */
export const AGENT_ASK_HANDSHAKE_TIMEOUT_MS = 6000;

/** 新闻总结最多携带的条数（防 prompt 无界膨胀） */
export const NEWS_ANALYSIS_MAX_ITEMS = 60;

/** 单条新闻摘要截断长度（字符） */
export const NEWS_ANALYSIS_SUMMARY_MAX_CHARS = 80;

/** 新闻清单整体字符上限（超出截断，宁少勿爆上下文） */
export const NEWS_ANALYSIS_MAX_CHARS = 6000;

/** 新闻总结提示词模板（{news} = 新闻清单占位） */
export const NEWS_ANALYSIS_PROMPT_TEMPLATE =
  '以下是当前展示的全部热点新闻（标题 + 摘要，来自多个新闻源）。' +
  '请通读后总结：①利好哪些板块或个股（说明驱动逻辑）；②利空哪些板块或个股（说明驱动逻辑）。' +
  '用简明的清单输出，板块 / 个股后括注对应新闻依据；没有提到 A 股板块或个股的泛化宏观新闻归入「其他影响」。' +
  '新闻清单如下：\n{news}';

/** 新闻清单单行模板（{media} 来源 / {title} 标题 / {summary} 摘要） */
export const NEWS_ANALYSIS_ITEM_LINE_TEMPLATE = '【{media}】{title}：{summary}';

/** 个股分析提示词模板（{name} 名称 / {symbol} 代码） */
export const STOCK_ANALYSIS_PROMPT_TEMPLATE =
  '请对 {name}（{symbol}）做一次短期综合分析，要求先调用可用的行情与市场数据工具查证，不要凭记忆编造数据：\n' +
  '1. 消息面：近期相关新闻与公告倾向；\n' +
  '2. 资金面：主力资金近期流向；\n' +
  '3. 情绪面：所属板块近期涨停 / 连板与市场情绪；\n' +
  '4. 外围市场影响：隔夜美股与全球指数表现；\n' +
  '5. 短期政策影响：与该公司行业相关的近期政策动向。\n' +
  '最后必须给出明确结论：短期看多 / 看空 / 震荡，并附一句核心理由。';

// ---------- 市场榜单 AI 分析（榜单数据 + 榜单类型 → Agent） ----------

/** 榜单分析单个数据段最多携带的行数（防 prompt 无界膨胀） */
export const RANK_ANALYSIS_MAX_ROWS = 50;

/** 榜单数据整体字符上限（超出截断，宁少勿爆上下文） */
export const RANK_ANALYSIS_MAX_CHARS = 8000;

/** 榜单分析提示词模板（{rank} = 榜单类型名 / {data} = 榜单数据占位） */
export const RANK_ANALYSIS_PROMPT_TEMPLATE =
  '以下是「市场榜单」页面「{rank}」的当前数据（表头 | 值，大额资金数值已换算为万 / 亿）。' +
  '要求先调用可用的行情与市场数据工具核验关键标的的最新情况，不要凭记忆编造，再输出分析：\n' +
  '① 该榜单整体反映的资金面与市场情绪特征；\n' +
  '② 值得关注的板块 / 个股：结合所属板块、资金与涨幅说明驱动逻辑，并提示主要风险；\n' +
  '③ 最后给出 3-5 只重点关注标的，每只附一句话关注理由。\n' +
  '榜单数据：\n{data}';

/** 榜单数据段标题行模板（{title} = 数据段标题） */
export const RANK_ANALYSIS_SECTION_TITLE_TEMPLATE = '【{title}】';

/** 榜单数据单元格分隔符 */
export const RANK_ANALYSIS_CELL_SEPARATOR = ' | ';
