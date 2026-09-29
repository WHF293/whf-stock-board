/**
 * 新股次新股模块常量（行情全景「新股次新股」页签）
 *
 * 数据源为同花顺新股频道「新股申购与上市」整页（GBK 编码，服务端渲染全量清单），
 * 解析见 utils/parse-ipo-board-html.ts；年份由 utils/infer-ipo-year.ts 推断补全
 */

/** 同花顺新股申购与上市页地址（GBK HTML） */
export const IPO_BOARD_URL = 'https://data.10jqka.com.cn/ipo/xgsgyzq/';

/** 缓存有效期（毫秒）：30 分钟，期内切回复用快照，过期后进入页面自动重拉 */
export const IPO_BOARD_TTL_MS = 30 * 60_000;

/** 申购日期范围选项（天，按 |今天 - 申购日期| 过滤；value 为 BaseTabs 字符串） */
export const IPO_BOARD_RANGE_OPTIONS = [
  { label: '10天', value: '10' },
  { label: '30天', value: '30' },
  { label: '60天', value: '60' },
] as const;

/** 申购日期范围默认值（天） */
export const IPO_BOARD_RANGE_DEFAULT = 30;

/** 表格最小宽度（px）：列较多，窄容器下横向滚动 */
export const IPO_BOARD_TABLE_MIN_WIDTH = '960px';
