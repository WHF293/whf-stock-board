/**
 * 插件 UI 通道队列（确认弹窗）
 *
 * 宿主级 store：插件经 `app:ui` 的 `confirm()` 发起，`PluginConfirmHost.vue` 渲染。
 * 采用与 `app:notify` 一致的范式：**请求由插件发起、弹窗由宿主渲染**，因此插件组件
 * 在哪挂载（面板折叠、路由切走）都不影响它能拿到结果。
 *
 * Promise 的 resolve 由 store 持有而非组件持有：组件只是"当前正在问用户"的渲染层。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { UiConfirmOptions } from '../types/plugin.types';

/** 一次等待中的确认请求 */
interface PendingConfirm {
  /** 弹窗入参 */
  options: UiConfirmOptions;
  /** 结果回传 */
  resolve: (confirmed: boolean) => void;
}

export const usePluginUiStore = defineStore('pluginUi', () => {
  /** 当前等待用户答复的请求（null = 无待办） */
  const pending = ref<PendingConfirm | null>(null);

  /**
   * 结算当前请求（无论用户点了确定还是取消）
   *
   * 新请求到来时会先结算旧请求为 false：同时并发的确认在 UI 上无法分辨，
   * 与其让前一个 Promise 永远悬着，不如让调用方拿到明确的结果。
   * @param result 用户对这条请求的答复
   */
  const settle = (result: boolean): void => {
    const current = pending.value;
    pending.value = null;
    current?.resolve(result);
  };

  /**
   * 发起一次确认（由 `app:ui` 服务包装给插件消费）
   * @param options 弹窗入参
   * @returns 用户是否点了确认
   */
  const requestConfirm = (options: UiConfirmOptions = {}): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      settle(false);
      pending.value = { options, resolve };
    });

  return { pending, requestConfirm, settle };
});
