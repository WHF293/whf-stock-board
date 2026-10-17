import { defineStore } from 'pinia';

/** 应用级 UI store 状态 */
interface UiState {
  /** 页面全屏（PC 详情页铺满应用窗口；会话级，不持久化） */
  pageFullscreen: boolean;
}

/**
 * 应用级 UI 杂项状态（会话级，一律不持久化）
 *
 * 当前只承载「页面全屏」：个股详情页 K 线卡头部的全屏按钮置位后，
 * MainLayout 隐藏侧栏与页内页头、详情页隐藏底部页签并拉伸主区，
 * 让应用窗口只剩详情页本体（王总 2026-10-17）。
 * 路由切换时由 MainLayout 兜底复位，Esc 亦可退出。
 */
export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    pageFullscreen: false,
  }),

  actions: {
    /** 切换页面全屏（详情页 K 线卡头部的全屏按钮入口） */
    togglePageFullscreen(): void {
      this.pageFullscreen = !this.pageFullscreen;
    },

    /** 退出页面全屏（Esc / 路由切换兜底复位） */
    exitPageFullscreen(): void {
      this.pageFullscreen = false;
    },
  },
});
