import { appStorage } from '../utils/app-local-storage';
import { STORAGE_NS_MOBILE_CACHE } from '../constants/storage-key.constants';
import { MOBILE_CACHE_TTL_MS } from './constants';

/**
 * 移动端持久化缓存（30 分钟 TTL）
 *
 * 榜单与新闻快照的统一缓存层：写入即落 localStorage（mobile.cache 命名空间），
 * 冷启动 30 分钟内的快照直接复用；读取分「新鲜」与「过期仍可用」两档——
 * 新鲜快照免请求直出，过期快照可先渲染再静默刷新（满足「缓存持久化记住」的需求口径）。
 */

interface MobileCacheEntry<V> {
  /** 快照生成时刻（毫秒） */
  at: number;
  value: V;
}

type MobileCacheBundle = Record<string, MobileCacheEntry<unknown>>;

/** 缓存命中结果（at 供「快照生成于 HH:mm」展示） */
export interface MobileCacheHit<V> {
  at: number;
  value: V;
}

const readBundle = (): MobileCacheBundle => {
  const raw = appStorage.getItem(STORAGE_NS_MOBILE_CACHE);
  if (raw === null) return {};
  try {
    return JSON.parse(raw) as MobileCacheBundle;
  } catch {
    return {};
  }
};

const writeBundle = (bundle: MobileCacheBundle): void => {
  appStorage.setItem(STORAGE_NS_MOBILE_CACHE, JSON.stringify(bundle));
};

/**
 * 读取未过期缓存（TTL 内命中才返回）
 * @param key 缓存键（`news:<source>:<channel>` / `board:<source>:<group>`）
 * @param ttl 有效期（毫秒），默认 30 分钟
 * @returns 命中返回快照（含生成时刻），未命中或已过期返回 null
 */
export const mobileCacheGet = <V>(key: string, ttl: number = MOBILE_CACHE_TTL_MS): MobileCacheHit<V> | null => {
  const entry = readBundle()[key] as MobileCacheEntry<V> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.at > ttl) return null;
  return { at: entry.at, value: entry.value };
};

/**
 * 读取过期仍可用的快照（用于「内容可能已过期」兜底展示；不判断 TTL）
 * @param key 缓存键
 * @returns 存在即返回快照（含生成时刻），否则 null
 */
export const mobileCacheGetStale = <V>(key: string): MobileCacheHit<V> | null => {
  const entry = readBundle()[key] as MobileCacheEntry<V> | undefined;
  return entry ? { at: entry.at, value: entry.value } : null;
};

/**
 * 写入快照（生成时刻取当前时间；写穿持久层）
 * @param key 缓存键
 * @param value 快照值（需可 JSON 序列化）
 */
export const mobileCacheSet = <V>(key: string, value: V): void => {
  const bundle = readBundle();
  bundle[key] = { at: Date.now(), value };
  writeBundle(bundle);
};

/**
 * 移除单个缓存键（下拉刷新的「清当前源缓存」用）
 * @param key 缓存键
 */
export const mobileCacheRemove = (key: string): void => {
  const bundle = readBundle();
  delete bundle[key];
  writeBundle(bundle);
};

/** 清空移动端全部快照缓存（设置页「清理数据缓存」用） */
export const mobileCacheClear = (): void => {
  appStorage.removeItem(STORAGE_NS_MOBILE_CACHE);
};

/**
 * 估算缓存体量（字节），设置页「清理数据缓存」展示用
 * @returns mobile.cache 序列化后的字符长度
 */
export const mobileCacheSize = (): number =>
  (appStorage.getItem(STORAGE_NS_MOBILE_CACHE) ?? '').length;
