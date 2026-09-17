import { ref, watch } from 'vue';
import type { Ref } from 'vue';
import { CHART_PERIOD_DEFAULT, type ChartPeriod } from '../constants/stock-detail.constants';
import { useSettingsStore } from '../stores/settings';
import { isChartPeriod } from '../utils/is-chart-period';

/**
 * 图表周期选择（股票详情页 / 详情侧栏共用，跨会话记忆）
 *
 * 行为：
 * - 初始值取设置 store 的 `detailChartPeriod`（用户上次的选择），
 *   从未选过或持久化值非法（旧版本下线的周期）时回落 CHART_PERIOD_DEFAULT；
 * - 用户切换后写回 store，由 store 的 persist 落 localStorage，下次打开仍是该周期；
 * - 两个消费方可同时挂载（详情页 + 停靠面板），故做双向同步：
 *   任一处切换，另一处立刻跟随，避免同屏出现两个周期。
 *
 * 默认值只在这里收口：周期一旦非法就先回落，不允许把坏值喂给取数层
 * （`SINA_KLINE_CONFIG[period]` 取到 undefined 会直接抛错）。
 * @returns 当前图表周期（可读写，直接用于 `v-model` / 事件赋值）
 */
export const useChartPeriod = (): Ref<ChartPeriod> => {
  const settingsStore = useSettingsStore();
  const stored = settingsStore.detailChartPeriod;
  const period = ref<ChartPeriod>(isChartPeriod(stored) ? stored : CHART_PERIOD_DEFAULT);

  // 本地选择 → 持久化
  watch(period, (next) => {
    if (isChartPeriod(next)) {
      settingsStore.setDetailChartPeriod(next);
    }
  });

  // 另一处消费方的选择 → 本处跟随（同值时 store 不变，不会来回触发）
  watch(
    () => settingsStore.detailChartPeriod,
    (next) => {
      if (isChartPeriod(next) && next !== period.value) {
        period.value = next;
      }
    },
  );

  return period;
};
