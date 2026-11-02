import { defineStore } from 'pinia';
import type { KLineData } from 'klinecharts';
import { fetchKlineCached } from '../api/kline-cache.api';
import { fetchTencentRawDailyCloses } from '../api/tencent-kline.api';
import { delay } from '../utils/delay';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { toFullSymbol } from '../utils/to-full-symbol';
import {
  computeTradeContribution,
  toQfqCloseSeries,
  type ContributionResult,
  type QfqCloseSeries,
} from '../utils/compute-trade-contribution';
import { computeBehavior, type BehaviorResult } from '../utils/compute-behavior';
import type { TzzbClearedPosition, TzzbStockTrade } from '../types/tzzb.types.ts';

/**
 * 操作复盘分析 store（方案 §2.2 交互决策 1/2）
 *
 * - **点击触发，不自动算**：生成需按票批量拉 qfq 日 K（频率红线约束），
 *   并发 ≤3 + 请求前 ≥500ms 错峰（沿用 board-flow-history 既定模式）；
 * - **结果缓存**：cacheKey = accountId|range|dataDate|流水条数，同 key 命中直接复用，
 *   不重拉不重算；派生数据不落 SQLite（可随时重算）；
 * - **单票失败降级**：K 线拉取失败的票记入 missingSymbols，计算时跳过，不阻塞整卡；
 * - 不复权日收盘表（折算系数分母）历史不可变，会话级 memo 跨次生成复用。
 */

/** 请求错峰间隔（ms；3 并发下整体 ≈2.5 请求/秒） */
const REQUEST_GAP_MS = 500;

/** 并发上限 */
const REQUEST_CONCURRENCY = 3;

/** 生成入参 */
export interface TzzbAnalysisGenerateInput {
  /** 账户 id（缓存 key 一部分；'' = 全部账户） */
  accountId: string;
  /** 区间（TZZB_RANGE_OPTIONS value；缓存 key 一部分） */
  range: string;
  /** 数据截止日 yyyy-MM-dd（缓存 key 一部分） */
  dataDate: string;
  /** 全量股票流水（窗口过滤在本 action 内做） */
  trades: TzzbStockTrade[];
  /** 清仓记录（窗口过滤在本 action 内做） */
  cleared: TzzbClearedPosition[];
  /** 窗口起 yyyy-MM-dd；null = 不设下界（「全部」） */
  windowFrom: string | null;
  /** 窗口止 yyyy-MM-dd；null = 不设上界 */
  windowTo: string | null;
}

/** 不复权日收盘表会话级缓存（key = 完整符号；历史不可变可跨次复用） */
const rawClosesMemo = new Map<string, Map<string, number>>();

export const useTzzbAnalysisStore = defineStore('tzzb-analysis', {
  state: () => ({
    /** idle = 未生成；running = 拉取中；done = 有结果；error = 整体失败 */
    status: 'idle' as 'idle' | 'running' | 'done' | 'error',
    /** 已完成票数 */
    progressDone: 0,
    /** 总票数 */
    progressTotal: 0,
    /** 结果对应的缓存 key（空 = 无结果） */
    cacheKey: '',
    /** 贡献度结果（done 时非空） */
    contribution: null as ContributionResult | null,
    /** 行为诊断结果（done 时非空） */
    behavior: null as BehaviorResult | null,
    /** K 线拉取失败的票（tzzb 六位码） */
    missingSymbols: [] as string[],
    /** 整体失败原因（error 时有值） */
    errorMessage: '',
  }),

  actions: {
    /**
     * 生成分析（同 key 已有结果时直接复用，不重拉）
     * @param input 生成入参
     */
    async generate(input: TzzbAnalysisGenerateInput): Promise<void> {
      const key = `${input.accountId}|${input.range}|${input.dataDate}|${input.trades.length}`;
      if (this.status === 'running') return;
      if (this.status === 'done' && this.cacheKey === key) return;

      // 窗口过滤（流水 yyyy-MM-dd 与窗口同格式直比；clear 收「窗口内清仓 + 持有中」）
      const inWindow = (d: string): boolean =>
        (input.windowFrom === null || d >= input.windowFrom) &&
        (input.windowTo === null || d <= input.windowTo);
      const winTrades = input.trades.filter((t) => inWindow(t.date));
      const winCleared = input.cleared.filter(
        (r) => r.closeDate === null || (r.closeDate !== null && inWindow(r.closeDate)),
      );

      // 涉及票：流水 ∪ 清仓（均为股票）
      const codes = new Set<string>();
      for (const t of winTrades) codes.add(t.code);
      for (const c of winCleared) codes.add(c.code);

      this.status = 'running';
      this.progressDone = 0;
      this.progressTotal = codes.size;
      this.missingSymbols = [];
      this.errorMessage = '';

      const klines = new Map<string, KLineData[]>();
      const qfqSeries = new Map<string, QfqCloseSeries>();
      const rawCloses = new Map<string, Map<string, number>>();

      try {
        await mapWithConcurrency(
          [...codes],
          async (code) => {
            await delay(REQUEST_GAP_MS);
            const symbol = toFullSymbol(code);
            try {
              const bars = await fetchKlineCached(symbol, 'daily', { write: true });
              klines.set(code, bars);
              qfqSeries.set(code, toQfqCloseSeries(bars));
              let raws = rawClosesMemo.get(symbol);
              if (!raws) {
                raws = await fetchTencentRawDailyCloses(symbol).catch(() => new Map<string, number>());
                rawClosesMemo.set(symbol, raws);
              }
              if (raws.size > 0) rawCloses.set(code, raws);
            } catch {
              this.missingSymbols.push(code);
            } finally {
              this.progressDone += 1;
            }
          },
          { concurrency: REQUEST_CONCURRENCY },
        );

        this.contribution = computeTradeContribution(winTrades, winCleared, qfqSeries);
        this.behavior = computeBehavior({
          trades: winTrades,
          cleared: winCleared,
          klines,
          rawCloses,
        });
        this.cacheKey = key;
        this.status = 'done';
      } catch (e) {
        this.errorMessage = e instanceof Error ? e.message : String(e);
        this.status = 'error';
      }
    },

    /** 清空结果（下次点击重新生成；账户切换等场景预留） */
    reset(): void {
      this.status = 'idle';
      this.cacheKey = '';
      this.contribution = null;
      this.behavior = null;
      this.missingSymbols = [];
      this.errorMessage = '';
      this.progressDone = 0;
      this.progressTotal = 0;
    },
  },
});
