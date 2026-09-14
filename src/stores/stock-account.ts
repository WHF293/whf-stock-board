import { defineStore } from 'pinia';
import { STORAGE_NS_STOCK_ACCOUNT } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';
import type { StockAccount } from '../types/account.types';

/** 股票账户 store 状态 */
interface StockAccountState {
  /** 账户列表（不预置默认账户：用户不创建就没有账户） */
  accounts: StockAccount[];
  /** 账户 tab 显示顺序（存账户 id；等于空数组时按创建序） */
  accountOrder: string[];
  /** 未勾选（不在 tab 条显示）的账户 id */
  accountHidden: string[];
}

/**
 * 股票账户 store（localStorage 持久化）
 *
 * 账户档案纯前端维护；对账单导入记录落 SQLite（api/account-statement-db.api.ts）；
 * 交割单解析入库字段定稿后，成交记录一并迁移 SQLite（tauri-plugin-sql）
 */
export const useStockAccountStore = defineStore('stock-account', {
  state: (): StockAccountState => ({
    accounts: [],
    accountOrder: [],
    accountHidden: [],
  }),

  getters: {
    /**
     * tab 条展示的账户：按用户排序，过滤未勾选项；
     * 新建账户未入排序时追加末尾（默认可见）
     * @param state store 状态
     * @returns 排序后的可见账户
     */
    visibleAccounts(state: StockAccountState): StockAccount[] {
      const byId = new Map(state.accounts.map((account) => [account.id, account]));
      const hidden = new Set(state.accountHidden);
      const ordered: StockAccount[] = [];
      for (const id of state.accountOrder) {
        const account = byId.get(id);
        if (account && !hidden.has(id)) {
          ordered.push(account);
          byId.delete(id);
        }
      }
      for (const account of state.accounts) {
        if (byId.has(account.id) && !hidden.has(account.id)) {
          ordered.push(account);
        }
      }
      return ordered;
    },

    /**
     * 账户名是否已存在（创建时去重，忽略大小写与首尾空格）
     * @param state store 状态
     * @returns 重名判断函数
     */
    nameExists:
      (state: StockAccountState) =>
      (name: string, excludeId?: string): boolean => {
        const normalized = name.trim().toLowerCase();
        return state.accounts.some(
          (account) =>
            account.id !== excludeId &&
            account.name.trim().toLowerCase() === normalized,
        );
      },
  },

  actions: {
    /**
     * 新建手工账户
     * @param name 账户名称（调用前需通过 nameExists 校验）
     * @param note 备注（可选）
     * @returns 新建的账户对象
     */
    addAccount(name: string, note?: string): StockAccount {
      const account: StockAccount = {
        id: crypto.randomUUID(),
        name: name.trim(),
        note: note?.trim() || undefined,
        createdAt: Date.now(),
      };
      this.accounts.push(account);
      this.$persist();
      return account;
    },

    /**
     * 保存账户 tab 显隐与排序（管理弹窗确认时调用）
     * @param order 账户 id 顺序（完整排列）
     * @param hidden 未勾选（不显示）的账户 id
     */
    setAccountConfig(order: string[], hidden: string[]): void {
      this.accountOrder = [...order];
      this.accountHidden = [...hidden];
      this.$persist();
    },

    /**
     * 删除账户（同步清理排序/显隐配置）
     * @param accountId 账户 id
     */
    removeAccount(accountId: string): void {
      this.accounts = this.accounts.filter(
        (account) => account.id !== accountId,
      );
      this.accountOrder = this.accountOrder.filter((id) => id !== accountId);
      this.accountHidden = this.accountHidden.filter((id) => id !== accountId);
      this.$persist();
    },

    /**
     * 修改账户名称与备注
     * @param accountId 账户 id
     * @param name 新名称
     * @param note 新备注（可选）
     */
    updateAccount(accountId: string, name: string, note?: string): void {
      const target = this.accounts.find(
        (account) => account.id === accountId,
      );
      if (!target) {
        return;
      }
      target.name = name.trim();
      target.note = note?.trim() || undefined;
      this.$persist();
    },
  },

  persist: {
    key: STORAGE_NS_STOCK_ACCOUNT,
    storage: appStorage,
    debug: import.meta.env.DEV,
  },
});
