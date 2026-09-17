/**
 * 插件 dsh-sidebar-watch · 盯盘引擎
 *
 * 为什么不是「面板自己轮询 + 顺手判阈值」：面板是侧栏内的一个可折叠区块，
 * 折叠时宿主会把它整个卸载（`SidebarPanelHost` 的 `v-if="!collapsed"`），
 * 而**盯盘的全部意义就是「你没在看的时候替你盯着」** —— 告警不能随面板一起停摆。
 *
 * 因此本模块把「取报价 → 判阈值 → 弹提醒」整体提到插件层，用自己的调度器轮询
 * （`createPollingScheduler`，无组件依赖；复用全站同一份交易窗口 / 退避 / 可见性策略）：
 * - 面板只消费 `quotes` / `loading`，是纯展示；
 * - 折叠面板、收起侧栏、切到别的页面，盯盘照常工作；
 * - 全插件只有这一处报价请求，不会因为「面板也在轮」而把上游请求翻倍。
 *
 * 监控范围 = **候选池 ∩ 当前自选股**（与面板渲染同一集合，见 `candidates.ts`）：
 * 看到的即盯着的。把票从自选股移除只让该行与它的告警一起停下，
 * 候选记录与阈值仍保留在库里 —— 重新加回自选股即自动续上。
 */
import { effectScope, ref, shallowRef } from 'vue';
import { fetchFullQuotes } from '../../api/quotes.api';
import { createPollingScheduler } from '../../composables/polling-scheduler';
import { POLLING_INTERVAL } from '../../constants/polling.constants';
import { NOTIFY_SOURCE_WATCH_ALERT } from '../../constants/notify.constants';
import { useDockPanelStore } from '../../stores/dock-panel';
import { useWatchlistStore } from '../../stores/watchlist';
import { findQuoteBySymbol } from '../../utils/find-quote-by-symbol';
import { buildAlertNotice, evaluateAlert, isAlertConfigured } from './alerts';
import { filterCandidatesByWatchlist } from './candidates';
import type { WatchCandidate, WatchCandidateRepo } from './service';
import type { ShallowRef, Ref } from 'vue';
import type { FullQuote } from '../../types/stock-quote.types';
import type { NotifyService } from '../../types/notify.types';
import type { PluginLogger } from '../../types/plugin.types';

/** 盯盘引擎对外暴露的面（面板只读它，不自己取数） */
export interface WatchMonitor {
  /** 报价快照（key 为上游原始 `code`，查询走 `findQuoteBySymbol`） */
  readonly quotes: Readonly<ShallowRef<Record<string, FullQuote>>>;
  /** 是否首载中（仅第一次拉取为 true；后续刷新静默覆盖，避免整列表闪烁） */
  readonly loading: Readonly<Ref<boolean>>;
  /** 停止轮询并释放全部监听（插件卸载时调用） */
  stop: () => void;
}

/** 盯盘引擎依赖 */
interface WatchMonitorDeps {
  /** 候选仓储（读候选 + 回写阈值触发状态） */
  repo: WatchCandidateRepo;
  /** 应用级浮窗服务（插件经 ctx.consume('app:notify') 拿到；宿主未提供时降级为只记日志） */
  notify?: NotifyService;
  /** 插件日志器 */
  logger: PluginLogger;
}

/**
 * 创建盯盘引擎
 *
 * 调度器与它的监听全部跑在独立 `effectScope` 里：插件卸载时一次 `stop()` 收干净，
 * 不依赖任何组件生命周期。
 * @param deps 依赖（仓储 / 浮窗服务 / 日志器）
 * @returns 盯盘引擎
 */
export const createWatchMonitor = (deps: WatchMonitorDeps): WatchMonitor => {
  const { repo, notify, logger } = deps;
  const watchlistStore = useWatchlistStore();
  const dockPanel = useDockPanelStore();

  /** 报价快照（每次整份替换，行 key 不变 → 表格 DOM 原地复用） */
  const quotes = shallowRef<Record<string, FullQuote>>({});

  /** 首载标记：只在第一次拉取前置 true（与自选股页刷新不闪是同一处理） */
  const loading = ref(true);

  /**
   * 当前监控的候选（候选池 ∩ 自选股）
   * @returns 仍在自选股里的候选（保持候选池顺序）
   */
  const monitoredCandidates = (): readonly WatchCandidate[] =>
    filterCandidatesByWatchlist(repo.list(), watchlistStore.allSymbols);

  /**
   * 阈值判定 + 提醒
   *
   * 顺序上**先落库、后弹窗**：反过来的话，若在弹窗与落库之间进程被杀，
   * 重启后会拿着旧的 armed 状态再弹一次（用户看到重复提醒）。
   * @param quotesMap 本轮报价快照
   */
  const evaluateAlerts = (quotesMap: Record<string, FullQuote>): void => {
    for (const candidate of monitoredCandidates()) {
      const rule = candidate.alert;
      if (!isAlertConfigured(rule)) continue;

      const quote = findQuoteBySymbol(quotesMap, candidate.symbol);
      const snapshot = {
        price: quote?.price ?? null,
        changePercent: quote?.changePercent ?? null,
      };
      const { fire, rearm } = evaluateAlert(rule, snapshot);

      if (fire) {
        repo.markAlertFired(candidate.symbol);
        const notice = buildAlertNotice(rule, quote?.name || candidate.name, snapshot);
        notify?.notify({
          title: notice.title,
          body: notice.body,
          tone: notice.tone,
          source: NOTIFY_SOURCE_WATCH_ALERT,
          // 同一只票只占一格：反复触发时替换旧提醒而不是刷屏
          dedupeKey: `${NOTIFY_SOURCE_WATCH_ALERT}:${candidate.symbol}`,
          // 点提醒直接看这只票（全站打开个股详情的唯一入口就是停靠面板）
          onClick: (): void => dockPanel.openStock(candidate.symbol),
        });
        logger.info(`阈值提醒：${notice.title}`);
      } else if (rearm) {
        // 价格回到阈值内侧（越过回差）→ 重新武装，下次到达时再提醒
        repo.rearmAlert(candidate.symbol);
      }
    }
  };

  /**
   * 一轮取数：拉当前监控集合的报价，覆盖快照并判阈值
   */
  const fetchQuotes = async (): Promise<void> => {
    const symbols = monitoredCandidates().map((candidate) => candidate.symbol);
    if (symbols.length === 0) {
      quotes.value = {};
      loading.value = false;
      return;
    }
    try {
      const list = await fetchFullQuotes(symbols);
      const quotesMap = Object.fromEntries(list.map((quote) => [quote.code, quote]));
      quotes.value = quotesMap;
      evaluateAlerts(quotesMap);
    } finally {
      loading.value = false;
    }
  };

  // 独立作用域：调度器的窗口 / 可见性监听随它一起回收
  const scope = effectScope();
  scope.run(() => {
    createPollingScheduler({
      task: fetchQuotes,
      intervalMs: POLLING_INTERVAL.QUOTES_INTRADAY,
      tradingAware: true,
    });
  });

  return {
    quotes,
    loading,
    stop: (): void => {
      scope.stop();
      // 插件卸载时清掉自己弹过的提醒，不在界面上留下无主浮窗
      notify?.dismissBySource(NOTIFY_SOURCE_WATCH_ALERT);
    },
  };
};
