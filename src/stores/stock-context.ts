import { defineStore } from 'pinia';

/** 详情页左侧股票列表的单项（会话级上下文，不持久化） */
export interface ContextStock {
  /** 完整符号（sh600519 形态，已含市场前缀，无需单独市场字段） */
  symbol: string;
  /** 股票名称 */
  name: string;
  /** 现价（元；来源列表无该字段时为 null） */
  price: number | null;
  /** 当日涨跌幅（%；来源列表无该字段时为 null） */
  changePercent: number | null;
}

/** 股票上下文 store 状态 */
interface StockContextState {
  /** 打开详情页前写入的来源股票列表（如：市场异动涨停表全部行） */
  stocks: ContextStock[];
}

/**
 * 股票上下文 store：为股票详情页左侧「来源列表」提供数据
 *
 * 全站双击/点击跳详情页的入口在跳转前把当前表格行写入本 store，
 * 详情页即可在列表内一键切换同批股票。会话级（刷新即清空，刻意不持久化）。
 */
export const useStockContextStore = defineStore('stock-context', {
  state: (): StockContextState => ({
    stocks: [],
  }),

  actions: {
    /**
     * 写入来源股票列表（拷贝入参，避免外部引用篡改）
     * @param stocks 股票列表（建议全量传入当前表格行）
     */
    setContext(stocks: ContextStock[]): void {
      this.stocks = stocks.map((stock) => ({ ...stock }));
    },
  },
});
