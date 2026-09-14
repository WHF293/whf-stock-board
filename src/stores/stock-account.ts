import { defineStore } from 'pinia';
import { STORAGE_NS_STOCK_ACCOUNT } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';
import {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ACCOUNT_NAME,
} from '../constants/account.constants';
import type { StockAccount } from '../types/account.types';

/** 股票账户 store 状态 */
interface StockAccountState {
  /** 账户列表（默认账户固定在首位） */
  accounts: StockAccount[];
}

/**
 * 股票账户 store（localStorage 持久化）
 *
 * UI 阶段仅维护账户档案；交割单解析入库字段定稿后，
 * 账户与成交记录一并迁移 SQLite（tauri-plugin-sql）
 */
export const useStockAccountStore = defineStore('stock-account', {
  state: (): StockAccountState => ({
    accounts: [
      { id: DEFAULT_ACCOUNT_ID, name: DEFAULT_ACCOUNT_NAME, createdAt: 0 },
    ],
  }),

  getters: {
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
     * 删除自定义账户（默认账户受保护不可删除）
     * @param accountId 账户 id
     */
    removeAccount(accountId: string): void {
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return;
      }
      this.accounts = this.accounts.filter(
        (account) => account.id !== accountId,
      );
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
