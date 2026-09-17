/**
 * 应用通知（右侧浮窗）队列
 *
 * 宿主级 store：插件经 `app:notify` 服务写入，`NotificationHost.vue` 渲染。
 * 自动消失的定时器由 store 持有（不是组件持有）—— 这样浮窗组件上下线
 * 不会导致「本该消失的提醒永远留着」。
 */
import { defineStore } from 'pinia';
import {
  NOTIFY_DEFAULT_TIMEOUT_MS,
  NOTIFY_MAX_ITEMS,
  NOTIFY_TONE,
} from '../constants/notify.constants';
import type { AppNotification, NotifyOptions } from '../types/notify.types';

/** 自增序号（与时间戳拼成 id，避免同一毫秒内连弹两条撞 id） */
let seq = 0;

/** id → 自动消失定时器句柄（在 store 之外持有，避免定时器句柄进响应式状态） */
const timers = new Map<string, number>();

/**
 * 清掉一条浮窗的定时器
 * @param id 浮窗 id
 */
const clearTimer = (id: string): void => {
  const handle = timers.get(id);
  if (handle === undefined) return;
  window.clearTimeout(handle);
  timers.delete(id);
};

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    /** 待展示浮窗（插入顺序，新条目在末尾） */
    items: [] as AppNotification[],
  }),

  actions: {
    /**
     * 弹出一条浮窗
     * @param options 浮窗参数
     * @returns 浮窗 id
     */
    push(options: NotifyOptions): string {
      seq += 1;
      const id = `n${Date.now().toString(36)}${seq.toString(36)}`;
      const item: AppNotification = {
        id,
        at: Date.now(),
        title: options.title,
        body: options.body ?? '',
        tone: options.tone ?? NOTIFY_TONE.FLAT,
        timeoutMs: options.timeoutMs ?? NOTIFY_DEFAULT_TIMEOUT_MS,
        source: options.source ?? '',
        // 未显式给去重键时按 id 兜底：等价于「不去重」（id 必然唯一）
        dedupeKey: options.dedupeKey ?? id,
        onClick: options.onClick,
      };

      // 同 dedupeKey：替换旧条目（并清掉旧定时器），保证「同一只票只占一格」
      const duplicated = this.items.filter((entry) => entry.dedupeKey === item.dedupeKey);
      for (const entry of duplicated) {
        clearTimer(entry.id);
      }
      const kept = this.items.filter((entry) => entry.dedupeKey !== item.dedupeKey);

      // 超出上限时挤掉最旧的（同时清掉它的定时器）
      const overflow = kept.length + 1 - NOTIFY_MAX_ITEMS;
      const dropped = overflow > 0 ? kept.slice(0, overflow) : [];
      for (const entry of dropped) {
        clearTimer(entry.id);
      }
      this.items = [...kept.slice(dropped.length), item];

      if (item.timeoutMs > 0) {
        timers.set(
          id,
          window.setTimeout(() => this.dismiss(id), item.timeoutMs),
        );
      }
      return id;
    },

    /**
     * 关闭一条浮窗
     * @param id 浮窗 id
     */
    dismiss(id: string): void {
      clearTimer(id);
      this.items = this.items.filter((entry) => entry.id !== id);
    },

    /**
     * 关闭某个来源的全部浮窗
     * @param source 来源标签（`source` 字段值）
     */
    dismissBySource(source: string): void {
      for (const entry of this.items) {
        if (entry.source === source) clearTimer(entry.id);
      }
      this.items = this.items.filter((entry) => entry.source !== source);
    },

    /**
     * 点击浮窗：先执行回调（回调可能打开面板），再关闭
     * @param id 浮窗 id
     */
    activate(id: string): void {
      const item = this.items.find((entry) => entry.id === id);
      this.dismiss(id);
      item?.onClick?.();
    },
  },
});
