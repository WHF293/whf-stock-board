/**
 * 个股财务数据装配（详情整页「财务」Tab 数据源）
 *
 * 四张东财 datacenter 报表（财务摘要 / 资产负债 / 现金流 / 业绩预告）并发拉取，
 * 任一表失败不影响其它表（Promise.allSettled），失败表支持按表粒度重试；
 * 快照经 dataCache 会话内复用（TTL 见 FINANCIAL_CACHE_TTL_MS，过期后台回源、旧值先渲染）。
 * 财务数据日级更新：页签切入触发一次，不轮询。
 */
import { ref, watch, type Ref } from 'vue';
import {
  fetchBalanceSheetDigest,
  fetchCashFlowDigest,
  fetchFinancialSummary,
  fetchProfitForecast,
} from '../api/financial.api.ts';
import type {
  BalanceSheetRow,
  CashFlowRow,
  FinancialSummaryRow,
  ProfitForecastRow,
} from '../types/financial.types.ts';
import {
  FINANCIAL_CACHE_TTL_MS,
  FINANCIAL_FORECAST_COUNT,
  FINANCIAL_UI_PERIODS,
} from '../constants/financial.constants.ts';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants.ts';
import { useDataCacheStore } from '../stores/data-cache';

/** 财务报表键（四张报表的区块标识） */
export type FinancialTableKey = 'summary' | 'balance' | 'cashflow' | 'forecast';

/** 单张报表的区块状态（数据 / 加载 / 错误三态独立，互不拖垮） */
export interface FinancialBlock<T> {
  /** 报表行（报告期倒序；空数组 = 上游合法无数据） */
  data: T[];
  /** 是否加载中 */
  loading: boolean;
  /** 错误文案（null = 无错误） */
  error: string | null;
}

/** 四表合并快照（dataCache 序列化存储，fetchedAt 驱动 TTL） */
interface FinancialSnapshot {
  summary: FinancialSummaryRow[];
  balance: BalanceSheetRow[];
  cashflow: CashFlowRow[];
  forecast: ProfitForecastRow[];
  /** 快照写入时间戳（毫秒） */
  fetchedAt: number;
}

/**
 * 空区块初值
 * @returns 空的区块状态（loading = true）
 */
const emptyBlock = <T>(): FinancialBlock<T> => ({ data: [], loading: true, error: null });

/**
 * 从 rejected 结果提取可读错误文案
 * @param reason Promise rejection 原因
 * @returns 错误文案
 */
const errorText = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

/**
 * 个股财务数据装配
 *
 * @param symbol 股票符号（响应式，切换股票自动重拉）
 * @returns 四表区块状态 + 重载动作（load 全量 / reloadTable 单表）
 */
export const useStockFinancial = (symbol: Ref<string>) => {
  const dataCache = useDataCacheStore();

  const summary = ref<FinancialBlock<FinancialSummaryRow>>(emptyBlock());
  const balance = ref<FinancialBlock<BalanceSheetRow>>(emptyBlock());
  const cashflow = ref<FinancialBlock<CashFlowRow>>(emptyBlock());
  const forecast = ref<FinancialBlock<ProfitForecastRow>>(emptyBlock());

  /** 当前正在服务的符号（防止慢响应串味：切换股票后旧响应不得写入新区块） */
  let servingSymbol = '';

  /**
   * 快照键（前缀 + 归一化符号）
   * @param fullSymbol 完整符号（sh600519）
   * @returns dataCache 键
   */
  const snapshotKey = (fullSymbol: string): string =>
    DATA_CACHE_KEY.DETAIL_FINANCIAL_PREFIX + fullSymbol;

  /**
   * 把四表当前值写入快照（部分失败也写：成功表进快照，失败表保留旧值下次重试覆盖）
   * @returns 无返回值
   */
  const writeSnapshot = (): void => {
    const snapshot: FinancialSnapshot = {
      summary: summary.value.data,
      balance: balance.value.data,
      cashflow: cashflow.value.data,
      forecast: forecast.value.data,
      fetchedAt: Date.now(),
    };
    dataCache.set(snapshotKey(symbol.value), snapshot);
  };

  /**
   * 快照播种：TTL 内直接采用；过期快照先渲染旧值再回源刷新
   * @returns true = 快照在 TTL 内（无需回源）
   */
  const seedFromSnapshot = (): boolean => {
    const snap = dataCache.get<FinancialSnapshot>(snapshotKey(symbol.value));
    if (!snap) return false;
    summary.value = { ...emptyBlock(), data: snap.summary, loading: false };
    balance.value = { ...emptyBlock(), data: snap.balance, loading: false };
    cashflow.value = { ...emptyBlock(), data: snap.cashflow, loading: false };
    forecast.value = { ...emptyBlock(), data: snap.forecast, loading: false };
    return Date.now() - snap.fetchedAt < FINANCIAL_CACHE_TTL_MS;
  };

  /**
   * 拉取单张报表并写入对应区块（成功写数据、失败写错误）
   * @param table 报表键
   * @returns 无返回值
   */
  const loadTable = async (table: FinancialTableKey): Promise<void> => {
    const code = servingSymbol;
    const blockByTable = { summary, balance, cashflow, forecast } as const;
    const block = blockByTable[table];
    block.value = { ...block.value, loading: true, error: null };
    try {
      let rows: unknown[];
      switch (table) {
        case 'summary':
          rows = await fetchFinancialSummary(code, FINANCIAL_UI_PERIODS);
          break;
        case 'balance':
          rows = await fetchBalanceSheetDigest(code, FINANCIAL_UI_PERIODS);
          break;
        case 'cashflow':
          rows = await fetchCashFlowDigest(code, FINANCIAL_UI_PERIODS);
          break;
        case 'forecast':
          rows = await fetchProfitForecast(code, FINANCIAL_FORECAST_COUNT);
          break;
      }
      if (code !== servingSymbol) return; // 期间已切股，丢弃
      block.value = { data: rows as never[], loading: false, error: null };
    } catch (error) {
      if (code !== servingSymbol) return;
      block.value = { ...block.value, loading: false, error: errorText(error) };
    }
  };

  /**
   * 全量装配：快照优先（TTL 内只读快照），过期 / 缺失时四表并发回源
   */
  const load = async (): Promise<void> => {
    servingSymbol = symbol.value;
    if (seedFromSnapshot()) return;
    // 过期快照已播种（旧值先渲染），四表并发回源
    await Promise.allSettled([
      loadTable('summary'),
      loadTable('balance'),
      loadTable('cashflow'),
      loadTable('forecast'),
    ]);
    if (servingSymbol === symbol.value) writeSnapshot();
  };

  /**
   * 按表粒度重试（区块级错误态的重试按钮）：只重拉指定表并刷新快照
   * @param table 报表键
   */
  const reloadTable = async (table: FinancialTableKey): Promise<void> => {
    await loadTable(table);
    if (servingSymbol === symbol.value) writeSnapshot();
  };

  // 切股全量重拉（快照优先，秒出）
  watch(
    symbol,
    () => {
      void load();
    },
    { immediate: true },
  );

  return { summary, balance, cashflow, forecast, load, reloadTable };
};
