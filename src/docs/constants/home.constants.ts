/** 官网首页功能亮点卡（文案压缩自 README，chapterId 指向文档中心章节锚点） */
export interface HomeFeature {
  /** 卡片图标（Unicode 字符，不引外部图标库） */
  icon: string;
  /** 功能名 */
  title: string;
  /** 一句话说明 */
  desc: string;
  /** 「了解更多」跳转的文档章节 id（与白皮书章节 id 一致） */
  chapterId: string;
}

/** 首页六大功能亮点（顺序即展示顺序） */
export const HOME_FEATURES: readonly HomeFeature[] = [
  {
    icon: '▦',
    title: '市场总览',
    desc: '大盘核心指数与全球指数、涨跌分布、大盘资金流、板块热力图与成交额趋势，交易时段自动轮询刷新。',
    chapterId: 'dashboard',
  },
  {
    icon: '▤',
    title: '题材轮动',
    desc: 'bump 图追板块名次连线、涨跌停矩阵看热度扩散、赚钱效应气泡图量当日强弱，主线与退潮一眼可辨。',
    chapterId: 'board-calendar',
  },
  {
    icon: '≋',
    title: '市场宽度',
    desc: 'ADL / ADR / OBOS / ARMS / MCO 五大广度指标副图，每图带白话解读，判断大盘强弱与拐点。',
    chapterId: 'market-breadth',
  },
  {
    icon: '⌕',
    title: '热点新闻',
    desc: '新浪 / 同花顺 / 东方财富 / 澎湃 / 财联社 / 通达信六源卡片流，AI 分析抓取正文解读利好利空。',
    chapterId: 'hot-news',
  },
  {
    icon: '✦',
    title: '今天炒什么',
    desc: '同花顺 / 东方财富 / 财联社 / 通达信 / 雪球五平台热股榜聚合，跨平台共识一目了然，榜单行直达个股详情。',
    chapterId: 'hot-board',
  },
  {
    icon: '◉',
    title: 'Agent 分析',
    desc: '内置 AI 分析师，多轮对话解读盘面与个股；可调用内置 MCP 工具查行情、查本机数据库。',
    chapterId: 'agent',
  },
  {
    icon: '⬡',
    title: '插件工坊',
    desc: '插件化架构：官方插件 zip 包安装、一键卸载；贡献点与宿主服务开放给第三方插件。',
    chapterId: 'plugins',
  },
  {
    icon: '⚔',
    title: '机构行为',
    desc: '中金所 CCPM 席位持仓行为分析：净增减翻译成行为标签，席位画像快速识别主力方向。',
    chapterId: 'futures-institutional',
  },
] as const;
