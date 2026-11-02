import { ref } from 'vue';
import type { Ref } from 'vue';
import type { KLineData } from 'klinecharts';
import { fetchSinaKline } from '../api/sina-kline.api.ts';
import type { SinaKlinePeriod } from '../api/sina-kline.api.ts';
import { POLLING_INTERVAL } from '../constants/polling.constants.ts';
import { usePolling } from './use-polling';
import { buildLiveKlineBar } from '../utils/build-live-kline-bar';

/**
 * K 线「最后一根柱」实时轮询（2026-11-02 王总指定：
 * 交易日盘中无论打开哪个周期，都轮询分时（1 分钟）接口，
 * 用它构建当前周期的实时柱，经图表 subscribeBar 通道原地更新——
 * 时间戳相同覆盖最后一根 / 更大追加，不整图重载、不重置视口与十字光标）
 *
 * 拉取策略（见 build-live-kline-bar 的口径实测记录）：
 * - minute / fiveDay / min5：只取分钟线尾段（6 根）；
 * - daily / weekly / monthly：分钟线取全天（300 根）+ 日 K 尾段（25 根，
 *   供周 / 月聚合期初至昨日；新浪盘中日 K 不含今日、周 / 月不含当前期）。
 *
 * 仅 A 股启用（港股走腾讯源，v1 不做实时柱）；周期 / 标的切换由 getter
 * 响应式跟随（面板实例跨标的复用，与侧栏报价轮询同模式）。
 */

/** 分钟线尾段根数：聚合日 / 周 / 月需覆盖当日全天（240 根 + 余量） */
const LIVE_MINUTE_BAR_LIMIT = 300;

/** 日 K 尾段根数：覆盖当前月（≤23 个交易日 + 余量），供周 / 月聚合 */
const LIVE_DAILY_BAR_LIMIT = 25;

/**
 * 盘中实时最后一根柱轮询
 * @param options symbol 响应式引用 / 市场与周期 getter（面板实例复用时随状态切换）
 * @param options.symbol
 * @param options.market
 * @param options.period
 * @returns 实时柱（无法构建时为 null，推送通道按旧数据忽略）
 */
export const useKlineLive = (options: {
  symbol: Ref<string>;
  market: () => 'cn' | 'hk';
  period: () => SinaKlinePeriod;
}): Ref<KLineData | null> => {
  const liveBar = ref<KLineData | null>(null);

  usePolling({
    task: async () => {
      if (options.market() !== 'cn') return;
      const period = options.period();
      const needAgg = period === 'daily' || period === 'weekly' || period === 'monthly';
      const [minutes, dailies] = await Promise.all([
        fetchSinaKline(options.symbol.value, 'minute', {
          barLimit: needAgg ? LIVE_MINUTE_BAR_LIMIT : 6,
        }),
        needAgg
          ? fetchSinaKline(options.symbol.value, 'daily', { barLimit: LIVE_DAILY_BAR_LIMIT })
          : Promise.resolve<KLineData[]>([]),
      ]);
      liveBar.value = buildLiveKlineBar(period, minutes, dailies);
    },
    intervalMs: POLLING_INTERVAL.DETAIL_MINUTE,
    tradingAware: true,
    market: () => (options.market() === 'hk' ? 'HK' : 'A'),
  });

  return liveBar;
};
