/**
 * 插件 UI 通道队列（确认弹窗 + 选股弹窗）
 *
 * 宿主级 store：插件经 `app:ui` 的 `confirm()` / `app:stock-picker` 发起，
 * `PluginConfirmHost.vue` / `PluginStockPickerHost.vue` 渲染。
 * 采用与 `app:notify` 一致的范式：**请求由插件发起、弹窗由宿主渲染**，因此插件组件
 * 在哪挂载（面板折叠、路由切走）都不影响它能拿到结果。
 *
 * Promise 的 resolve 由 store 持有而非组件持有：组件只是"当前正在问用户"的渲染层。
 *
 * 两条通道互不干扰（确认弹窗与选股弹窗可能同时存在），各自独立结算。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { SearchResult } from '../types/stock-quote.types';
import type { UiConfirmOptions } from '../types/plugin.types';

/** 一次等待中的确认请求 */
interface PendingConfirm {
  /** 弹窗入参 */
  options: UiConfirmOptions;
  /** 结果回传 */
  resolve: (confirmed: boolean) => void;
}

/** 一次等待中的选股请求 */
interface PendingPick {
  /** 结果回传（取消 / 关闭 = null） */
  resolve: (picked: SearchResult | null) => void;
}

export const usePluginUiStore = defineStore('pluginUi', () => {
  /** 当前等待用户答复的确认请求（null = 无待办） */
  const pending = ref<PendingConfirm | null>(null);
  /** 当前等待用户挑选的选股请求（null = 无待办） */
  const pendingPick = ref<PendingPick | null>(null);

  /**
   * 结算当前确认请求（无论用户点了确定还是取消）
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

  /**
   * 结算当前选股请求
   * @param picked 用户挑中的标的（取消 / 关闭为 null）
   */
  const settlePick = (picked: SearchResult | null): void => {
    const current = pendingPick.value;
    pendingPick.value = null;
    current?.resolve(picked);
  };

  /**
   * 发起一次选股（由 `app:stock-picker` 服务包装给插件消费）
   *
   * 弹窗就是全站统一的标的搜索（含「上次搜索」与键盘上下键），
   * 插件因此不必各写一个搜索框 —— 写出来的那一份一定更差且样式不统一。
   * @returns 用户挑中的标的；取消为 null
   */
  const requestStockPick = (): Promise<SearchResult | null> =>
    new Promise<SearchResult | null>((resolve) => {
      settlePick(null);
      pendingPick.value = { resolve };
    });

  return { pending, pendingPick, requestConfirm, requestStockPick, settle, settlePick };
});
