import { defineStore } from 'pinia';
import {
  MUTUAL_SIDEBAR_WIDTH_DEFAULT,
  MUTUAL_SIDEBAR_WIDTH_MAX_RATIO,
  MUTUAL_SIDEBAR_WIDTH_MIN,
} from '../constants/mutual-sidebar.constants.ts';
import { STORAGE_NS_MUTUAL_SIDEBAR } from '../constants/storage-key.constants.ts';
import { appStorage } from '../utils/app-local-storage';
import { clampNumber } from '../utils/clamp-number';

/** 南北向资金侧边栏 store 状态 */
interface MutualSidebarState {
  /** 侧边栏是否展开（默认收起；持久化，重进资金流向页保持上次的开关态） */
  open: boolean;
  /** 侧边栏宽度（像素，localStorage 持久化） */
  width: number;
}

/**
 * 南北向资金侧边栏 store：资金流向页的南北向模块容器
 *
 * 开关由页头「南北向资金」按钮触发；宽度经 DockResizer 拖拽调整（store 内
 * clamp 到 380px ~ 视口 60% 并持久化），与 dock-panel 同款持久化口径
 */
export const useMutualSidebarStore = defineStore('mutual-sidebar', {
  state: (): MutualSidebarState => ({
    open: false,
    width: MUTUAL_SIDEBAR_WIDTH_DEFAULT,
  }),

  actions: {
    /** 展开侧边栏 */
    openSidebar(): void {
      this.open = true;
    },

    /** 收起侧边栏 */
    closeSidebar(): void {
      this.open = false;
    },

    /** 切换侧边栏展开态 */
    toggle(): void {
      this.open = !this.open;
    },

    /**
     * 拖拽更新侧边栏宽度（夹取在下限与视口 60% 之间）
     * @param width 拖拽中的宽度（像素）
     */
    setWidth(width: number): void {
      const max = Math.floor(window.innerWidth * MUTUAL_SIDEBAR_WIDTH_MAX_RATIO);
      this.width = clampNumber(width, MUTUAL_SIDEBAR_WIDTH_MIN, max);
    },
  },

  persist: {
    key: STORAGE_NS_MUTUAL_SIDEBAR,
    storage: appStorage,
    pick: ['open', 'width'],
  },
});
