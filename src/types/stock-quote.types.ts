/**
 * 行情相关类型统一出口：re-export stock-sdk 的报价模型
 *
 * 业务代码从本文件导入，避免直接依赖 SDK 内部路径；
 * 若 SDK 字段与展示需求有出入，在本目录补充映射类型
 */
export type { FullQuote, SimpleQuote, SearchResult } from 'stock-sdk';
