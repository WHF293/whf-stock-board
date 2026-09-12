import { defineStore } from 'pinia';
import {
  DOCK_PANEL_CONTENT,
  DOCK_PANEL_WIDTH_DEFAULT,
  DOCK_PANEL_WIDTH_MAX_RATIO,
  DOCK_PANEL_WIDTH_MIN,
  type DockPanelContentType,
} from '../constants/dock-panel.constants';
import { STORAGE_NS_DOCK_PANEL } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';
import { clampNumber } from '../utils/clamp-number';
import { normalizeAShareCode } from '../utils/normalize-a-share-code';

/** 右侧停靠面板 store 状态 */
interface DockPanelState {
  /** 面板是否展开（默认收起） */
  open: boolean;
  /** 当前渲染的内容类型 */
  content: DockPanelContentType | null;
  /** 内容参数（个股详情为完整符号 sh600519 形态） */
  symbol: string;
  /** 面板宽度（像素，localStorage 持久化） */
  width: number;
  /** 面板内右侧栏（五档 / 筹码）是否显示（默认不显示，localStorage 持久化） */
  showSidePanel: boolean;
}

/**
 * 右侧停靠面板 store：承载个股详情等可插拔内容
 *
 * 全站「跳个股详情」一律改为 openStock 展开右侧面板，不再路由跳转；
 * 宽度持久化，open / content 为会话级（刷新默认收起）
 */
export const useDockPanelStore = defineStore('dock-panel', {
  state: (): DockPanelState => ({
    open: false,
    content: null,
    symbol: '',
    width: DOCK_PANEL_WIDTH_DEFAULT,
    showSidePanel: false,
  }),

  actions: {
    /**
     * 打开个股详情面板（全站唯一入口；6 位纯代码自动归一化为完整符号）
     * @param symbol 个股符号（sh600519 / 600519 形态均可）
     */
    openStock(symbol: string): void {
      this.content = DOCK_PANEL_CONTENT.STOCK;
      this.symbol = normalizeAShareCode(symbol);
      this.open = true;
    },

    /** 收起面板 */
    close(): void {
      this.open = false;
    },

    /**
     * 拖拽更新面板宽度（夹取在下限与视口 60% 之间）
     * @param width 拖拽中的宽度（像素）
     */
    setWidth(width: number): void {
      const max = Math.floor(window.innerWidth * DOCK_PANEL_WIDTH_MAX_RATIO);
      this.width = clampNumber(width, DOCK_PANEL_WIDTH_MIN, max);
    },

    /** 切换面板内右侧栏显示（五档 / 筹码） */
    toggleSidePanel(): void {
      this.showSidePanel = !this.showSidePanel;
    },
  },

  persist: {
    key: STORAGE_NS_DOCK_PANEL,
    storage: appStorage,
    pick: ['width', 'showSidePanel'],
  },
});
