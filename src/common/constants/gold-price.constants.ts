/**
 * 当日金价模块常量（2026-11-07 王总指定新增，替换市场总览「市场宽度 · ARMS」速览卡）
 *
 * 数据源：金投网行情中心（api.jijinhao.com）——品牌金店挂牌价的聚合源，
 * 响应为 `var quote_json = {...}` 脚本包装 JSON；金店类 code 最新价在 `q63`、
 * 涨跌 `q70`、涨跌幅 `q80`、单位 `unit`、名称 `showName`；接口必须携带
 * 金投站内 Referer（quote.cngold.org 页面），否则返回 HTTP 666 反爬空响应。
 * 2026-11-07 探活结论与逐 code 数值核对记录见 SERVER_API.md 与 .ai/memory/2026-11-07.md。
 */
import type { GoldBrandCodeDef } from '../types/gold-price.types.ts';

/** 金投行情中心实时接口（多 code 逗号并取，一次请求拉全部） */
export const GOLD_PRICE_REALTIME_URL = 'https://api.jijinhao.com/quoteCenter/realTime.htm';

/** 金投行情中心历史接口（单 code 日线，供单品牌近 N 日走势） */
export const GOLD_PRICE_HISTORY_URL = 'https://api.jijinhao.com/quoteCenter/history.htm';

/** 金投接口必须的站内 Referer（水贝黄金行情页；realTime 与 history 通用） */
export const GOLD_PRICE_REFERER = 'https://quote.cngold.org/gjs/swhj.html';

/** 新浪外汇实时接口（美元兑人民币在岸汇率，用于伦敦金「折合元/克」换算） */
export const GOLD_FX_SINA_URL = 'https://hq.sinajs.cn/list=fx_susdcny';

/** 新浪外汇接口的站内 Referer */
export const GOLD_FX_SINA_REFERER = 'https://finance.sina.com.cn/';

/** 金衡盎司 → 克（伦敦金美元/盎司 折算 元/克 的换算系数） */
export const TROY_OUNCE_TO_GRAM = 31.1034768;

/**
 * 金店品牌行情 code 映射（2026-11-07 探活确认，数值与美基星图品牌参考价逐项核对一致）
 *
 * - `ornament`：足金饰品价 code（品牌主价，黄金价格口径）
 * - `bar`：投资金条价 code（品牌未在金投开设金条行情时缺省，展示为 `--`；
 *   谢瑞麟暂无金投行情 code，后续发现再补入本表）
 */
export const GOLD_BRAND_CODES: readonly GoldBrandCodeDef[] = [
  { key: 'zhoudafu', label: '周大福', ornament: 'JO_42660', bar: 'JO_56037' },
  { key: 'laofengxiang', label: '老凤祥', ornament: 'JO_42657', bar: 'JO_42656' },
  { key: 'zhoushengsheng', label: '周生生', ornament: 'JO_42625', bar: 'JO_56045' },
  { key: 'liufu', label: '六福珠宝', ornament: 'JO_42646', bar: 'JO_56041' },
  { key: 'laomiao', label: '老庙黄金', ornament: 'JO_42634', bar: 'JO_42637' },
  { key: 'zhouliufu', label: '周六福', ornament: 'JO_42653' },
  { key: 'caibai', label: '菜百首饰', ornament: 'JO_42638', bar: 'JO_42645' },
  { key: 'jinzunzun', label: '金至尊', ornament: 'JO_42632' },
  { key: 'chaohongji', label: '潮宏基', ornament: 'JO_52670', bar: 'JO_351254' },
  { key: 'zhoudasheng', label: '周大生', ornament: 'JO_52678', bar: 'JO_351256' },
  { key: 'zhongguohuangjin', label: '中国黄金', ornament: 'JO_348900', bar: 'JO_52684' },
  { key: 'shuibei', label: '深圳水贝', ornament: 'JO_346627', bar: 'JO_346629' },
];

/** 品牌切换 chips 的「全部」档 value（单品牌档 value = 品牌 key） */
export const GOLD_BRAND_ALL_KEY = 'all';

/** 国内基准金价 code（中国黄金基础金价，随上海金交所原料金波动，供品牌溢价对照） */
export const GOLD_BASIS_CODE = 'JO_52683';

/** 国际现货黄金（伦敦金 XAU）code，单位 美元/盎司 */
export const GOLD_SPOT_XAU_CODE = 'JO_92233';

/** 单品牌走势图的天数（近 N 个交易日足金饰品价） */
export const GOLD_HISTORY_DAYS = 30;

/** 新浪外汇应答中「买价 / 卖价」字段位（取中间价为折算汇率） */
export const GOLD_FX_BID_INDEX = 1;
export const GOLD_FX_ASK_INDEX = 2;
