import { isTauri } from '@tauri-apps/api/core';
import { watch } from 'vue';
import { loadWatchlistGroups, saveWatchlistGroups } from '../api/watchlist-db.api.ts';
import { useWatchlistStore } from '../stores/watchlist';
import type { WatchlistGroup } from '../types/watchlist.types.ts';

/**
 * 自选股 SQLite 镜像同步（Tauri 端；浏览器端 no-op）
 *
 * 自选股运行期单一事实源仍是 watchlist store（localStorage 即时持久化），
 * SQLite 两表（watchlist_group / watchlist_stock）是它的**全量镜像**，职责有二：
 * 1. **数据迁移的生效通道**：导入会把这两表整表覆盖，reload 后本模块启动时
 *    「库里有数据 → 以库覆盖 store」，导入的自选股因此真正落到界面；
 * 2. **跨机备份事实源**：数据导出读的就是这两表，运行期任何变更都整包重写，
 *    保证导出文件里的自选股是完整的。
 *
 * 启动时序（与导入 reload 的衔接）：
 * - 库非空 → 以库覆盖 store 并回写 localStorage（导入的数据就此生效）；
 * - 库为空且 store 非空 → 首次播种（把老用户的 localStorage 存量写进库）；
 * - 两边都空 → 什么都不做。
 * 水合 / 播种完成前不响应 store 变化（避免用旧状态覆盖刚写好的库）。
 *
 * 时序竞态说明：pinia persist 的 localStorage 水合在 store 创建时同步完成，
 * 本模块启动时 store 已是「上一次会话的最终状态」，因此两侧数据都完整可信。
 */

/**
 * 快照是否与 store 当前状态一致（避免每次启动都无谓覆盖 + 回写）
 * @param a 库里读出的快照
 * @param b store 当前分组
 * @returns 是否一致
 */
const isSameSnapshot = (a: readonly WatchlistGroup[], b: readonly WatchlistGroup[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * 启动自选股镜像同步（主窗口入口调用一次；重复调用无害但无意义）
 *
 * 启动流程为异步：先对齐库与 store，完成后才打开「store 变化 → 整包重写库」的订阅。
 */
export const startWatchlistDbSync = (): void => {
  if (!isTauri()) return;
  const store = useWatchlistStore();

  /** 镜像是否已就绪（启动对齐完成前不回写库） */
  let ready = false;

  /**
   * 串行写队列：全量重写是「先清两表再插入」的多条语句，
   * 快速连续变更（如刚加入就移除）并发交错会互相清掉对方的数据 ——
   * 排队串行执行，且每次都取 store 最新状态，天然合并中间态
   */
  let writeQueue: Promise<unknown> = Promise.resolve();
  const enqueueSave = (): void => {
    writeQueue = writeQueue.then(() => saveWatchlistGroups(store.groups));
  };

  // 启动对齐：库非空 → 覆盖 store（导入生效通道）；库空 store 非空 → 首次播种
  void (async () => {
    const snapshot = await loadWatchlistGroups();
    if (snapshot !== null && snapshot.length > 0) {
      if (!isSameSnapshot(snapshot, store.groups)) {
        store.groups = snapshot;
        store.$persist();
      }
    } else if (snapshot !== null && store.groups.length > 0) {
      enqueueSave();
    }
    ready = true;
  })();

  // 运行期镜像：store 分组（含个股增删 / 排序 / 改名）任何变化都整包重写两表；
  // 数据量小（分组 × 几十只票），串行队列即可，无需增量
  watch(
    () => store.groups,
    () => {
      if (!ready) return;
      enqueueSave();
    },
    { deep: true },
  );
};
