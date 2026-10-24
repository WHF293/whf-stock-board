import { proxyFetch } from './proxy-fetch.ts';
import {
  F10_CACHE_TTL_MS,
  F10_PAGE_URL_TEMPLATE,
} from '../constants/stock-f10.constants.ts';
import { toFullSymbol } from '../utils/to-full-symbol';
import { parseF10Executives } from '../utils/parse-f10-executives';
import { parseF10HoldRows } from '../utils/parse-f10-hold-rows';
import { parseF10KeyValues } from '../utils/parse-f10-key-values';
import type { F10Executive, F10HoldRow, F10KeyValue } from '../types/stock-f10.types.ts';

/**
 * 个股 F10 数据接口层（东方财富 emh5.eastmoney.com）
 *
 * 上游无 XHR 接口：四个信息页各自是服务端直出的静态 HTML（`/F10/v/<page>?fc=<符号>`），
 * 经代理拉取原文后 DOMParser 解析（纯函数见 utils/parse-f10-*.ts）。
 * emh5.eastmoney.com 已被代理白名单（eastmoney.com 后缀）与 Tauri scope 覆盖。
 *
 * F10 数据以季 / 年为粒度变化，HTML 原文按会话缓存 30 分钟（F10_CACHE_TTL_MS），
 * 解析为纯函数随取随跑不做二级缓存
 */

/** 上游页面段标识（与 URL 路径段一致） */
type F10Page = 'BaseInfo' | 'BasePublish' | 'BaseExecutive' | 'BaseHold';

/** HTML 原文会话缓存（key = 页面段 + 符号） */
const htmlCache = new Map<string, { at: number; data: string }>();

/**
 * 拉取一个 F10 页面的 HTML 原文（带会话缓存）
 * @param page 页面段（BaseInfo / BasePublish / BaseExecutive / BaseHold）
 * @param symbol 标的符号（600519 / sh600519 等形态均可，内部归一化）
 * @param forceRefresh 跳过缓存强制回源
 * @returns HTML 原文
 */
const fetchF10Html = async (page: F10Page, symbol: string, forceRefresh: boolean): Promise<string> => {
  const cacheKey = `${page}:${symbol}`;
  const cached = htmlCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.at < F10_CACHE_TTL_MS) {
    return cached.data;
  }
  const url = F10_PAGE_URL_TEMPLATE.replace('{page}', page).replace('{fc}', toFullSymbol(symbol));
  const response = await proxyFetch(url, { headers: { Accept: 'text/html' } });
  if (!response.ok) {
    throw new Error(`[stock-f10] ${page} HTTP ${response.status}`);
  }
  const html = await response.text();
  htmlCache.set(cacheKey, { at: Date.now(), data: html });
  return html;
};

/**
 * 基本资料（公司名称 / 所属行业 / 公司简介 / 主营业务等键值对）
 * @param symbol 标的符号
 * @param forceRefresh 跳过缓存强制回源
 * @returns 键值对列表（保持上游顺序）
 */
export const fetchF10BaseInfo = async (symbol: string, forceRefresh = false): Promise<F10KeyValue[]> =>
  parseF10KeyValues(await fetchF10Html('BaseInfo', symbol, forceRefresh), '.base-info dl');

/**
 * 发行相关（上市日期 / 发行价格 / 发行量 / 募资净额等键值对）
 * @param symbol 标的符号
 * @param forceRefresh 跳过缓存强制回源
 * @returns 键值对列表（保持上游顺序）
 */
export const fetchF10Publish = async (symbol: string, forceRefresh = false): Promise<F10KeyValue[]> =>
  parseF10KeyValues(await fetchF10Html('BasePublish', symbol, forceRefresh), '.about-publish li');

/**
 * 高管简介（姓名 / 任职时间 / 学历 / 职务 / 履历正文）
 * @param symbol 标的符号
 * @param forceRefresh 跳过缓存强制回源
 * @returns 高管条目列表（保持上游顺序）
 */
export const fetchF10Executives = async (symbol: string, forceRefresh = false): Promise<F10Executive[]> =>
  parseF10Executives(await fetchF10Html('BaseExecutive', symbol, forceRefresh));

/**
 * 参股控股（被参股企业名称 / 注册资本 / 集团持股比例）
 * @param symbol 标的符号
 * @param forceRefresh 跳过缓存强制回源
 * @returns 参股控股行列表（保持上游顺序）
 */
export const fetchF10HoldRows = async (symbol: string, forceRefresh = false): Promise<F10HoldRow[]> =>
  parseF10HoldRows(await fetchF10Html('BaseHold', symbol, forceRefresh));
