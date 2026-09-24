import { WATCH_WIDGET_POWER } from '../constants/watch-widget.constants';
import type { WatchWidgetSettings } from '../types/watch-widget.types';

/**
 * 迁移任务栏小组件旧版设置（一次性，settings store 水合后调用）
 *
 * 旧版持久化结构是布尔开关 `enabled`，改造为三态 `power`（off / always / smart）后，
 * pinia persist 水合走 `$patch`（**深合并**）：老用户的 `{ enabled: true }` 与默认值
 * `{ power: 'off' }` 合并后 power 是默认 'off' 而非 undefined，开着小组件的用户会被
 * 静默关闭。本函数在水合结果上就地修补：
 *
 * - 遗留 `enabled === true` → `power = 'always'`（「常驻」即原「开启」，语义无损）；
 * - 遗留 `enabled === false / 缺失` → 保持当前 `power` 不动；
 * - 最后删掉遗留 `enabled` 键，避免脏字段长期留在持久化包里。
 *
 * 注意：persist 插件的 `$subscribe` 在 `afterHydrate` 之后才注册，本函数的就地修改
 * **不会立刻回写 storage**，而是在用户下一次改动任意设置时随整体状态落盘；
 * 迁移幂等（enabled 缺失即 no-op），期间重启应用行为一致，无需强制 flush。
 *
 * 旧字段只是过渡期兼容，迁移后 `WatchWidgetSettings` 本身不含 `enabled`，
 * 因此入参类型取「新结构 + 可选遗留字段」的交集。
 * @param watchWidget 水合后的 watchWidget 设置（settings store state，就地修改）
 */
export const migrateWatchWidgetSettings = (
  watchWidget: Partial<WatchWidgetSettings> & { enabled?: boolean } | undefined,
): void => {
  if (!watchWidget) return;
  if (watchWidget.enabled === true) {
    watchWidget.power = WATCH_WIDGET_POWER.ALWAYS;
  }
  delete (watchWidget as Partial<WatchWidgetSettings> & { enabled?: boolean }).enabled;
};
