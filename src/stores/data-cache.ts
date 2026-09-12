import { defineStore } from 'pinia';

/**
 * 接口数据内存快照缓存（不持久化，会话内有效）
 *
 * 用法：页面请求成功后 set 最新数据；重新挂载/切换回来时先 get 播种
 * 页面状态（秒出正确 UI），接口返回后再覆盖刷新。
 * 与 localStorage 持久化（自选/设置）无关，刷新浏览器即清空。
 */
export const useDataCacheStore = defineStore('data-cache', {
  state: () => ({
    /** 快照表（key -> 任意可序列化数据） */
    map: {} as Record<string, unknown>,
  }),

  actions: {
    /**
     * 读取快照
     * @param key 缓存键
     * @returns 快照数据；不存在时为 null
     */
    get<T>(key: string): T | null {
      return (this.map[key] ?? null) as T | null;
    },

    /**
     * 写入快照（请求成功后调用）
     * @param key 缓存键
     * @param data 最新数据
     */
    set<T>(key: string, data: T): void {
      this.map[key] = data;
    },

    /**
     * 按前缀清理（如切换符号后清掉旧详情快照；预留手动清理能力）
     * @param prefix 键前缀
     */
    clearByPrefix(prefix: string): void {
      for (const key of Object.keys(this.map)) {
        if (key.startsWith(prefix)) {
          delete this.map[key];
        }
      }
    },

    /** 清空全部快照 */
    clearAll(): void {
      this.map = {};
    },
  },
});
